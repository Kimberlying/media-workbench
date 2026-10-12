import { redirect } from "next/navigation";
import type { Org, Workspace } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

// 当前登录用户和其所在组织。一期每个用户只有自用组织；首次进入时自动创建。
export async function requireSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: orgId, error } = await supabase.rpc("ensure_personal_org");
  if (error) throw new Error(error.message);

  const [{ data: org }, { data: workspaces }] = await Promise.all([
    supabase.from("orgs").select("*").eq("id", orgId).single(),
    supabase.from("workspaces").select("*").eq("org_id", orgId).order("created_at"),
  ]);
  if (!org || !workspaces?.length) throw new Error("组织数据不完整");

  return {
    supabase,
    user,
    org: org as Org,
    workspace: workspaces[0] as Workspace,
    workspaces: workspaces as Workspace[],
  };
}
