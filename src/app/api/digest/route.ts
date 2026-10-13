import { timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/env";
import { loadDigest } from "@/lib/pipeline/daily";
import { digestDay } from "@/lib/radar/daily";
import { createAdminClient } from "@/lib/supabase/admin";

// 每日资讯日报，给 Mac 上的 scripts/obsidian_sync.py 拉取后写进 Obsidian。
// 用 DIGEST_TOKEN 鉴权：GET /api/digest?day=YYYY-MM-DD，Authorization: Bearer <DIGEST_TOKEN>

function authorized(header: string | null): boolean {
  const expected = Buffer.from(`Bearer ${requireEnv("DIGEST_TOKEN")}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const day = new URL(request.url).searchParams.get("day") ?? digestDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Response("day 格式应为 YYYY-MM-DD", { status: 400 });

  const { digest } = await loadDigest(createAdminClient(), day);
  return Response.json({
    day,
    files: {
      [`AI每日素材/ai_radar_${day.replaceAll("-", "")}.md`]: digest.radar,
      [`今日X推文/x_posts_${day.replaceAll("-", "")}.md`]: digest.posts,
      [`利他素材/altruism_perks_${day.replaceAll("-", "")}.md`]: digest.altruism,
    },
  });
}
