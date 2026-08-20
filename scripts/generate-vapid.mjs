import { webcrypto } from "node:crypto";
import { writeFile } from "node:fs/promises";

const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const rawPub = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);

function b64url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const publicKey = b64url(rawPub);
const privateKey = jwk.d;
if (!privateKey) throw new Error("missing d");

await writeFile(
  new URL("../.vapid.json", import.meta.url),
  JSON.stringify({ publicKey, privateKey, subject: "mailto:hello@compartsoftware.com" }, null, 2),
);
console.log(publicKey);
