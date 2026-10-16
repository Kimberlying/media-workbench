import { NextResponse, type NextRequest } from "next/server";
import { renderCards } from "@/lib/cards/render";
import type { ContentPack, DownloadablePack } from "@/lib/xhs/schema";
import { packCards, packFiles, zipPack } from "@/lib/xhs/export";
import { createClient } from "@/lib/supabase/server";

// 出图要几秒到十几秒（每张卡一次渲染）
export const maxDuration = 60;

// 下载发布包（zip），卡片图片当场出好放进 images/。用当前用户身份查询，RLS 保证只能下载自己组织的内容。
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/contents/[id]/pack">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contents")
    .select("id, variant, body, pack")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "找不到内容" }, { status: 404 });
  if (!data.pack || (data.pack as ContentPack).kind === "post") {
    return NextResponse.json({ error: "这条内容没有发布包" }, { status: 400 });
  }

  const pack = data.pack as DownloadablePack;
  const files: Record<string, string | Uint8Array> = packFiles({ body: data.body, pack });
  const cards = packCards(pack);
  if (cards) {
    for (const [file, png] of Object.entries(await renderCards(cards))) files[`images/${file}`] = png;
  }

  const zip = zipPack(files);
  const name = `${String(data.variant).replaceAll(":", "_")}_${String(data.id).slice(0, 8)}.zip`;
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${name}"`,
    },
  });
}
