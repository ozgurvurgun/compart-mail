const PBKDF2_ITERATIONS = 100_000;
const KEY_BITS = 256;

export class PasswordHasher {
  async hash(password: string, saltHex?: string): Promise<{ salt: string; hash: string }> {
    const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
    const key = await derive(password, salt);
    return { salt: toHex(salt), hash: toHex(new Uint8Array(key)) };
  }

  async verify(password: string, saltHex: string, hashHex: string): Promise<boolean> {
    const { hash } = await this.hash(password, saltHex);
    return timingSafeEqual(hash, hashHex);
  }
}

async function derive(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    KEY_BITS,
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
