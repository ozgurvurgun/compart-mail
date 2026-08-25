# Rheia Mail (`mail.rheias.com`)

Same setup as Shortena (`env.shortena` in this repo). Source of truth is this repo; deploy with `--env rheias`.

## Deploy

```bash
npm ci
npm run db:migrate:rheias
npm run db:migrate-perf:rheias
npm run db:migrate-contacts:rheias
npm run db:migrate-templates:rheias
npm run db:migrate-push:rheias
printf '%s' '<private-key>' | npx wrangler secret put VAPID_PRIVATE_KEY --env rheias
npm run deploy:rheias
```

## Cloudflare Access

**Zero Trust → Access → Applications → Self-hosted**

- Domain: `mail.rheias.com`
- Policy: **Allow** → Emails (allowlist)

Copy **Application Audience (AUD)** into `wrangler.jsonc` → `env.rheias.vars.CF_ACCESS_AUD`.  
Or read from login redirect `kid=` on `https://mail.rheias.com`.

Team: `morning-snowflake-05e9.cloudflareaccess.com`

No separate Bypass apps (same as `mail.shortena.com`).

## Email Routing (`rheias.com`)

- `hello@rheias.com` → worker **`rheias-mail`**
- `send_email` allowlist: `hello@rheias.com`

## Admin panel

Rheiasart Studio links to Mail ↗ (`https://mail.rheias.com`). No embedded mail in `/admin`.
