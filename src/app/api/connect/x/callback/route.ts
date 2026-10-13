import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, fetchUsername, xOAuthConfig } from "@/lib/connectors/x-oauth";
import { saveTokenBundle } from "@/lib/secrets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// X 授权回调：换令牌、加密入库、创建或更新账号
export async function GET(request: NextRequest) {
  const back = (msg?: string) =>
    NextResponse.redirect(new URL(msg ? `/accounts?error=${encodeURIComponent(msg)}` : "/accounts", request.url));

  const cookieStore = await cookies();
  const raw = cookieStore.get("x_oauth")?.value;
  cookieStore.delete({ name: "x_oauth", path: "/api/connect/x" });
  if (!raw) return back("授权已超时，请重试");

  const { verifier, state, workspaceId } = JSON.parse(raw) as {
    verifier: string;
    state: string;
    workspaceId: string;
  };
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("你取消了 X 授权");
  const code = params.get("code");
  if (!code || params.get("state") !== state) return back("授权校验失败，请重试");

  // 用当前用户身份确认能看到这个工作区（RLS 过滤），并且是 owner / editor
  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, org_id")
    .eq("id", workspaceId)
    .single();
  if (!workspace) return back("找不到工作区");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membership } = await supabase
    .from("members")
    .select("role")
    .eq("org_id", workspace.org_id)
    .eq("user_id", user?.id ?? "")
    .in("role", ["owner", "editor"])
    .maybeSingle();
  if (!membership) return back("你没有这个工作区的编辑权限");

  const bundle = await exchangeCode(xOAuthConfig(), code, verifier);
  const handle = await fetchUsername(bundle.access_token);

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("accounts")
    .select("id, org_id, token_ref")
    .eq("platform", "x")
    .eq("handle", handle)
    .maybeSingle();
  if (existing && existing.org_id !== workspace.org_id) return back(`@${handle} 已被其他组织连接`);

  const tokenRef = await saveTokenBundle(admin, workspace.org_id, bundle, existing?.token_ref);
  if (existing) {
    await admin.from("accounts").update({ token_ref: tokenRef }).eq("id", existing.id);
  } else {
    const { error } = await admin.from("accounts").insert({
      org_id: workspace.org_id,
      workspace_id: workspace.id,
      platform: "x",
      handle,
      token_ref: tokenRef,
    });
    if (error) return back(error.message);
  }
  return back();
}
