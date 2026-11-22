import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { PROVIDERS, parseModel, type ModelRef, type ProviderId } from "./catalog";
import { costOf, modelFor, modelUseOf, type ModelUse, type Step } from "./models";

// 模型网关：所有生成都经过这里。
// - 用哪个模型：调用方指定的（例如某个账号另选的）> 工作台「模型」页按用途选的 > LLM_MODEL_OVERRIDES > models.ts 默认
// - 发到哪家：模型写成「厂商/模型名」，key 先找工作台里贴的，再找环境变量。Gemini、OpenAI、xAI、OpenRouter 走
//   OpenAI 兼容接口；Claude 走 Anthropic 官方 SDK
// - 配了 LiteLLM 代理就全部走代理（模型名原样交给它）
// - 带服务端工具（如 Grok 的 x_search）时走 xAI 的 Responses 接口，xAI 只在这个接口上提供搜索工具
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
  /** 手动指定模型（「厂商/模型名」、模型名或旧别名），覆盖工作台设置和环节默认值 */
  model?: string;
  /** 模型服务端执行的工具，例如 { type: "x_search", from_date, to_date } */
  tools?: Record<string, unknown>[];
}

/** 一个组织在工作台里的模型设置：贴的 key 和按用途选的模型 */
export interface OrgLlmConfig {
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ModelUse, string>>;
}

export interface GatewayConfig {
  /** LiteLLM 代理；配了就全部走代理 */
  baseUrl?: string;
  apiKey?: string;
  usage: UsageSink;
  fetch?: typeof fetch;
  /** 读 key 和默认模型 ID 的环境变量，默认 process.env */
  env?: Record<string, string | undefined>;
  /** 按组织读工作台里的设置（缓存由调用方做） */
  orgConfig?: (orgId: string | null) => Promise<OrgLlmConfig>;
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

type Target =
  | { api: "openai"; baseUrl: string; apiKey: string; model: string; noTemperature?: boolean; litellm?: boolean }
  | { api: "anthropic"; apiKey: string; model: string };

interface Reply {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cost?: number;
}

const JSON_ONLY = "只输出一个 JSON 对象，不要在 JSON 前后加任何文字。";

export class LlmGateway {
  constructor(private readonly config: GatewayConfig) {}

  private get env() {
    return this.config.env ?? process.env;
  }

  /** 这次调用实际用哪个模型（给页面显示、写进内容包） */
  async resolveModel(opts: Pick<GenerateOptions, "orgId" | "step" | "model">): Promise<string> {
    if (opts.model) return opts.model;
    const use = modelUseOf(opts.step);
    if (use && this.config.orgConfig) {
      const chosen = (await this.config.orgConfig(opts.orgId)).models[use];
      if (chosen) return chosen;
    }
    return modelFor(opts.step, this.env.LLM_MODEL_OVERRIDES);
  }

  async generate(opts: GenerateOptions & { json?: false }): Promise<string>;
  async generate<T>(opts: GenerateOptions & { json: z.ZodType<T> }): Promise<T>;
  async generate<T>(
    opts: GenerateOptions & { json?: false | z.ZodType<T> },
  ): Promise<string | T> {
    const useResponses = Boolean(opts.tools?.length);
    const spec = await this.resolveModel(opts);
    const target = await this.target(spec, opts.orgId, useResponses);

    const reply =
      target.api === "anthropic"
        ? await this.callAnthropic(target, opts)
        : await this.callOpenAiCompatible(target, opts, useResponses);

    await this.config.usage.record({
      org_id: opts.orgId,
      step: opts.step,
      model: target.model,
      input_tokens: reply.inputTokens,
      output_tokens: reply.outputTokens,
      cost: reply.cost || costOf(target.model, reply.inputTokens, reply.outputTokens),
      ref_id: opts.refId ?? null,
    });

    if (!opts.json) return reply.text;
    return opts.json.parse(JSON.parse(extractJson(reply.text)));
  }

  private async callOpenAiCompatible(
    target: Extract<Target, { api: "openai" }>,
    opts: GenerateOptions & { json?: unknown },
    useResponses: boolean,
  ): Promise<Reply> {
    const doFetch = this.config.fetch ?? fetch;
    const temperature = target.noTemperature ? {} : { temperature: opts.temperature ?? 0.7 };
    const res = await doFetch(`${target.baseUrl}/${useResponses ? "responses" : "chat/completions"}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify(
        useResponses
          ? // 带搜索工具时不开 JSON 模式，只靠提示词约束格式
            { model: target.model, input: opts.messages, tools: opts.tools, ...temperature }
          : {
              model: target.model,
              messages: opts.messages,
              ...temperature,
              ...(opts.json ? { response_format: { type: "json_object" } } : {}),
            },
      ),
    });

    if (!res.ok) {
      throw new Error(`模型 ${target.model} 返回 ${res.status}：${(await res.text()).slice(0, 500)}`);
    }
    // 走 LiteLLM 时用它在响应头里给的费用（美元）；直连时按 models.ts 里的单价算
    const cost = Number(res.headers.get("x-litellm-response-cost")) || undefined;

    if (useResponses) {
      const body = (await res.json()) as ResponsesResponse;
      return {
        text: (body.output ?? [])
          .filter((item) => item.type === "message")
          .flatMap((item) => item.content ?? [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text ?? "")
          .join(""),
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        cost,
      };
    }
    const body = (await res.json()) as ChatCompletionResponse;
    return {
      text: body.choices[0]?.message.content ?? "",
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      cost,
    };
  }

  private async callAnthropic(
    target: Extract<Target, { api: "anthropic" }>,
    opts: GenerateOptions & { json?: unknown },
  ): Promise<Reply> {
    const client = new Anthropic({ apiKey: target.apiKey, ...(this.config.fetch ? { fetch: this.config.fetch } : {}) });
    const system = opts.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .concat(opts.json ? [JSON_ONLY] : [])
      .join("\n\n");
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: target.model,
        max_tokens: 16000,
        ...(system ? { system } : {}),
        messages: opts.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error("Claude 的 key 不对或已失效，到「模型」页换一个");
      if (err instanceof Anthropic.NotFoundError) throw new Error(`Claude 没有叫 ${target.model} 的模型，到「模型」页改一下`);
      if (err instanceof Anthropic.APIError) throw new Error(`模型 ${target.model} 返回 ${err.status}：${err.message.slice(0, 500)}`);
      throw err;
    }
    if (message.stop_reason === "refusal") {
      throw new Error(`Claude（${target.model}）拒绝了这次请求，换个模型再试`);
    }
    return {
      text: message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join(""),
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  }

  // 这次请求发到哪：带工具且配了 xAI → 直连 xAI；配了 LiteLLM → 代理；否则按厂商直连
  private async target(spec: string, orgId: string | null, useResponses: boolean): Promise<Target> {
    const { xai, baseUrl, apiKey } = this.config;
    if (useResponses && xai) {
      return {
        api: "openai",
        baseUrl: `${(xai.baseUrl ?? "https://api.x.ai").replace(/\/$/, "")}/v1`,
        apiKey: xai.apiKey,
        model: xai.model,
      };
    }
    if (baseUrl && apiKey) {
      return { api: "openai", baseUrl: `${baseUrl.replace(/\/$/, "")}/v1`, apiKey, model: spec, litellm: true };
    }

    const ref = parseModel(spec, this.env);
    if (!ref) {
      throw new Error(`看不出「${spec}」是哪家的模型：写成「厂商/模型名」，例如 anthropic/claude-sonnet-5-5`);
    }
    const key = await this.keyFor(ref, orgId);
    const info = PROVIDERS[ref.provider];
    if (info.api === "anthropic") return { api: "anthropic", apiKey: key, model: ref.model };
    return { api: "openai", baseUrl: info.baseUrl!, apiKey: key, model: ref.model, noTemperature: info.noTemperature };
  }

  private async keyFor(ref: ModelRef, orgId: string | null): Promise<string> {
    const info = PROVIDERS[ref.provider];
    const saved = this.config.orgConfig ? (await this.config.orgConfig(orgId)).keys[ref.provider] : undefined;
    const key = saved || this.env[info.env];
    if (!key) {
      throw new Error(
        `用 ${info.label} 的 ${ref.model} 要先有它的 key：到工作台「模型」页贴一个，或配环境变量 ${info.env}`,
      );
    }
    return key;
  }
}

/** 模型偶尔会给 JSON 包上代码块或前后加一句话：取出第一个 { 到最后一个 } */
export function extractJson(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1];
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}
