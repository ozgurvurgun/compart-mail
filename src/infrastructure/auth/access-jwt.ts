/**
 * Verifies Cloudflare Access JWTs (CF-Access-Jwt-Assertion / CF_Authorization).
 * Spec: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

export interface AccessIdentity {
  readonly email: string;
  readonly sub: string;
}

type Jwk = JsonWebKey & { kid?: string; kty: string; alg?: string; use?: string };

type JwksCache = {
  keys: Jwk[];
  fetchedAt: number;
};

const jwksByIssuer = new Map<string, JwksCache>();
const JWKS_TTL_MS = 60 * 60 * 1000;

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as T;
}

async function loadJwks(issuer: string): Promise<Jwk[]> {
  const cached = jwksByIssuer.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Failed to fetch Access JWKS (${response.status})`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksByIssuer.set(issuer, { keys, fetchedAt: Date.now() });
  return keys;
}

export async function verifyCloudflareAccessJwt(
  token: string,
  options: { teamDomain: string; audience: string | readonly string[] },
): Promise<AccessIdentity> {
  const teamDomain = options.teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const issuer = `https://${teamDomain}`;
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Access token");
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) throw new Error("Invalid Access token");

  const header = decodeJson<{ alg?: string; kid?: string }>(headerPart);
  const payload = decodeJson<{
    aud?: string | string[];
    iss?: string;
    exp?: number;
    email?: string;
    sub?: string;
    identity?: { email?: string };
  }>(payloadPart);

  if (header.alg !== "RS256") throw new Error("Unsupported Access token algorithm");
  if (payload.iss !== issuer) throw new Error("Invalid Access token issuer");
  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  const expectedAudiences = (typeof options.audience === "string" ? options.audience.split(",") : options.audience)
    .map((value) => value.trim())
    .filter(Boolean);
  if (!expectedAudiences.some((expected) => audiences.includes(expected))) {
    throw new Error(`Invalid Access token audience (token aud: ${audiences.join(",") || "none"})`);
  }
  if (!payload.exp || payload.exp * 1000 <= Date.now()) throw new Error("Access token expired");

  const email = (payload.email ?? payload.identity?.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("Access token missing email");

  const keys = await loadJwks(issuer);
  const jwk = keys.find((key) => key.kid === header.kid) ?? keys[0];
  if (!jwk) throw new Error("Access JWKS key not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const signatureBytes = base64UrlToBytes(signaturePart);
  const signature = new Uint8Array(signatureBytes.byteLength);
  signature.set(signatureBytes);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  if (!ok) throw new Error("Invalid Access token signature");

  return { email, sub: String(payload.sub ?? email) };
}

export function extractAccessJwt(request: {
  header(name: string): string | undefined;
  cookie?: string | undefined;
}): string | null {
  const header = request.header("cf-access-jwt-assertion");
  if (header) return header;
  const cookieHeader = request.cookie ?? request.header("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("CF_Authorization="));
  if (!match) return null;
  return decodeURIComponent(match.slice("CF_Authorization=".length));
}
