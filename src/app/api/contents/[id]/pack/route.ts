import { NextResponse, type NextRequest } from "next/server";
import type { ContentPack } from "@/lib/xhs/schema";
import { packFiles, zipPack } from "@/lib/xhs/export";
import { createClient } from "@/lib/supabase/server";

// 下载发布包（zip）。用当前用户身份查询，RLS 保证只能下载自己组织的内容。
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/contents/[id]/pack">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contents")
    .select("id, variant, body, pack")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "找不到内容" }, { status: 404 });
  if (!data.pack) return NextResponse.json({ error: "这条内容没有发布包" }, { status: 400 });

  const zip = zipPack(packFiles({ body: data.body, pack: data.pack as ContentPack }));
  const name = `${String(data.variant).replaceAll(":", "_")}_${String(data.id).slice(0, 8)}.zip`;
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${name}"`,
    },
  });
}
