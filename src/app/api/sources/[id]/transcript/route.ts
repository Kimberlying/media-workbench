import { NextResponse, type NextRequest } from "next/server";
import type { Source } from "@/lib/db/types";
import { sourceMarkdown } from "@/lib/sources/export";
import { createClient } from "@/lib/supabase/server";

// 下载素材的整理结果和文字稿（Markdown）。用当前用户身份查询，RLS 保证只能下载自己组织的素材。
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/sources/[id]/transcript">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sources")
    .select("id, url, title, author, duration_seconds, digest, transcript")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "找不到素材" }, { status: 404 });

  const source = data as Pick<Source, "id" | "url" | "title" | "author" | "duration_seconds" | "digest" | "transcript">;
  const name = `source_${source.id.slice(0, 8)}.md`;
  return new NextResponse(sourceMarkdown(source), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
    },
  });
}
