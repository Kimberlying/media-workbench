import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, createPkce, xOAuthConfig } from "@/lib/connectors/x-oauth";
import { createClient } from "@/lib/supabase/server";

// 开始连接 X 账号：生成 PKCE，跳到 X 授权页
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const workspaceId = request.nextUrl.searchParams.get("workspace");
  if (!workspaceId) return NextResponse.json({ error: "缺少 workspace" }, { status: 400 });

  const { verifier, challenge, state } = createPkce();
  const cookieStore = await cookies();
  cookieStore.set("x_oauth", JSON.stringify({ verifier, state, workspaceId }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/connect/x",
  });
  return NextResponse.redirect(authorizeUrl(xOAuthConfig(), state, challenge));
}
