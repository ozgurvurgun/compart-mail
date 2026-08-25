import { MailApplication } from "./application/MailApplication";
import { AccessAuthenticator } from "./infrastructure/auth/AccessAuthenticator";
import { isAllowedHostname, isPublicAsset, mailHostname, requireAccessIdentity } from "./infrastructure/auth/requireAccess";
import { KvCache } from "./infrastructure/cache/KvCache";
import { CloudflareEmailSender } from "./infrastructure/email/CloudflareEmailSender";
import { handleApi } from "./infrastructure/http/handleApi";
import { withSecurityHeaders } from "./infrastructure/http/securityHeaders";
import { ingestInbound } from "./infrastructure/ingestInbound";
import { CachedContactRepository } from "./infrastructure/persistence/CachedContactRepository";
import { CachedMessageRepository } from "./infrastructure/persistence/CachedMessageRepository";
import { D1ContactRepository } from "./infrastructure/persistence/D1ContactRepository";
import { D1MessageRepository } from "./infrastructure/persistence/D1MessageRepository";
import { D1TemplateRepository } from "./infrastructure/persistence/D1TemplateRepository";
import { D1PushStore } from "./infrastructure/push/D1PushStore";
import { R2ObjectStore } from "./infrastructure/persistence/R2ObjectStore";

export type Env = {
  DB: D1Database;
  KV: KVNamespace;
  BUCKET: R2Bucket;
  EMAIL: ConstructorParameters<typeof CloudflareEmailSender>[0];
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  MAIL_DOMAIN: string;
  MAIL_HOSTNAME?: string;
  SEED_MAILBOXES: string;
  APP_NAME: string;
  FROM_DISPLAY_NAME?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

function appBranding(env: Env) {
  const appName = (env.APP_NAME || "Mail").trim() || "Mail";
  const domain = (env.MAIL_DOMAIN || "example.com").trim();
  return {
    appName,
    description: `Secure mail for ${domain}.`,
  };
}

function applyBranding(source: string, env: Env) {
  const { appName, description } = appBranding(env);
  let out = source
    .replaceAll("__APP_NAME__", appName)
    .replaceAll("__APP_DESCRIPTION__", description);
  // Keep build-time "Compart Mail" when env APP_NAME is unset (defaults to "Mail").
  if (appName !== "Mail") {
    out = out.replaceAll("Compart Mail", appName);
  }
  return out;
}

async function serveAssets(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/manifest.webmanifest") {
    const asset = await env.ASSETS.fetch(request);
    const body = applyBranding(await asset.text(), env);
    const headers = new Headers(asset.headers);
    headers.set("Content-Type", "application/manifest+json; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=300");
    return new Response(body, { status: asset.status, headers });
  }

  const asset = await env.ASSETS.fetch(request);
  const contentType = asset.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return asset;

  const html = applyBranding(await asset.text(), env);
  const headers = new Headers(asset.headers);
  headers.set("Cache-Control", "private, no-cache");
  return new Response(html, { status: asset.status, headers });
}

function compose(env: Env) {
  const kv = new KvCache(env.KV);
  const store = new R2ObjectStore(env.BUCKET);
  const messages = new CachedMessageRepository(new D1MessageRepository(env.DB, store), kv);
  const contacts = new CachedContactRepository(new D1ContactRepository(env.DB), kv);
  const templates = new D1TemplateRepository(env.DB);
  const fromDisplayName = env.FROM_DISPLAY_NAME || env.APP_NAME || "Compart Software";
  const sender = new CloudflareEmailSender(env.EMAIL, fromDisplayName);
  const accessConfigured = Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
  const auth = new AccessAuthenticator({
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN || "",
    audience: env.CF_ACCESS_AUD || "",
  });
  const app = new MailApplication(
    messages,
    contacts,
    templates,
    store,
    sender,
    auth,
    new D1PushStore(env.DB),
    {
      domain: env.MAIL_DOMAIN,
      seedMailboxes: (env.SEED_MAILBOXES || "hello,contact,info,support")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      appName: env.APP_NAME || "Mail",
      fromDisplayName,
      vapid:
        env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
          ? {
              publicKey: env.VAPID_PUBLIC_KEY,
              privateKey: env.VAPID_PRIVATE_KEY,
              subject: env.VAPID_SUBJECT || "mailto:hello@compartsoftware.com",
            }
          : undefined,
    },
  );
  return { app, auth, accessConfigured, messages };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!isAllowedHostname(url.hostname, mailHostname(env))) {
      return new Response("Not found", { status: 404 });
    }

    // run_worker_first intercepts /cdn-cgi/access/*; forward to the Access team host.
    if (url.pathname.startsWith("/cdn-cgi/access/")) {
      const team = env.CF_ACCESS_TEAM_DOMAIN;
      if (!team) return new Response("Not found", { status: 404 });
      const target = `https://${team}${url.pathname}${url.search}`;
      return Response.redirect(target, 302);
    }

    const { app, auth, accessConfigured } = compose(env);

    if (url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(await handleApi(request, app, auth, ctx, { accessConfigured }), true);
    }

    if (isPublicAsset(url.pathname)) {
      return withSecurityHeaders(await serveAssets(request, env));
    }

    const gate = await requireAccessIdentity(
      request,
      auth,
      accessConfigured,
      env.CF_ACCESS_TEAM_DOMAIN || "",
    );
    if (!gate.ok) {
      return withSecurityHeaders(gate.response);
    }

    return withSecurityHeaders(await serveAssets(request, env));
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const { app, messages } = compose(env);
    await app.seedMailboxes();
    const parsed = await ingestInbound(message, messages);
    ctx.waitUntil(
      app.notifyNewMail({
        from: parsed.from.name || parsed.from.address,
        subject: parsed.subject,
        mailbox: parsed.mailbox.value,
      }),
    );
  },
};
