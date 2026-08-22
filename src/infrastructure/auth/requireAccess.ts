import type { AccessAuthenticator } from "./AccessAuthenticator";

export function mailHostname(env: { MAIL_HOSTNAME?: string; MAIL_DOMAIN: string }): string {
  return env.MAIL_HOSTNAME || `mail.${env.MAIL_DOMAIN}`;
}

const PUBLIC_ASSETS = new Set([
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/sw.js",
  "/theme-boot.js",
]);

export function isAllowedHostname(hostname: string, allowed: string): boolean {
  return hostname === allowed;
}

/** PWA / chrome fetches these without Access cookies; do not gate them. */
export function isPublicAsset(pathname: string): boolean {
  if (PUBLIC_ASSETS.has(pathname)) return true;
  return pathname.startsWith("/icons/");
}

export async function requireAccessIdentity(
  request: Request,
  auth: AccessAuthenticator,
  accessConfigured: boolean,
): Promise<{ ok: true; identity: { email: string; name?: string } } | { ok: false; response: Response }> {
  if (!accessConfigured) {
    return {
      ok: false,
      response: Response.json({ error: "Cloudflare Access is not configured" }, { status: 503 }),
    };
  }
  const identity = await auth.authenticate(request);
  if (!identity) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, {
        status: 401,
        headers: { "Cache-Control": "private, no-store" },
      }),
    };
  }
  return { ok: true, identity };
}
