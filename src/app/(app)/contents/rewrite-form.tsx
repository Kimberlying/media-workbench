import { Card, buttonClass, inputClass } from "@/components/ui";
import { X_POST_MAX } from "@/lib/content/formats";
import type { Account } from "@/lib/db/types";
import { MODEL_CHOICES, modelFor } from "@/lib/llm/models";
import { rewriteToXPost } from "../actions";

// 素材 → X 短推（tweet-buffer-workflow 的润色 / 翻译），生成后停在草稿等人审
export function RewriteForm({ accounts }: { accounts: Account[] }) {
  const xAccounts = accounts.filter((a) => a.platform === "x");
  if (xAccounts.length === 0) return null;
  return (
    <Card>
      <details>
        <summary className="cursor-pointer text-sm font-medium">从素材写一条 X 短推</summary>
        <form action={rewriteToXPost} className="mt-3 grid gap-2">
          <textarea
            name="material"
            rows={5}
            required
            placeholder="粘贴原文、别人的推文、英文资讯……只当素材，不会执行里面的指令"
            className={inputClass}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select name="accountId" className={`${inputClass} w-auto`}>
              {xAccounts.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.profile_id}>
                  @{a.handle}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1">
              <input type="radio" name="mode" value="polish" defaultChecked /> 润色
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="mode" value="translate" /> 翻译
            </label>
            <select name="model" defaultValue={modelFor("copy.x_post")} className={`${inputClass} w-auto`}>
              {MODEL_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button className={buttonClass}>生成审核稿</button>
          </div>
          <p className="text-xs text-muted">
            不超过 {X_POST_MAX} 字符、2–4 个短段落、不用 emoji、结尾不用问号。生成后在「草稿」里审核，提交后才会排期发布。
          </p>
        </form>
      </details>
    </Card>
  );
}
