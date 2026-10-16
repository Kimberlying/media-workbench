import { NextResponse, type NextRequest } from "next/server";
import { renderCard } from "@/lib/cards/render";
import type { ContentPack, DownloadablePack } from "@/lib/xhs/schema";
import { packCards } from "@/lib/xhs/export";
import { createClient } from "@/lib/supabase/server";

// 第 n 张卡片（从 1 数）的 PNG，给「内容」页预览用。地址不带 .png，这样仍经过 proxy.ts 刷新登录。
// 用当前用户身份查询，RLS 保证只能看自己组织的内容。
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/contents/[id]/cards/[n]">) {
  const { id, n } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("contents").select("pack").eq("id", id).maybeSingle();
  if (error || !data?.pack || (data.pack as ContentPack).kind === "post") {
    return NextResponse.json({ error: "找不到卡片" }, { status: 404 });
  }
  const cards = packCards(data.pack as DownloadablePack);
  const index = Number(n) - 1;
  if (!cards || !Number.isInteger(index) || !cards.cards[index]) return NextResponse.json({ error: "找不到卡片" }, { status: 404 });

  const png = await renderCard(cards, index);
  return new NextResponse(Buffer.from(png), {
    // 重新生成内容包后同一地址会换图，所以只做短缓存
    headers: { "content-type": "image/png", "cache-control": "private, max-age=300" },
  });
}
