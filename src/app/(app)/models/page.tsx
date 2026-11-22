import { Card, PageHeader, buttonClass, ghostButtonClass, inputClass } from "@/components/ui";
import { modelsFromSettings } from "@/lib/llm";
import { PROVIDERS } from "@/lib/llm/catalog";
import { MODEL_USES, modelFor, type ModelUse } from "@/lib/llm/models";
import { modelOptions, providerStatuses } from "@/lib/llm/options";
import { DEFAULT_IMAGE_MODEL, DEFAULT_OPENAI_IMAGE_MODEL, IMAGE_PROVIDERS } from "@/lib/media/image";
import { requireSession } from "@/lib/session";
import { deleteModelKey, saveModelKey, saveModelSettings, testModel } from "./actions";

// 换模型不改代码、不重新部署：贴 key → 选模型 → 试一下。

const DEFAULT_STEP: Record<ModelUse, "copy.post" | "topics.plan"> = { write: "copy.post", assist: "topics.plan" };

export default async function ModelsPage({ searchParams }: PageProps<"/models">) {
  const { org } = await requireSession();
  const { error, notice } = await searchParams;
  const [statuses, options] = await Promise.all([providerStatuses(org.id), modelOptions(org.id)]);
  const chosen = modelsFromSettings(org.settings);
  const hasKey = new Set(statuses.filter((s) => s.source !== "none").map((s) => s.provider));

  return (
    <>
      <PageHeader title="模型" />
      {error ? <p className="mb-4 text-sm text-bad">{String(error)}</p> : null}
      {notice ? <p className="mb-4 text-sm text-good">{String(notice)}</p> : null}

      <datalist id="model-options">
        {options.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <div className="grid gap-4">
        <Card>
          <div className="mb-1 text-sm font-medium">用哪个模型</div>
          <p className="mb-3 text-sm text-muted">
            点框会列出你有 key 的厂商现在能用的模型，也可以直接打，例如 claude-sonnet-5-5、gemini/gemini-3.8-flash。
            空着用默认。保存后下一条稿子就换，不用重新部署。某个账号想单独用别的模型，到「账号与档案」里给它选。
          </p>
          <form action={saveModelSettings} className="grid gap-3 md:grid-cols-2">
            {(Object.keys(MODEL_USES) as ModelUse[]).map((use) => (
              <label key={use} className="grid gap-1 text-sm">
                <span className="text-muted">
                  {MODEL_USES[use].label} <span className="text-xs">· {MODEL_USES[use].hint}</span>
                </span>
                <input
                  name={use}
                  list="model-options"
                  defaultValue={chosen[use] ?? ""}
                  placeholder={`默认 ${modelFor(DEFAULT_STEP[use])}`}
                  autoComplete="off"
                  className={inputClass}
                />
              </label>
            ))}
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Telegram 线配图用</span>
              <select name="image_provider" defaultValue={org.settings.image_provider ?? "gemini"} className={inputClass}>
                {Object.entries(IMAGE_PROVIDERS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted">Gemini 出图模型</span>
                <input
                  name="image"
                  defaultValue={org.settings.models?.image ?? ""}
                  placeholder={`默认 ${process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL}`}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted">ChatGPT 出图模型</span>
                <input
                  name="openai_image"
                  defaultValue={org.settings.models?.openai_image ?? ""}
                  placeholder={`默认 ${process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL}`}
                  className={inputClass}
                />
              </label>
            </div>
            <div className="md:col-span-2">
              <button className={buttonClass}>保存</button>
            </div>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(MODEL_USES) as ModelUse[]).map((use) => (
              <form key={use} action={testModel.bind(null, use)}>
                <button className={ghostButtonClass}>试一下{MODEL_USES[use].label}模型</button>
              </form>
            ))}
          </div>
          {org.settings.image_provider === "openai" && !hasKey.has("openai") ? (
            <p className="mt-3 text-sm text-bad">选了 ChatGPT 出图，但下面还没有 OpenAI 的 key，出图会失败。</p>
          ) : null}
        </Card>

        <Card>
          <div className="mb-1 text-sm font-medium">各家的 key</div>
          <p className="mb-3 text-sm text-muted">
            用到哪家就贴哪家，加密存在数据库里，页面上只露最后 4 位。也可以照旧放在 Vercel 环境变量里。会员订阅（ChatGPT
            Plus、Claude Pro）不能给服务器调用，要在各家的开发者平台单独办 API key。只想办一个 key 用各家模型，可以用 OpenRouter。
          </p>
          <div className="grid gap-3">
            {statuses.map(({ provider, source, hint }) => (
              <div key={provider} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-48 font-medium">{PROVIDERS[provider].label}</span>
                <span className={`w-40 text-xs ${source === "none" ? "text-muted" : "text-good"}`}>
                  {source === "saved" ? `已存 ${hint}` : source === "env" ? `用环境变量 ${PROVIDERS[provider].env}` : "还没有"}
                </span>
                <form action={saveModelKey.bind(null, provider)} className="flex flex-1 flex-wrap items-center gap-2">
                  <input
                    name="key"
                    type="password"
                    autoComplete="off"
                    placeholder={source === "saved" ? "贴新的 key 替换" : "贴 API key"}
                    className={`${inputClass} min-w-48 flex-1`}
                  />
                  <button className={ghostButtonClass}>保存</button>
                </form>
                {source === "saved" ? (
                  <form action={deleteModelKey.bind(null, provider)}>
                    <button className={ghostButtonClass}>删除</button>
                  </form>
                ) : null}
                <a href={PROVIDERS[provider].keyUrl} target="_blank" rel="noreferrer" className="text-xs text-muted underline">
                  去申请
                </a>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            语音转写固定用 Gemini（它能直接听音频）；资讯雷达搜 X 固定用 Grok。
          </p>
        </Card>
      </div>
    </>
  );
}
