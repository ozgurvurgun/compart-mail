# Compart Mail

Self-hosted webmail on Cloudflare. Inbound mail hits a Worker through Email Routing. Metadata lives in D1. Bodies and attachments live in R2. Hot lists live in KV. Outbound mail uses the Email Sending binding.

The UI is a React SPA. **Sign-in is Cloudflare Access only.** There is no in-app email/password login.

| | |
| --- | --- |
| Repo | [github.com/ozgurvurgun/compart-mail](https://github.com/ozgurvurgun/compart-mail) |
| Live | [mail.compartsoftware.com](https://mail.compartsoftware.com) |
| Worker | `compart-mail` |
| Account | `08d6ee75890a687e032ba5439dd5e1ae` (`compartsoftware35@gmail.com`) |
| Access team | `morning-snowflake-05e9.cloudflareaccess.com` |

## Day to day

This folder **is** the git repo. `main` is the source of truth.

```bash
git clone git@github.com:ozgurvurgun/compart-mail.git
cd compart-mail
npm ci
```

On this machine the SSH host alias `github.com-ozgurvurgun` is required (plain `github.com` uses another GitHub account):

```bash
git remote -v
# origin  git@github.com-ozgurvurgun:ozgurvurgun/compart-mail.git
```

Push to `main` → GitHub Actions builds and deploys `mail.compartsoftware.com`. You can also run **Actions → Deploy → Run workflow**.

Do not commit `.vapid.json`, `tokenn.txt`, `node_modules`, or `dist`.

## GitHub Actions (production deploy)

Workflow: `.github/workflows/deploy.yml`

1. Checkout, Node 22, `npm ci`, `npm run build`
2. `wrangler deploy` via `cloudflare/wrangler-action@v4`

### Secret

Repo → **Settings → Secrets and variables → Actions** → `CLOUDFLARE_API_TOKEN`

A Shortena SaaS/SSL token is **not** enough (zone SSL only). Create a dedicated token:

**Cloudflare → My Profile → API Tokens → Create Token → Custom token**

Name: `compart-mail-deploy`

| Scope | Resource | Access |
| --- | --- | --- |
| Account | Workers Scripts | Edit |
| Account | Workers KV Storage | Edit |
| Account | Workers R2 Storage | Edit |
| Account | D1 | Edit |
| Account | Account Settings | Read |
| Zone | Workers Routes | Edit |

- **Account Resources:** Include → `Compartsoftware35@gmail.com's Account`
- **Zone Resources:** Include → Specific zone → `compartsoftware.com`
- Leave **IP filtering** and **TTL** empty (GitHub Actions IPs change)

Without **Zone → Workers Routes → Edit**, the worker uploads and then fails with `Authentication error [code: 10000]` on `/zones/.../workers/routes`.

Paste the token only into the GitHub secret. Never into `wrangler.jsonc`, chat, or a committed file.

`VAPID_PRIVATE_KEY` is a **Wrangler secret on the worker**, not a GitHub secret. CI deploy does not overwrite it.

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
| D1 `compart-mail` | Mailboxes, messages, FTS5, contacts, push subscriptions |
| KV | Mailbox list, unread counts |
| R2 `compart-mail` | RFC822, HTML, text, attachments |
| send_email | Outbound via Cloudflare |
| Assets | Built SPA (`dist/`) |

`workers_dev` and `preview_urls` stay **false** so Access cannot be skipped on `*.workers.dev`. The worker only serves `mail.compartsoftware.com`.

## Cloudflare Access

Dashboard: **Zero Trust → Access → Applications**

1. **Add an application → Self-hosted**
2. Name: e.g. `mail`
3. Application domain: subdomain `mail` + `compartsoftware.com` → `mail.compartsoftware.com`
4. Session duration: 8–24 hours
5. **Policy** (this is identity, not the hostname):
   - Action: Allow
   - Include selector: **Emails** (or Emails ending in)
   - Value: the people who may open the panel (e.g. `compartsoftware35@gmail.com`)
   - A selector of just `mail` matches nobody
6. Save

Then copy into `wrangler.jsonc` `vars`:

- `CF_ACCESS_TEAM_DOMAIN` — e.g. `morning-snowflake-05e9.cloudflareaccess.com`
- `CF_ACCESS_AUD` — Application Audience tag on the app overview

If AUD is missing, open a private window at `https://mail.compartsoftware.com`. The Access login URL query `kid=` **is** the AUD.

Logout goes to `/cdn-cgi/access/logout`. `run_worker_first` intercepts `/cdn-cgi/access/*` and redirects to the team host.

After Access + worker vars are set, a private window should: Access login → mail panel (no password screen).

## First-time Cloudflare resources

Already created for production. Recreate only on a new account:

```bash
npm ci
npx wrangler d1 create compart-mail
npx wrangler kv namespace create KV
npx wrangler r2 bucket create compart-mail
```

Paste `database_id` and KV `id` into `wrangler.jsonc`. Set `account_id`, `routes`, `MAIL_DOMAIN`, `SEED_MAILBOXES`, `allowed_sender_addresses`, Access vars, VAPID public key.

Schema (production always `--remote`):

```bash
npm run db:migrate
npm run db:migrate-auth
npm run db:migrate-perf
npm run db:migrate-contacts
npm run db:migrate-push
```

## Email Routing and Sending

Cloudflare dashboard for `compartsoftware.com`:

1. **Email Routing:** enable; add MX and SPF as prompted.
2. Destination worker: `compart-mail`.
3. Catch-all **cannot** target a Worker. One rule per inbox: `hello@`, `contact@`, `info@`, `support@` → Send to Worker.
4. **Email Sending:** enable for the same apex. Add DKIM / bounce records Cloudflare shows.
5. Keep `send_email.allowed_sender_addresses` in `wrangler.jsonc` equal to those inboxes.

Test: Access sign-in, then send mail to `hello@compartsoftware.com`.

## Web Push (VAPID)

Public key lives in `wrangler.jsonc` as `VAPID_PUBLIC_KEY`. Private key is a worker secret:

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

Generate a new pair (writes gitignored `.vapid.json`):

```bash
node scripts/generate-vapid.mjs
```

Put the public key in `vars.VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` (`mailto:hello@compartsoftware.com`). Put only the private key into the Wrangler secret.

## Local

```bash
npm ci
npm run dev          # Vite UI only. APIs need the Worker.
npm run build
npx wrangler dev     # Worker + bindings; build first so `dist/` exists
npm run deploy       # local build + wrangler deploy (same as CI, uses your login/token)
npx wrangler tail
```

D1: production data needs `--remote`. `npm run db:migrate*` already pass `--remote`.

## Security

- Cloudflare Access JWT (`CF-Access-Jwt-Assertion` / `CF_Authorization`)
- Hostname allow-list: `mail.compartsoftware.com` only
- Mutating requests require matching `Origin`
- API: `Cache-Control: private, no-store`
- CSP, HSTS, frame deny, nosniff
- HTML bodies render in a sandboxed iframe (`allow-same-origin`, no scripts); height is measured from the document so marketing mail is not clipped
- Attachment filenames sanitized before `Content-Disposition`

## Layout

- `src/domain` — addresses, folders, messages
- `src/application` — use cases and ports
- `src/infrastructure` — D1, KV, R2, Email, HTTP, Access
- `src/ui` — React client
- `src/worker.ts` — `fetch` + `email` composition root
- `.github/workflows/deploy.yml` — production deploy

## License

Private unless you publish the repo with a license of your choice.
