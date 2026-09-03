import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerJs = join(root, "node_modules/wrangler/bin/wrangler.js");
const configPath = join(root, "wrangler.jsonc");
const NAME = "compart-mail";
const SCHEMA_FILES = [
  "schema.sql",
  "schema-auth.sql",
  "schema-perf.sql",
  "schema-contacts.sql",
  "schema-templates.sql",
  "schema-push.sql",
];

const syncOnly = process.argv.includes("--sync");
const migrateOnly = process.argv.includes("--migrate");

function loadConfig() {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function saveConfig(config) {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function parseJson(text) {
  const clean = stripAnsi(text);
  const startObj = clean.indexOf("{");
  const startArr = clean.indexOf("[");
  const start =
    startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr);
  if (start === -1) throw new Error(`Expected JSON, got:\n${clean.trim()}`);
  return JSON.parse(clean.slice(start));
}

function asList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const nested = Object.values(data).find((value) => Array.isArray(value));
  return nested || [];
}

function wrangler(args, { allowFail = false } = {}) {
  try {
    return execFileSync(process.execPath, [wranglerJs, ...args], {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, WRANGLER_LOG: "error" },
    });
  } catch (error) {
    const out = `${error.stdout || ""}${error.stderr || ""}`;
    if (allowFail) return out;
    throw new Error(stripAnsi(out).trim() || error.message);
  }
}

function localsFrom(vars) {
  return String(vars.SEED_MAILBOXES || "hello")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function syncDerived(config) {
  const vars = config.vars || (config.vars = {});
  const domain = String(vars.MAIL_DOMAIN || "").trim();
  if (!domain) throw new Error("Set vars.MAIL_DOMAIN in wrangler.jsonc");
  const locals = localsFrom(vars);
  if (!locals.length) throw new Error("Set vars.SEED_MAILBOXES in wrangler.jsonc (comma-separated local parts)");
  const host = String(vars.MAIL_HOSTNAME || `mail.${domain}`).trim();
  config.routes = [{ pattern: host, custom_domain: true }];
  config.send_email = [
    {
      name: "EMAIL",
      allowed_sender_addresses: locals.map((local) => `${local}@${domain}`),
    },
  ];
  if (!vars.MAIL_HOSTNAME) delete vars.MAIL_HOSTNAME;
  delete vars.VAPID_SUBJECT;
  return { domain, host, locals };
}

function resolveAccountId(config) {
  const info = parseJson(wrangler(["whoami", "--json"]));
  const accounts = asList(info.accounts || info);
  const ids = accounts
    .map((account) => account.id || account.account_id)
    .filter(Boolean);
  if (config.account_id && ids.includes(config.account_id)) return config.account_id;
  if (ids.length === 1) return ids[0];
  if (config.account_id) return config.account_id;
  throw new Error("Multiple Cloudflare accounts. Set account_id in wrangler.jsonc.");
}

function extractId(text, keys) {
  const uuid = text.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  if (uuid) return uuid[0];
  try {
    const data = parseJson(text);
    for (const key of keys) {
      if (data[key]) return data[key];
    }
  } catch {}
  throw new Error(`Could not read resource id from:\n${stripAnsi(text).trim()}`);
}

function ensureD1(config) {
  const list = asList(parseJson(wrangler(["d1", "list", "--json"])));
  const currentId = config.d1_databases?.[0]?.database_id;
  const found =
    list.find((item) => item.name === NAME) ||
    list.find((item) => (item.uuid || item.id) === currentId);
  if (found) {
    const id = found.uuid || found.id;
    const name = found.name || NAME;
    config.d1_databases = [{ binding: "DB", database_name: name, database_id: id }];
    console.log(`Using D1 ${name}`);
    return;
  }
  const created = wrangler(["d1", "create", NAME]);
  config.d1_databases = [
    { binding: "DB", database_name: NAME, database_id: extractId(created, ["uuid", "id", "database_id"]) },
  ];
  console.log(`Created D1 ${NAME}`);
}

function ensureKv(config) {
  const list = asList(parseJson(wrangler(["kv", "namespace", "list"])));
  const currentId = config.kv_namespaces?.[0]?.id;
  const found =
    list.find((item) => item.title === NAME || item.name === NAME) ||
    list.find((item) => item.id === currentId);
  if (found?.id) {
    config.kv_namespaces = [{ binding: "KV", id: found.id }];
    console.log(`Using KV ${found.title || found.name || found.id}`);
    return;
  }
  const created = wrangler(["kv", "namespace", "create", NAME]);
  config.kv_namespaces = [{ binding: "KV", id: extractId(created, ["id"]) }];
  console.log(`Created KV ${NAME}`);
}

function ensureR2(config) {
  const raw = wrangler(["r2", "bucket", "list"], { allowFail: true });
  const current = config.r2_buckets?.[0]?.bucket_name || NAME;
  let names = [];
  try {
    names = asList(parseJson(raw)).map((item) => item.name || item).filter(Boolean);
  } catch {
    names = [];
  }
  const exists = names.includes(NAME) || names.includes(current) || stripAnsi(raw).includes(NAME);
  if (!exists) {
    const created = wrangler(["r2", "bucket", "create", NAME], { allowFail: true });
    if (/already exists/i.test(created)) {
      console.log(`Using R2 ${NAME}`);
    } else {
      console.log(`Created R2 ${NAME}`);
    }
  } else {
    console.log(`Using R2 ${current === NAME ? NAME : current}`);
  }
  config.r2_buckets = [{ binding: "BUCKET", bucket_name: exists && names.includes(current) ? current : NAME }];
}

function migrate(config) {
  const db = config.d1_databases?.[0]?.database_name || NAME;
  for (const file of SCHEMA_FILES) {
    console.log(`Applying ${file}`);
    wrangler(["d1", "execute", db, "--remote", "--yes", "--file", join(root, file)]);
  }
}

const config = loadConfig();
const derived = syncDerived(config);

if (syncOnly) {
  saveConfig(config);
  console.log(`Synced route ${derived.host} and ${derived.locals.length} senders from wrangler.jsonc vars`);
  process.exit(0);
}

if (!migrateOnly) {
  config.name = NAME;
  config.account_id = resolveAccountId(config);
  ensureD1(config);
  ensureKv(config);
  ensureR2(config);
  saveConfig(config);
}

migrate(config);
console.log(`Ready. Hostname ${derived.host}. Next: npm run deploy`);
