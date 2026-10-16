import type { z } from "zod";
import { costOf, modelFor, type Step } from "./models";

// 模型网关：所有生成都经过这里。
// - 调用 OpenAI 兼容接口，模型由 step 决定：配了 LiteLLM 代理就走代理；没配就按别名直连各家
//   （xAI、Gemini 都有 OpenAI 兼容接口），上线少托管一个服务
// - 带服务端工具（如 Grok 的 x_search）时走 Responses 接口，xAI 只在这个接口上提供搜索工具；
//   配了 xAI 的 key 就直连 xAI（kim 2026-10-14 决定用 xAI 的 Grok API 搜 X 热点）
// - 每次调用写一条 usage_logs：哪个租户、哪个环节、哪个模型、多少 token、多少钱

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface UsageRecord {
  org_id: string | null;
  step: Step;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  ref_id?: string | null;
}

export interface UsageSink {
  record(usage: UsageRecord): Promise<void>;
}

export interface GenerateOptions {
  orgId: string | null;
  step: Step;
  messages: ChatMessage[];
  refId?: string;
  temperature?: number;
  /** 手动指定模型别名，覆盖环节默认值 */
  model?: string;
  /** 模型服务端执行的工具，例如 { type: "x_search", from_date, to_date } */
  tools?: Record<string, unknown>[];
}

/** 直连的一家模型接口。baseUrl 带版本路径，例如 https://api.x.ai/v1 */
export interface Provider {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface GatewayConfig {
  /** LiteLLM 代理；不配就只用 providers 直连 */
  baseUrl?: string;
  apiKey?: string;
  /** 按别名直连，例如 { grok: {...}, "gemini-flash": {...} }；代理和直连都有时，别名在这里的优先直连 */
  providers?: Record<string, Provider>;
  usage: UsageSink;
  fetch?: typeof fetch;
  /** 带工具的请求（Grok 搜 X）直连 xAI，不经过 LiteLLM；没配就仍走网关 */
  xai?: { apiKey: string; model: string; baseUrl?: string };
}

interface ChatCompletionResponse {
  choices: { message: { content: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface ResponsesResponse {
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class LlmGateway {
  constructor(private readonly config: GatewayConfig) {}

  async generate(opts: GenerateOptions & { json?: false }): Promise<string>;
  async generate<T>(opts: GenerateOptions & { json: z.ZodType<T> }): Promise<T>;
  async generate<T>(
    opts: GenerateOptions & { json?: false | z.ZodType<T> },
  ): Promise<string | T> {
    const doFetch = this.config.fetch ?? fetch;
    const useResponses = Boolean(opts.tools?.length);
    const target = this.target(opts.model ?? modelFor(opts.step), useResponses);
    const model = target.model;

    const res = await doFetch(`${target.baseUrl}/${useResponses ? "responses" : "chat/completions"}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify(
        useResponses
          ? // 带搜索工具时不开 JSON 模式，只靠提示词约束格式
            { model, input: opts.messages, tools: opts.tools, temperature: opts.temperature ?? 0.7 }
          : {
              model,
              messages: opts.messages,
              temperature: opts.temperature ?? 0.7,
              ...(opts.json ? { response_format: { type: "json_object" } } : {}),
            },
      ),
    });

    if (!res.ok) {
      throw new Error(`模型网关返回 ${res.status}：${await res.text()}`);
    }

    let text: string;
    let inputTokens: number;
    let outputTokens: number;
    if (useResponses) {
      const body = (await res.json()) as ResponsesResponse;
      text = (body.output ?? [])
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === "output_text")
        .map((part) => part.text ?? "")
        .join("");
      inputTokens = body.usage?.input_tokens ?? 0;
      outputTokens = body.usage?.output_tokens ?? 0;
    } else {
      const body = (await res.json()) as ChatCompletionResponse;
      text = body.choices[0]?.message.content ?? "";
      inputTokens = body.usage?.prompt_tokens ?? 0;
      outputTokens = body.usage?.completion_tokens ?? 0;
    }

    await this.config.usage.record({
      org_id: opts.orgId,
      step: opts.step,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      // 走 LiteLLM 时用它在响应头里给的费用（美元）；直连时按 models.ts 里的单价算
      cost: Number(res.headers.get("x-litellm-response-cost")) || costOf(model, inputTokens, outputTokens),
      ref_id: opts.refId ?? null,
    });

    if (!opts.json) return text;
    return opts.json.parse(JSON.parse(stripCodeFence(text)));
  }

  // 这次请求发到哪：带工具且配了 xAI → 直连 xAI；别名有直连配置 → 直连；否则走 LiteLLM
  private target(alias: string, useResponses: boolean): Provider {
    const { xai, providers, baseUrl, apiKey } = this.config;
    if (useResponses && xai) {
      return { baseUrl: `${(xai.baseUrl ?? "https://api.x.ai").replace(/\/$/, "")}/v1`, apiKey: xai.apiKey, model: xai.model };
    }
    const direct = providers?.[alias];
    if (direct) return { ...direct, baseUrl: direct.baseUrl.replace(/\/$/, "") };
    if (baseUrl && apiKey) return { baseUrl: `${baseUrl.replace(/\/$/, "")}/v1`, apiKey, model: alias };
    throw new Error(`模型 ${alias} 没有可用的接口：配 LLM_GATEWAY_URL，或配这家模型的 API key，见 .env.example`);
  }
}

function stripCodeFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}
