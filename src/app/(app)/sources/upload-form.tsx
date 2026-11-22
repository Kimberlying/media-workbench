"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import { checkUpload, UPLOAD_BUCKET, UPLOAD_EXTS, UPLOAD_MAX_BYTES, uploadPath } from "@/lib/sources/upload";
import { createClient } from "@/lib/supabase/browser";
import { createUploadedSource } from "../actions";

// 上传本地音视频：文件太大，不经过服务端，浏览器直接传到 Supabase Storage，传完再登记成素材开始转写
export function UploadForm({ orgId }: { orgId: string }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  async function upload(formData: FormData) {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    const problem = checkUpload(file.name, file.size);
    if (problem) return setState({ busy: false, error: problem });

    setState({ busy: true, error: null });
    const path = uploadPath(orgId, file.name, crypto.randomUUID());
    const { error } = await createClient()
      .storage.from(UPLOAD_BUCKET)
      .upload(path, file, { contentType: file.type || undefined });
    if (error) return setState({ busy: false, error: `上传失败：${error.message}` });
    // 成功后服务端会跳到这条素材
    await createUploadedSource(path, file.name);
  }

  return (
    <form action={upload} className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="file"
          name="file"
          required
          accept={UPLOAD_EXTS.map((e) => `.${e}`).join(",")}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button className={buttonClass} disabled={state.busy}>
          {state.busy ? "上传中…" : "上传并转写"}
        </button>
      </div>
      <p className="text-xs text-muted">
        本地录音、播客音频、视频文件都行，{UPLOAD_MAX_BYTES / 1024 / 1024}MB 以内。文件一律 AI 转写，每分钟 2 积分。
      </p>
      {state.error ? <p className="text-sm text-bad">{state.error}</p> : null}
    </form>
  );
}
