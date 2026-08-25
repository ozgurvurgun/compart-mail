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

function wantsHtml(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const mode = request.headers.get("sec-fetch-mode");
  if (mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

function accessLoginRedirect(request: Request, teamDomain: string): Response {
  const url = new URL(request.url);
  const redirectUrl = `${url.pathname}${url.search}` || "/";
  const login = new URL(`https://${teamDomain}/cdn-cgi/access/login/${url.hostname}`);
  login.searchParams.set("redirect_url", redirectUrl);
  return Response.redirect(login.toString(), 302);
}

export async function requireAccessIdentity(
  request: Request,
  auth: AccessAuthenticator,
  accessConfigured: boolean,
  teamDomain = "",
): Promise<{ ok: true; identity: { email: string; name?: string } } | { ok: false; response: Response }> {
  if (!accessConfigured) {
    return {
      ok: false,
      response: Response.json({ error: "Cloudflare Access is not configured" }, { status: 503 }),
    };
  }
  const identity = await auth.authenticate(request);
  if (!identity) {
    // Browser navigations: send to Access login instead of a bare 401/403 Chrome error page.
    if (teamDomain && wantsHtml(request)) {
      return { ok: false, response: accessLoginRedirect(request, teamDomain) };
    }
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
