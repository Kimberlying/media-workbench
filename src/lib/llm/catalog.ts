// 能接哪些模型厂商。换模型 = 在「模型」页选一个模型名；接一家新厂商 = 在「模型」页贴它的 key。
// 模型统一写成「厂商/模型名」，例如 anthropic/claude-sonnet-5-5、gemini/gemini-3.8-flash；
// 只写模型名也行，按前缀认出厂商（claude- → Anthropic，gpt- → OpenAI，gemini- → Google，grok- → xAI）。

export type ProviderId = "gemini" | "anthropic" | "openai" | "xai" | "openrouter";

export interface ProviderInfo {
  label: string;
  /** 不在工作台里贴 key 时读的环境变量 */
  env: string;
  /** 去哪儿申请 key */
  keyUrl: string;
  /** anthropic 走官方 SDK；其余都是 OpenAI 兼容接口 */
  api: "openai" | "anthropic";
  baseUrl?: string;
  /** 新一代推理模型只认默认温度，传了会报错 */
  noTemperature?: boolean;
  /** 拉不到模型列表时给的几个常用名（只列核实过的） */
  suggestions: string[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: {
    label: "Gemini（Google）",
    env: "GEMINI_API_KEY",
    keyUrl: "https://aistudio.google.com/apikey",
    api: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    suggestions: ["gemini-3.8-flash"],
  },
  anthropic: {
    label: "Claude（Anthropic）",
    env: "ANTHROPIC_API_KEY",
    keyUrl: "https://platform.claude.com/settings/keys",
    api: "anthropic",
    suggestions: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  },
  openai: {
    label: "GPT（OpenAI）",
    env: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    api: "openai",
    baseUrl: "https://api.openai.com/v1",
    noTemperature: true,
    suggestions: [],
  },
  xai: {
    label: "Grok（xAI）",
    env: "XAI_API_KEY",
    keyUrl: "https://console.x.ai",
    api: "openai",
    baseUrl: "https://api.x.ai/v1",
    suggestions: ["grok-4.7"],
  },
  openrouter: {
    label: "OpenRouter（一个 key 用各家模型）",
    env: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/keys",
    api: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    suggestions: [],
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProvider(value: string): value is ProviderId {
  return value in PROVIDERS;
}

export interface ModelRef {
  provider: ProviderId;
  model: string;
}

type Env = Record<string, string | undefined>;

/** 「厂商/模型名」、只写模型名、或旧别名（grok、gemini-flash）→ 哪家的哪个模型；认不出返回 null */
export function parseModel(spec: string, env: Env = process.env): ModelRef | null {
  const value = spec.trim();
  if (!value) return null;
  // 旧别名：模型 ID 仍可用环境变量换
  if (value === "grok") return { provider: "xai", model: env.XAI_MODEL || "grok-4.7" };
  if (value === "gemini-flash") return { provider: "gemini", model: env.GEMINI_MODEL || "gemini-3.8-flash" };

  const slash = value.indexOf("/");
  if (slash > 0) {
    const head = value.slice(0, slash);
    const rest = value.slice(slash + 1);
    if (isProvider(head) && rest) return { provider: head, model: rest };
  }
  if (slash >= 0) return null;
  if (/^gemini-/i.test(value)) return { provider: "gemini", model: value };
  if (/^claude-/i.test(value)) return { provider: "anthropic", model: value };
  if (/^(gpt-|chatgpt-|o\d)/i.test(value)) return { provider: "openai", model: value };
  if (/^grok-/i.test(value)) return { provider: "xai", model: value };
  return null;
}

export function formatModel(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}`;
}

/** 模型名只收字母、数字和 . - _ : /，防止填进奇怪的东西 */
export const MODEL_SPEC = /^[A-Za-z0-9._:/-]{1,120}$/;

/** key 在页面上只露最后 4 位 */
export function keyHint(key: string): string {
  return key.length <= 8 ? "····" : `····${key.slice(-4)}`;
}
