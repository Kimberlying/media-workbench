import { createHash, randomBytes } from "node:crypto";

// X OAuth 2.0（授权码 + PKCE）。需要在 X 开发者后台建应用，回调地址填
// {APP_URL}/api/connect/x/callback，权限勾 Read and write。

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

export interface TokenBundle {
  access_token: string;
  refresh_token?: string;
  /** 毫秒时间戳 */
  expires_at: number;
}

interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export function createPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

export function authorizeUrl(config: OAuthConfig, state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function tokenRequest(
  config: OAuthConfig,
  body: Record<string, string>,
  doFetch: typeof fetch = fetch,
): Promise<TokenBundle> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (config.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  }
  const res = await doFetch(TOKEN_URL, {
    method: "POST",
    headers,
    body: new URLSearchParams({ client_id: config.clientId, ...body }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(`X 授权失败（${res.status}）：${json.error_description ?? "未知错误"}`);
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in ?? 7200) * 1000,
  };
}

export function exchangeCode(config: OAuthConfig, code: string, verifier: string, doFetch?: typeof fetch) {
  return tokenRequest(
    config,
    { grant_type: "authorization_code", code, redirect_uri: config.redirectUri, code_verifier: verifier },
    doFetch,
  );
}

export function refreshToken(config: OAuthConfig, refresh: string, doFetch?: typeof fetch) {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refresh }, doFetch);
}

export async function fetchUsername(accessToken: string, doFetch: typeof fetch = fetch): Promise<string> {
  const res = await doFetch("https://api.x.com/2/users/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as { data?: { username: string } };
  if (!res.ok || !json.data) throw new Error(`读取 X 用户信息失败（${res.status}）`);
  return json.data.username;
}

export function xOAuthConfig(): OAuthConfig {
  const clientId = process.env.X_CLIENT_ID;
  const appUrl = process.env.APP_URL;
  if (!clientId || !appUrl) throw new Error("缺少 X_CLIENT_ID 或 APP_URL，见 .env.example");
  return {
    clientId,
    clientSecret: process.env.X_CLIENT_SECRET || undefined,
    redirectUri: `${appUrl.replace(/\/$/, "")}/api/connect/x/callback`,
  };
}
