import type { z } from "zod";
import { modelFor, type Step } from "./models";

// 模型网关：所有生成都经过这里。
// - 调用 OpenAI 兼容接口（LiteLLM 代理），模型由 step 决定
// - 带服务端工具（如 Grok 的 x_search）时走 Responses 接口，xAI 只在这个接口上提供搜索工具
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

export interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
  usage: UsageSink;
  fetch?: typeof fetch;
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
    const model = opts.model ?? modelFor(opts.step);
    const doFetch = this.config.fetch ?? fetch;
    const base = this.config.baseUrl.replace(/\/$/, "");
    const useResponses = Boolean(opts.tools?.length);

    const res = await doFetch(`${base}/v1/${useResponses ? "responses" : "chat/completions"}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
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
      // LiteLLM 代理在响应头里给出本次调用的费用（美元）
      cost: Number(res.headers.get("x-litellm-response-cost") ?? 0) || 0,
      ref_id: opts.refId ?? null,
    });

    if (!opts.json) return text;
    return opts.json.parse(JSON.parse(stripCodeFence(text)));
  }
}

function stripCodeFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}
