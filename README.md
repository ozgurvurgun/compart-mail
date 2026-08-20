# Compart Mail

Self-hosted webmail on Cloudflare. Inbound mail hits a Worker through Email Routing. Metadata lives in D1. Bodies and attachments live in R2. Sessions and hot counters live in KV. Outbound mail uses the Email Sending binding.

The UI is a React SPA. **Sign-in is Cloudflare Access** (same model as Shortena Mail). There is no in-app email/password login.

**Repo:** [ozgurvurgun/compart-mail](https://github.com/ozgurvurgun/compart-mail)  
**Live:** [mail.compartsoftware.com](https://mail.compartsoftware.com)

Push to `main` deploys Compart Mail via GitHub Actions. Add repository secret `CLOUDFLARE_API_TOKEN` (Workers + D1 + KV + R2 edit). Shortena will use the same repo later as a second Wrangler environment.

## Architecture

```
Internet
  |  MX / Email Routing
  v
Worker  email()  -->  D1 (rows, FTS) + R2 (raw, html, attachments)
  |
  |  Browser HTTPS  (Cloudflare Access JWT)
  v
Worker  fetch()  -->  KV mailbox list, unread counts
                 -->  D1 queries
                 -->  R2 reads
                 -->  send_email
```

| Binding | Role |
| --- | --- |
| D1 | Mailboxes, messages, FTS5 search, contacts, push subscriptions |
| KV | Mailbox list, unread counts |
| R2 | RFC822, HTML, text bodies, attachments |
| send_email | Outbound SMTP via Cloudflare |
| Assets | Built SPA |

## Access setup

1. Zero Trust → Access → Applications → Add an application → Self-hosted
2. Hostname: `mail.compartsoftware.com`
3. Policy: the people who may open the mail panel
4. Copy the application **AUD** into `wrangler.jsonc` as `vars.CF_ACCESS_AUD`
5. Set `vars.CF_ACCESS_TEAM_DOMAIN` to your team host (`<team>.cloudflareaccess.com`)
6. Keep `workers_dev` and `preview_urls` false so Access cannot be bypassed on `*.workers.dev`

Then deploy:

```bash
npm run deploy
```

## What you need

- A Cloudflare account with Workers, D1, KV, R2, Email Routing, and Zero Trust
- `compartsoftware.com` on Cloudflare DNS
- Node 20+
- Wrangler 4.x (`npm i` in this folder)

## 1. Clone and configure

```bash
cd mail
npm install
```

Edit `wrangler.jsonc`:

- `name`: worker name
- `account_id`: Cloudflare account id
- `routes`: `mail.compartsoftware.com`
- `vars.MAIL_DOMAIN`: `compartsoftware.com`
- `vars.SEED_MAILBOXES`: comma list of local parts (`hello,contact,info,support`)
- `send_email.allowed_sender_addresses`: those same addresses
- `vars.CF_ACCESS_TEAM_DOMAIN` / `vars.CF_ACCESS_AUD`: from the Access app above

## 2. Create D1, KV, R2

```bash
npx wrangler d1 create compart-mail
npx wrangler kv namespace create KV
npx wrangler r2 bucket create compart-mail
```

Paste the printed `database_id` and KV `id` into `wrangler.jsonc`.

Apply schema:

```bash
npx wrangler d1 execute compart-mail --remote --file=./schema.sql
npx wrangler d1 execute compart-mail --remote --file=./schema-auth.sql
npx wrangler d1 execute compart-mail --remote --file=./schema-perf.sql
npx wrangler d1 execute compart-mail --remote --file=./schema-contacts.sql
npx wrangler d1 execute compart-mail --remote --file=./schema-push.sql
```

## 3. Email Routing and Sending

In the Cloudflare dashboard for `MAIL_DOMAIN`:

1. Email Routing: enable, add MX and SPF as prompted.
2. Add a destination Worker `compart-mail`.
3. Catch-all cannot target a Worker. Add one rule per inbox address (`hello@`, `contact@`, ...) action: Send to Worker.
4. Email Sending: enable for the same apex. Add the DKIM / bounce records Cloudflare shows.
5. Restrict `allowed_sender_addresses` in `wrangler.jsonc` to those inboxes.

## 4. Custom domain and deploy

```bash
npm run deploy
```

Point `mail.compartsoftware.com` as a Worker custom domain (already in `routes` if you set `custom_domain: true`).

Open the host, sign in through Access, send a test to `hello@compartsoftware.com`.

## Local notes

```bash
npm run dev          # Vite UI only. Worker APIs need wrangler.
npx wrangler dev     # Worker + bindings. Run npm run build first for assets.
```

D1 local vs remote: always pass `--remote` for production data.

## Security model

- Cloudflare Access JWT (`CF-Access-Jwt-Assertion` / `CF_Authorization`)
- Worker only accepts `mail.compartsoftware.com` (`workers_dev` off)
- Mutating requests require a matching Origin
- API responses: `Cache-Control: private, no-store`
- CSP, HSTS, frame deny, nosniff on every response
- Attachment filenames sanitized before `Content-Disposition`

## Layout

- `src/domain`: addresses, folders, messages
- `src/application`: use cases and ports
- `src/infrastructure`: D1, KV, R2, Email, HTTP, Access
- `src/ui`: React client
- `src/worker.ts`: composition root (`fetch` + `email`)

## Ops

```bash
npm run db:migrate
npm run db:migrate-auth
npx wrangler d1 execute compart-mail --remote --file=./schema-perf.sql
npx wrangler tail
```

Observability is on in `wrangler.jsonc`.

## License

Private unless you publish the repo with a license of your choice.
