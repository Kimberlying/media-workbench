import { headers } from "next/headers";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/login?error=请填写邮箱");

  const origin = process.env.APP_URL ?? (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/login?sent=1");
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">自媒体工作台</h1>
      <Suspense>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginForm({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  return (
    <>
      {params.sent ? (
        <p className="text-sm text-zinc-600">登录链接已发到邮箱，点开即可进入。</p>
      ) : (
        <form action={sendMagicLink} className="flex flex-col gap-3">
          <input
            name="email"
            type="email"
            required
            placeholder="邮箱"
            className="rounded border border-zinc-300 px-3 py-2"
          />
          <button className="rounded bg-zinc-900 px-3 py-2 text-white">发送登录链接</button>
          {params.error ? <p className="text-sm text-red-600">{String(params.error)}</p> : null}
        </form>
      )}
    </>
  );
}
