// 素材：上传本地音视频文件。文件存在 Supabase Storage 的私有桶 sources，路径 {org_id}/{随机名}.{扩展名}，
// 转写时后台生成临时下载链接交给 Supadata（它只收公开可下载的文件链接）。

export const UPLOAD_BUCKET = "sources";

/** 和迁移里桶的 file_size_limit 一致：Supabase 免费档单个文件最大 50MB */
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/** Supadata 能转的文件格式 */
export const UPLOAD_EXTS = ["mp3", "m4a", "wav", "flac", "ogg", "mp4", "webm", "mpeg", "mpga"];

/** 上传的素材在 sources.url 里记成 upload:{路径}，页面上不当链接用 */
export const UPLOAD_URL_PREFIX = "upload:";

export function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/** 能不能传：格式和大小。能传返回 null */
export function checkUpload(name: string, size: number): string | null {
  if (!UPLOAD_EXTS.includes(extOf(name))) return `只支持 ${UPLOAD_EXTS.join("、")} 格式`;
  if (size > UPLOAD_MAX_BYTES) {
    return `文件 ${Math.ceil(size / 1024 / 1024)}MB，超过 ${UPLOAD_MAX_BYTES / 1024 / 1024}MB。长音频可以先转成 mp3（64kbps 约每小时 30MB）`;
  }
  return null;
}

export function uploadPath(orgId: string, name: string, id: string): string {
  return `${orgId}/${id}.${extOf(name)}`;
}

/** 服务端核对：路径必须在当前组织的目录下，且是 uploadPath 生成的样子 */
export function isOrgUploadPath(orgId: string, path: string): boolean {
  const [dir, file, ...rest] = path.split("/");
  return dir === orgId && rest.length === 0 && /^[0-9a-f-]{36}\.[a-z0-9]+$/.test(file ?? "") && UPLOAD_EXTS.includes(extOf(file));
}
