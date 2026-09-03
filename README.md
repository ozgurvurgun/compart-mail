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

## 2. Create Cloudflare resources

```bash
npm ci
npx wrangler login
npm run setup
```

Creates D1 / KV / R2 if they are missing, writes IDs into `wrangler.jsonc`, applies schema.

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

## 5. Deploy

```bash
npm run deploy
```

```bash
npm run dev          # Vite UI only. APIs need the Worker.
npx wrangler dev     # Worker + bindings; run npm run build first
npx wrangler tail
```

## Web Push (optional)

```bash
node scripts/generate-vapid.mjs
npx wrangler secret put VAPID_PRIVATE_KEY
```

Put the printed public key in `vars.VAPID_PUBLIC_KEY`. Do not commit `.vapid.json`.
