# Compart Mail

Webmail as a Cloudflare Worker. Inbound mail uses Email Routing. Metadata is in D1, bodies in R2, hot lists in KV. Sign-in is Cloudflare Access only.

All app config lives in **one file**: `wrangler.jsonc`. Do not edit `routes` or `send_email`. They are written from `vars`.

## 1. `wrangler.jsonc` `vars`

```jsonc
"vars": {
  "MAIL_DOMAIN": "example.com",
  "SEED_MAILBOXES": "hello,contact,info",
  "APP_NAME": "Example Mail"
}
```

Hostname is `mail.<MAIL_DOMAIN>`. Inboxes are `hello@example.com`, … Worker, D1, KV, and R2 are named `compart-mail`.

If you have more than one Cloudflare account, set `account_id` in the same file. One account is taken from `wrangler login`.

## 2. `npm run setup`

```bash
npm ci
npx wrangler login
npm run setup
```

You do not create D1, KV, or R2 in the dashboard. `setup` does that on the logged-in account:

- creates D1, KV, and R2 named `compart-mail` if they are missing
- writes `account_id`, `database_id`, and KV `id` into `wrangler.jsonc`
- writes `routes` and `send_email` from `vars`
- applies the D1 schema

If those resources already exist, it reuses them.

## 3. Cloudflare Access

**Zero Trust → Access → Applications → Add → Self-hosted**

1. Domain: `mail.example.com`
2. Policy: **Allow** → **Emails** (who may open the panel)
3. Put `CF_ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) and `CF_ACCESS_AUD` into `vars`

PWA chrome (`/manifest.webmanifest`, `/icons`, `/favicon.svg`, `/sw.js`, `/theme-boot.js`) is fetched without the Access cookie. Add Bypass / Everyone apps for those paths if you want install-to-home-screen.

## 4. Email Routing and Sending

On the `MAIL_DOMAIN` zone:

1. Enable **Email Routing**. Add the MX / SPF records Cloudflare shows.
2. Catch-all cannot target a Worker. One rule per inbox → **Send to Worker** `compart-mail`.
3. Enable **Email Sending**. Add the DKIM / bounce records Cloudflare shows.

## 5. Web push

New mail can notify the browser. That uses a VAPID key pair. The public key goes in `vars.VAPID_PUBLIC_KEY`. The private key is a Worker secret, not a git file.

Do not reuse the keys already in this repo. Generate your own:

```bash
node scripts/generate-vapid.mjs
npx wrangler secret put VAPID_PRIVATE_KEY
```

Paste the printed public key into `vars.VAPID_PUBLIC_KEY`. Put the private key from `.vapid.json` into the secret prompt. Do not commit `.vapid.json`.

## 6. Deploy

```bash
npm run deploy
```

```bash
npm run dev          # Vite UI only. APIs need the Worker.
npx wrangler dev     # Worker + bindings; run npm run build first
npx wrangler tail
```
