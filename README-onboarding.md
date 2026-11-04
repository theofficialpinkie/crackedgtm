# Onboarding Engine (crackedgtm.ai/onboarding)

Private tool for onboarding Cracked GTM clients. The landing page is untouched: the Worker only runs for `/onboarding*` and `/api/*`. Everything else is still served as static files.

## Flow (one screen per client)
1. **Their website**: pulled automatically from the URL (homepage plus pricing, about, customers and product pages).
2. **Customer URLs**: one per line, or pulled from a client's Stripe restricted key.
3. **Team members + buyers**: for each customer, reads their site and finds leaders in Prospeo (1 credit each). You tick the real buyer.
4. **Patterns and ICP**: Claude finds patterns across customers (counted as "x of N" with domains), then builds the ICP with qualification and disqualification criteria.
5. **Leads**: pulls 25 people per click from Prospeo (1 credit), then scores every lead against the ICP with a hook. CSV export.
6. **Onboarding email**: drafted with the Stripe and guide links from Settings.

Extras: more evidence (won/lost calls, kickoff notes, new site copy), backtest, mega prompt, access checklist.

## One-time setup (Cloudflare dashboard > Workers > dry-bird-b050 > Settings > Variables and secrets)
Add these as **Secrets**:

| Name | What |
|---|---|
| `ONBOARDING_PASSWORD` | Shared team password. Required. |
| `ANTHROPIC_API_KEY` | From console.anthropic.com. Builds ICPs, patterns, scores. |
| `PROSPEO_API_KEY` | From app.prospeo.io > API. Team lookup and lead pulls. |

Optional variable `CLAUDE_MODEL` (default `claude-sonnet-5-5`).

Or from a terminal in this repo: `npx wrangler secret put ONBOARDING_PASSWORD` (repeat for each).

Data lives in a Durable Object (SQLite) created automatically on first deploy. No database to set up.

## Local dev
Create `.dev.vars` with `ONBOARDING_PASSWORD=...` (and the API keys if you want live calls), then `npx wrangler dev`.

# Fortune phone (crackedgtm.ai/fortune)

Live, password-protected demo of the Kalpa × Copi fortune phone, ported from `theofficialpinkie/magic-eight-phone`. Brief at `/fortune/brief`. Code in `worker/fortune/`, front-end and brief in `fortune/`.

Secrets (Cloudflare > Workers > dry-bird-b050 > Settings > Variables and secrets):

| Name | What |
|---|---|
| `FORTUNE_PASSWORD` | What viewers type at `/fortune/login`. 10+ characters, different from the admin token. Nothing under /fortune is served until it's set. |
| `FORTUNE_ADMIN_TOKEN` | 24+ random characters. Only `curl -H "Authorization: Bearer <token>" https://crackedgtm.ai/fortune/api/export` returns opted-in contacts. Never give it to viewers. |
| `OPENAI_API_KEY` | Live readings. Optional var `OPENAI_MODEL` (default `gpt-4o-mini`). |
| `KALPA_API_KEY`, `KALPA_VOICE_ID`, `KALPA_MODEL` | Optional voice. Text works without them. |

Sessions last 12 hours; `/fortune/logout` revokes. Contacts and logins live in the same Durable Object as the onboarding tool (kinds `fortune_session`, `fortune_login`, `fortune_throttle`). Phone/Twilio routes are not ported yet; add them (signature-checked, outside the password) when the handset is tested.
