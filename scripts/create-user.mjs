const encoder = new TextEncoder();

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const email = (process.argv[2] || "").trim().toLowerCase();
const password = process.argv[3] || "";
const name = process.argv[4] || "Studio";

if (!email || !password) {
  console.error("Usage: node scripts/create-user.mjs <email> <password> [name]");
  process.exit(1);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
  "deriveBits",
]);
const key = await crypto.subtle.deriveBits(
  { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
  material,
  256,
);
const saltHex = toHex(salt);
const hash = toHex(new Uint8Array(key));
const now = Date.now();

const sql = `INSERT INTO users (email, name, password_salt, password_hash, created_at)
VALUES ('${email.replace(/'/g, "''")}', '${name.replace(/'/g, "''")}', '${saltHex}', '${hash}', ${now})
ON CONFLICT(email) DO UPDATE SET
  name = excluded.name,
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash;`;

console.log(sql);
