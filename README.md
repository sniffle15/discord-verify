# discord-verify

Self-hosted Discord verification, deauthorization detection and member restore system — a private,
hardened alternative to RestoreCord.

- **Verification** — `/verify` runs an OAuth2 flow (`identify guilds.join`), stores the user with
  AES-256-GCM encrypted tokens, assigns the Verified role (adding the user to the guild if needed)
  and sends a confirmation DM.
- **Deauthorization detection** — a BullMQ sweep (every 30 min by default) probes every stored token
  against `GET /users/@me`. If Discord answers `401` and the refresh grant is rejected
  (`invalid_grant`), the member is marked `REVOKED`, their tokens are wiped, the role is removed and
  an audit entry is written.
- **Guild restore** — pull every authorized member into any guild via
  `PUT /guilds/{guild}/members/{user}` with token auto-refresh, queue-wide rate limiting, Discord 429
  handling and exponential backoff.
- **Admin dashboard** — Discord login restricted to `ADMIN_DISCORD_IDS`; metrics, searchable member
  list with manual actions, restore jobs, live audit log (SSE) and runtime settings.

## Architecture

```
            ┌────────── Caddy (TLS) ──────────┐
            │  /api/*  → api:4000             │
            │  /*      → web:3000 (Next.js)   │
            └─────────────────────────────────┘
api     Fastify HTTP server: OAuth flows, admin API, SSE audit stream
worker  BullMQ workers: token sweep / per-member checks, guild restore
bot     discord.js gateway: re-role on rejoin, /verify-panel command
postgres  members (encrypted tokens), audit_logs, restore_jobs, settings
redis     BullMQ queues, rate limits, OAuth state, admin sessions, pub/sub
```

`apps/api` holds all three backend processes (`src/server.ts`, `src/worker.ts`, `src/bot.ts`);
`apps/web` is the Next.js App Router frontend.

| Path | Purpose |
| --- | --- |
| `apps/api/prisma/schema.prisma` | Database schema |
| `apps/api/src/lib/crypto.ts` | AES-256-GCM token cipher with key rotation and context binding |
| `apps/api/src/http/routes/verify.ts` | Verification OAuth handler |
| `apps/api/src/http/oauth-state.ts` | Cookie + Redis bound, single-use OAuth `state` |
| `apps/api/src/workers/token-check.ts` | Deauthorization sweep worker |
| `apps/api/src/workers/restore.ts` | Guild restore worker |
| `apps/api/src/http/routes/admin/*` | Admin dashboard API |
| `apps/api/src/discord/rest.ts` | Rate-limit aware Discord REST client |

## Discord application setup

1. Create an application at <https://discord.com/developers/applications>.
2. **OAuth2 → Redirects**: add both
   - `${PUBLIC_URL}/api/verify/callback`
   - `${PUBLIC_URL}/api/auth/callback`
3. **Bot**: create the bot, copy the token, and enable the **Server Members Intent**
   (needed to re-assign the role when a verified member rejoins).
4. Invite the bot to your guild with `Manage Roles` and `Create Invite`:
   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=268435457`
5. In **Server Settings → Roles**, drag the bot's role **above** the Verified role.
6. After setup, use **Settings → Test configuration** in the dashboard to verify permissions and hierarchy,
   then run `/verify-panel` in a channel to post the verification button.

## Running locally

Requires Node.js ≥ 20.11 and Docker (for Postgres and Redis).

```bash
cp .env.example .env
npm run gen:key            # paste into ENCRYPTION_KEY
npm run gen:key            # paste into SESSION_SECRET
# fill in ADMIN_DISCORD_IDS and the DISCORD_* values

docker compose up -d postgres redis
npm install
npm run db:deploy          # apply migrations

npm run dev:api            # http://localhost:4000
npm run dev:worker
npm run dev:bot
npm run dev:web            # http://localhost:3000 (proxies /api to the API)
```

In development the browser talks to Next.js, which rewrites `/api/*` to the API, so keep
`TRUST_PROXY=1` (one hop: Next.js).

## Production (Docker Compose)

```bash
cp .env.example .env       # NODE_ENV=production, PUBLIC_URL=https://verify.example.com, strong passwords
DOMAIN=verify.example.com docker compose up -d --build
```

Caddy obtains TLS certificates automatically and routes `/api/*` straight to the API (`TRUST_PROXY=1`).
The `api` container applies migrations on start. Postgres and Redis are bound to `127.0.0.1` only.

## Security model

- **Tokens at rest**: `access_token` / `refresh_token` are encrypted with AES-256-GCM (random 96-bit IV,
  128-bit tag). Each ciphertext is bound to `member:<discordId>:<kind>` via additional authenticated data,
  so a ciphertext copied to another row fails to decrypt. Tokens are never selected into API responses
  (`memberPublicSelect`) and are redacted from logs.
- **Key rotation**: move the old key to `ENCRYPTION_KEYS_PREVIOUS`, set a new `ENCRYPTION_KEY`, run
  `npm run keys:rotate -w @dv/api`, then drop the old key.
- **Secrets in settings**: bot token and client secret saved from the dashboard are encrypted the same way
  and only exposed to the browser as `configured: true/false`.
- **OAuth CSRF**: 256-bit random `state` stored in a signed HttpOnly cookie *and* in Redis; the callback
  requires a constant-time match and consumes the Redis entry (`GETDEL`), so each state works once.
- **Admin auth**: Discord login checked against `ADMIN_DISCORD_IDS` (env only, re-checked on every request),
  server-side Redis sessions, per-session CSRF token required on every mutating request, plus an Origin check.
  The admin's OAuth token is revoked immediately after login.
- **Abuse protection**: `/api/verify/start` is limited to 5 attempts per 15 minutes per IP (Redis-backed, fails
  closed). Optional VPN/proxy blocking via proxycheck.io (`IP_INTEL_PROVIDER=proxycheck`). A coarse device
  fingerprint and the IP are stored only as keyed HMACs and used to flag possible alt accounts in the audit log.
- **No false revocations**: only `401` from `/users/@me` *after* a failed refresh, or an `invalid_grant` on
  refresh, revokes a member. Network errors, 5xx and `invalid_client` (our own misconfiguration) are retried
  or raise a system alert instead.
- **Concurrent refresh safety**: Discord rotates refresh tokens, so refreshes are serialized per member with a
  Redis lock and a re-read, preventing two processes from invalidating each other's tokens.
- **Graceful Discord failures**: missing permissions, role hierarchy problems, unknown members and closed
  DMs are classified and audited instead of crashing a flow.
- **Delete Data** revokes the OAuth grant at Discord, removes the role, deletes the member row and redacts
  their earlier audit entries.

## Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Build API (incl. Prisma client) and web |
| `npm run typecheck` | Type-check both apps |
| `npm test` | API unit tests (Vitest) |
| `npm run db:migrate` | Create a new migration in development |
| `npm run db:deploy` | Apply migrations |
| `npm run keys:rotate -w @dv/api` | Re-encrypt stored secrets with the active key |
