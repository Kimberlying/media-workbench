import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

// service role 客户端：绕过 RLS，只在后台任务（Inngest）和服务端可信代码里用。
// 绝不能被客户端组件导入。
export function createAdminClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
