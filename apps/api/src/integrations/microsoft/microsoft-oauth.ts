import { createHash, randomBytes } from "node:crypto";

/**
 * Microsoft identity platform (v2) authorization-code flow with PKCE, as a confidential
 * client (the API holds the client secret; the browser never sees a token).
 */

/** Least privilege: read calendars + basic profile (for the account email) + refresh tokens. */
export const MS_CALENDAR_SCOPES = ["offline_access", "User.Read", "Calendars.Read"] as const;

/** Defence in depth: refuse a token that can write, even if the app registration were changed. */
const WRITE_SCOPE = /(ReadWrite|\.Write|\.Send|FullControl|Delete)/i;

export type MicrosoftOAuthConfig = { tenantId: string; clientId: string; clientSecret: string; redirectUri: string };
export type TokenSet = { accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] };

export class ReconnectRequiredError extends Error {}
export class MicrosoftOAuthError extends Error {}

export const newPkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

export function authorizeUrl(cfg: MicrosoftOAuthConfig, state: string, codeChallenge: string): string {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: MS_CALENDAR_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

async function tokenRequest(cfg: MicrosoftOAuthConfig, params: Record<string, string>, signal?: AbortSignal): Promise<TokenSet> {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: MS_CALENDAR_SCOPES.join(" "), ...params }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    // invalid_grant: consent revoked, password reset, refresh token expired -> user must reconnect.
    if (body.error === "invalid_grant" || body.error === "interaction_required") throw new ReconnectRequiredError(body.error);
    throw new MicrosoftOAuthError(`token endpoint: ${body.error ?? res.status}`); // never log the description verbatim to users
  }
  if (!body.refresh_token) throw new MicrosoftOAuthError("no refresh token (offline_access not granted)");
  const scopes = (body.scope ?? "").split(" ").filter(Boolean);
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000, scopes };
}

export function exchangeCode(cfg: MicrosoftOAuthConfig, code: string, codeVerifier: string, signal?: AbortSignal) {
  return tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, code_verifier: codeVerifier }, signal);
}

/** Microsoft rotates refresh tokens: callers must persist the returned refreshToken. */
export function refresh(cfg: MicrosoftOAuthConfig, refreshToken: string, signal?: AbortSignal) {
  return tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, signal);
}

/** Verifies the granted scopes: must include Calendars.Read, must not include anything that writes. */
export function checkGrantedScopes(scopes: string[]): { ok: true } | { ok: false; reason: string } {
  const short = scopes.map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, ""));
  if (!short.some((s) => s.toLowerCase() === "calendars.read")) return { ok: false, reason: "Calendars.Read was not granted" };
  const write = short.find((s) => WRITE_SCOPE.test(s));
  if (write) return { ok: false, reason: `refusing a token with write permission (${write})` };
  return { ok: true };
}
