import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshToken, xOAuthConfig, type TokenBundle } from "@/lib/connectors/x-oauth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { Account } from "@/lib/db/types";

// 平台令牌的存取。只能用 service role 客户端调用（account_secrets 没有任何 RLS 策略）。

const REFRESH_MARGIN_MS = 5 * 60_000;

export async function saveTokenBundle(
  db: SupabaseClient,
  orgId: string,
  bundle: TokenBundle,
  existingRef?: string | null,
): Promise<string> {
  const row = {
    org_id: orgId,
    ciphertext: encryptSecret(JSON.stringify(bundle)),
    expires_at: new Date(bundle.expires_at).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (existingRef) {
    const { error } = await db.from("account_secrets").update(row).eq("id", existingRef);
    if (error) throw new Error(error.message);
    return existingRef;
  }
  const { data, error } = await db.from("account_secrets").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** 读出可用的访问令牌；快过期时自动刷新并写回 */
export async function loadAccessToken(db: SupabaseClient, account: Account): Promise<string | null> {
  if (!account.token_ref) return null;
  const { data, error } = await db
    .from("account_secrets")
    .select("ciphertext")
    .eq("id", account.token_ref)
    .single();
  if (error) throw new Error(error.message);

  const bundle = JSON.parse(decryptSecret(data.ciphertext)) as TokenBundle;
  if (bundle.expires_at - Date.now() > REFRESH_MARGIN_MS) return bundle.access_token;

  if (account.platform !== "x" || !bundle.refresh_token) {
    throw new Error(`@${account.handle} 的授权已过期，请重新连接`);
  }
  const fresh = await refreshToken(xOAuthConfig(), bundle.refresh_token);
  await saveTokenBundle(db, account.org_id, fresh, account.token_ref);
  return fresh.access_token;
}
