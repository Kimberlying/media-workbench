// 素材链接：认出是哪个平台，整理成统一的写法（同一个视频只转一次）。
// 支持范围跟着 Supadata 的转写接口走：YouTube、TikTok、Instagram、X、Facebook 的视频，
// 以及公开的音视频文件直链。B 站、抖音、小红书和播客 App 的链接它不支持。

export type SourcePlatform = "youtube" | "tiktok" | "instagram" | "x" | "facebook" | "file";

export const PLATFORM_LABELS: Record<SourcePlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
  facebook: "Facebook",
  file: "音视频文件",
};

export const SUPPORTED_HINT =
  "支持 YouTube、TikTok、Instagram、X、Facebook 的视频链接，以及 mp3、mp4、m4a、wav 等音视频文件的公开直链（750MB、12 小时以内）。" +
  "播客可以贴单集的音频文件链接，或者它在 YouTube 上的那一期。";

const FILE_EXT = /\.(mp4|webm|mp3|flac|mpeg|mpga|m4a|ogg|wav)$/i;

function parse(raw: string): URL | null {
  const text = raw.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** YouTube 各种写法里的视频 id：watch?v=、youtu.be/、shorts/、live/、embed/ */
export function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
  if (host !== "youtube.com") return null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const m = url.pathname.match(/^\/(shorts|live|embed)\/([\w-]+)/);
  return m ? m[2] : null;
}

export function detectPlatform(raw: string): SourcePlatform | null {
  const url = parse(raw);
  if (!url) return null;
  const host = url.hostname.replace(/^(www\.|m\.|mobile\.)/, "");
  if (youtubeId(url)) return "youtube";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "instagram.com" && /^\/(reels?|p|tv)\//.test(url.pathname)) return "instagram";
  if ((host === "x.com" || host === "twitter.com") && /\/status\/\d+/.test(url.pathname)) return "x";
  if (host === "fb.watch" || (host.endsWith("facebook.com") && /\/(videos?|reel|watch)\b/.test(url.pathname))) {
    return "facebook";
  }
  if (FILE_EXT.test(url.pathname)) return "file";
  return null;
}

/** 统一写法：YouTube 只留视频 id（去掉播放列表、时间点等参数），其余去掉 # 后面的部分 */
export function normalizeSourceUrl(raw: string): string | null {
  const url = parse(raw);
  if (!url || !detectPlatform(url.href)) return null;
  const id = youtubeId(url);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  url.hash = "";
  return url.href;
}

/** 跳到视频某一秒的链接；只有 YouTube 支持，别的平台给原链接 */
export function linkAt(url: string, seconds: number): string {
  const parsed = parse(url);
  const id = parsed ? youtubeId(parsed) : null;
  return id ? `https://www.youtube.com/watch?v=${id}&t=${Math.max(0, Math.floor(seconds))}s` : url;
}
