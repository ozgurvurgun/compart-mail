const HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' https://static.cloudflareinsights.com; worker-src 'self'; manifest-src 'self'; frame-src 'self'; connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com; base-uri 'self'; form-action 'self'",
};

export function withSecurityHeaders(response: Response, api = false): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(HEADERS)) {
    headers.set(key, value);
  }
  if (api) {
    headers.set("Cache-Control", "private, no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
