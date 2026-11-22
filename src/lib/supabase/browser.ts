import { createBrowserClient } from "@supabase/ssr";

// 浏览器里以当前登录用户身份访问 Supabase，受 RLS 和存储策略约束。只用来直传大文件（素材上传），
// 别的读写都走服务端组件和 Server Action。
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
