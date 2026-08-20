const encoder = new TextEncoder();

export type VapidKeys = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function sendWebPush(
  target: PushTarget,
  payload: string,
  vapid: VapidKeys,
): Promise<number> {
  const audience = new URL(target.endpoint).origin;
  const jwt = await vapidJwt(audience, vapid);
  const body = await encryptPayload(payload, b64urlToBytes(target.p256dh), b64urlToBytes(target.auth));
  const response = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      TTL: "86400",
      Urgency: "high",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    },
    body,
  });
  return response.status;
}

async function vapidJwt(audience: string, vapid: VapidKeys) {
  const publicBytes = b64urlToBytes(vapid.publicKey);
  const x = bytesToB64url(publicBytes.slice(1, 33));
  const y = bytesToB64url(publicBytes.slice(33, 65));
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d: vapid.privateKey },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = bytesToB64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64url(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  );
  const unsigned = `${header}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned)),
  );
  return `${unsigned}.${bytesToB64url(signature)}`;
}

async function encryptPayload(payload: string, userPublic: Uint8Array, userAuth: Uint8Array) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const userKey = await crypto.subtle.importKey("raw", userPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: userKey }, local.privateKey, 256),
  );
  const ikm = await hkdf(
    secret,
    userAuth,
    concat(encoder.encode("WebPush: info\0"), userPublic, localPub),
    32,
  );
  const cek = await hkdf(ikm, salt, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, encoder.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(encoder.encode(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, padded),
  );
  const rs = 4096;
  const header = new Uint8Array(21 + localPub.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = localPub.length;
  header.set(localPub, 21);
  return concat(header, ciphertext);
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) {
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    base,
    length * 8,
  );
  return new Uint8Array(bits);
}

function concat(...parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function b64urlToBytes(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
