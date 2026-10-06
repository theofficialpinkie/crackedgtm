// Cracked GTM Onboarding Engine backend.
// Serves the static landing page untouched; only /onboarding* and /api/* run through this Worker.
//
// Secrets (set with `npx wrangler secret put NAME` or in the Cloudflare dashboard):
//   ONBOARDING_PASSWORD  shared password for you and Khaled (required)
//   ANTHROPIC_API_KEY    builds the ICP, scores leads, runs backtests
//   PROSPEO_API_KEY      live list building
// Optional var: CLAUDE_MODEL (defaults below)

import { DurableObject } from "cloudflare:workers";

const DEFAULT_MODEL = "claude-sonnet-5-5";           // judgment steps: patterns, ICP, translation, source planning
const DEFAULT_FAST_MODEL = "claude-haiku-4-5-20251001"; // volume steps: scoring, reading source pages
// $ per million tokens: [input, output, cache write, cache read]
const PRICES = { "claude-opus-5-5": [4, 20, 5, 0.2], "claude-sonnet-5-5": [2, 10, 2.5, 0.2], "claude-haiku-4-5": [1, 5, 1.25, 0.1], "claude-haiku-4-5-20251001": [1, 5, 1.25, 0.1], "claude-fable-5-1": [10, 50, 12.5, 0.25] };
function costOf(model, u = {}) {
  const p = PRICES[model] || PRICES[DEFAULT_MODEL];
  const tok = ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_creation_input_tokens || 0) * p[2] + (u.cache_read_input_tokens || 0) * p[3]) / 1e6;
  return tok + (u.server_tool_use?.web_search_requests || 0) * 0.01;
}
const modelFor = (env, tier) => tier === "fast" ? (env.CLAUDE_FAST_MODEL || DEFAULT_FAST_MODEL) : (env.CLAUDE_MODEL || DEFAULT_MODEL);
const COOKIE = "cgtm_session";
const SESSION_DAYS = 90;

/* ---------------- storage: one Durable Object with SQLite ---------------- */
export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS docs (
      kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (kind, id))`);
  }
  list(kind) {
    return this.sql.exec("SELECT id, data, updated_at FROM docs WHERE kind = ? ORDER BY updated_at DESC", kind)
      .toArray().map(r => ({ id: r.id, ...JSON.parse(r.data), updatedAt: r.updated_at }));
  }
  get(kind, id) {
    const r = this.sql.exec("SELECT data, updated_at FROM docs WHERE kind = ? AND id = ?", kind, id).toArray()[0];
    return r ? { id, ...JSON.parse(r.data), updatedAt: r.updated_at } : null;
  }
  put(kind, id, data) {
    const at = new Date().toISOString();
    const { id: _i, updatedAt: _u, ...rest } = data || {};
    this.sql.exec("INSERT INTO docs (kind, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      kind, id, JSON.stringify(rest), at);
    return { id, ...rest, updatedAt: at };
  }
  del(kind, id) { this.sql.exec("DELETE FROM docs WHERE kind = ? AND id = ?", kind, id); return true; }
}
const store = env => env.STORE.get(env.STORE.idFromName("main"));

/* ---------------- helpers ---------------- */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const fail = (status, error, extra = {}) => json({ error, ...extra }, status);
const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
async function makeSession(env) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return exp + "." + await hmac(env.ONBOARDING_PASSWORD, "session:" + exp);
}
async function validSession(req, env) {
  if (!env.ONBOARDING_PASSWORD) return false;
  const c = (req.headers.get("cookie") || "").split(/;\s*/).find(x => x.startsWith(COOKIE + "="));
  if (!c) return false;
  const [exp, sig] = c.slice(COOKIE.length + 1).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return timingSafeEqual(sig, await hmac(env.ONBOARDING_PASSWORD, "session:" + exp));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const arr2 = v => Array.isArray(v) ? v : [];
// app.acme.com -> acme.com, shop.acme.co.uk -> acme.co.uk; returns "" for anything that isn't a hostname
function rootDomain(s) {
  s = String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/?#:\s]/)[0];
  if (!/^([a-z0-9-]+\.)+[a-z]{2,24}$/.test(s)) return "";
  const parts = s.split(".");
  const sld = parts[parts.length - 2];
  const keep = parts[parts.length - 1].length === 2 && ["co", "com", "org", "net", "ac", "gov", "edu"].includes(sld) ? 3 : 2;
  return parts.slice(-keep).join(".");
}
const safeId = s => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(s || ""));

// Close a JSON value that was cut off mid-way: drop the unfinished tail back to the last complete
// item, then add the missing closing brackets. Returns null if nothing usable is left.
function repairTruncatedJSON(text) {
  let s = String(text || "");
  const start = s.search(/[\[{]/); if (start < 0) return null;
  s = s.slice(start);
  for (let cut = s.length; cut > 1; ) {
    const head = s.slice(0, cut);
    const stack = []; let inStr = false, esc = false;
    for (const ch of head) {
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === "{" || ch === "[") stack.push(ch); else if (ch === "}" || ch === "]") stack.pop();
    }
    if (!inStr) {
      const body = head.replace(/[,:\s]+$/, "");
      const closed = body + stack.reverse().map(ch => ch === "{" ? "}" : "]").join("");
      try { return JSON.parse(closed); } catch {}
    }
    const prev = Math.max(head.lastIndexOf("},", cut - 2), head.lastIndexOf("],", cut - 2), head.lastIndexOf('",', cut - 2));
    if (prev <= 0) return null;
    cut = prev + 1;
  }
  return null;
}
function extractJSON(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const s = Math.min(...["{", "["].map(ch => { const i = t.indexOf(ch); return i < 0 ? Infinity : i; }));
  const e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (s !== Infinity && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
  return null;
}

/* ---------------- Claude ---------------- */
// prefix: the part of the prompt that repeats across calls (criteria, patterns). It's marked for
// prompt caching, so repeat calls within 5 minutes pay 10% for it instead of full price.
async function askClaude(env, prompt, { maxTokens = 8000, system, tier = "smart", prefix = "" } = {}) {
  if (!env.ANTHROPIC_API_KEY) throw { status: 503, error: "ANTHROPIC_API_KEY is not set on the Worker. Add it in Cloudflare > Workers > Settings > Variables and secrets." };
  const model = modelFor(env, tier);
  const content = prefix ? [{ type: "text", text: prefix, cache_control: { type: "ephemeral" } }, { type: "text", text: prompt }] : prompt;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      system: system || "You are a precise GTM research analyst. When asked for JSON, reply with one valid JSON value and nothing else.",
      messages: [{ role: "user", content }],
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw { status: 502, error: "Claude API error: " + (body?.error?.message || r.status) };
  const text = (body.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return { text, stop: body.stop_reason, usage: body.usage, model, cost: costOf(model, body.usage) };
}

/* ---------------- website pull ---------------- */
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/section|\/header|\/footer|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};
// Reads one page. Order: our own site from static assets (a Worker can't fetch its own
// domain), then a normal fetch, then a reader service that renders JavaScript and gets
// past most bot walls. Returns {text, links, via} or null.
async function readPage(url, env, selfHost) {
  const u = new URL(url);
  const bare = h => h.replace(/^www\./, "");
  if (selfHost && bare(u.hostname) === bare(selfHost) && env.ASSETS) {
    let r = await env.ASSETS.fetch(new Request(u.href));
    for (let k = 0; k < 3 && r.status >= 300 && r.status < 400 && r.headers.get("location"); k++) r = await env.ASSETS.fetch(new Request(new URL(r.headers.get("location"), u).href));
    if (r.ok) { const html = await r.text(); return { text: htmlToText(html), links: htmlLinks(html, u), via: "site" }; }
  }
  try {
    const r = await fetch(u.href, { headers: BROWSER_HEADERS, redirect: "follow", cf: { cacheTtl: 300 } });
    if (r.ok && (r.headers.get("content-type") || "").includes("html")) {
      const html = await r.text(); const text = htmlToText(html);
      if (text.length > 400) return { text, links: htmlLinks(html, new URL(r.url || u.href)), via: "direct" };
    }
  } catch {}
  try {
    const r = await fetch("https://r.jina.ai/" + u.href, { headers: { accept: "text/plain", "x-return-format": "markdown" } });
    if (r.ok) {
      const md = await r.text();
      if (md.trim().length > 200) {
        const links = [...md.matchAll(/\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]);
        return { text: md.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\]\((https?:[^)]+)\)/g, "]").replace(/\n{3,}/g, "\n\n").trim(), links, via: "reader" };
      }
    }
  } catch {}
  return null;
}
function htmlLinks(html, base) {
  return [...String(html).matchAll(/href="([^"#]+)"/gi)].map(m => { try { return new URL(m[1], base).href; } catch { return null; } }).filter(Boolean);
}
async function pullSite(rawUrl, env, selfHost) {
  let base;
  try { base = new URL(/^https?:\/\//.test(rawUrl) ? rawUrl : "https://" + rawUrl); } catch { throw { status: 400, error: "That website address doesn't look valid." }; }
  if (!/^https?:$/.test(base.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(base.hostname)) throw { status: 400, error: "Only public websites can be pulled." };
  const home = await readPage(base.href, env, selfHost);
  if (!home) throw { status: 422, error: "Couldn't read " + base.hostname + " directly or through the page reader. Paste the copy instead." };
  // Follow a few internal pages: high-signal ones first, then other top-level pages
  const want = /\/(pricing|about|customers?|case|stor|product|solutions?|features|why|platform|use-cases?)/i;
  const skip = /\.(png|jpe?g|svg|gif|webp|ico|css|js|pdf|xml|json)$|\/(blog|careers|jobs|legal|privacy|terms|login|signin|signup)/i;
  const bare = h => h.replace(/^www\./, "");
  const internal = [...new Set(home.links)].filter(l => { try { const x = new URL(l); return bare(x.hostname) === bare(base.hostname) && x.pathname.length > 1 && !skip.test(x.pathname); } catch { return false; } });
  const extra = [...internal.filter(l => want.test(new URL(l).pathname)), ...internal.filter(l => !want.test(new URL(l).pathname) && new URL(l).pathname.split("/").filter(Boolean).length === 1)].slice(0, 4);
  const pages = [{ url: base.href, text: home.text, via: home.via }];
  for (const u of extra) { const p = await readPage(u, env, selfHost).catch(() => null); if (p) pages.push({ url: u, text: p.text, via: p.via }); }
  const text = pages.map(p => `## ${p.url}\n${p.text.slice(0, 7000)}`).join("\n\n");
  return { pages: pages.map(p => p.url), via: [...new Set(pages.map(p => p.via))], text };
}

/* ---------------- Stripe pull (client's restricted read-only key) ---------------- */
async function pullStripe(key) {
  if (!/^(rk|sk)_(live|test)_/.test(key || "")) throw { status: 400, error: "Use a Stripe restricted key with read access to Customers (starts with rk_live_)." };
  const rows = []; let after = null;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ limit: "100" }); if (after) q.set("starting_after", after);
    const r = await fetch("https://api.stripe.com/v1/customers?" + q, { headers: { authorization: "Bearer " + key } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw { status: 502, error: "Stripe said: " + (body?.error?.message || r.status) };
    for (const c of body.data || []) rows.push([c.name || "", c.email || "", (c.description || "").replace(/[\n,]/g, " "), c.created ? new Date(c.created * 1000).toISOString().slice(0, 10) : ""]);
    if (!body.has_more || !body.data?.length) break;
    after = body.data[body.data.length - 1].id;
  }
  const csv = ["Name,Email,Description,Created", ...rows.map(r => r.map(v => /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(","))].join("\n");
  return { count: rows.length, csv };
}

/* ---------------- Prospeo ---------------- */
async function prospeoSearch(env, body) {
  if (!env.PROSPEO_API_KEY) throw { status: 503, error: "PROSPEO_API_KEY is not set on the Worker." };
  const r = await fetch("https://api.prospeo.io/search-person", {
    method: "POST",
    headers: { "X-KEY": env.PROSPEO_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (data.error_code === "NO_RESULTS") return { results: [], pagination: { total_count: 0 } };
  if (!r.ok || data.error) throw { status: 502, error: "Prospeo said: " + ([data.error_code, data.filter_error, data.message].filter(Boolean).join(" · ") || r.status), detail: data };
  return data;
}

/* ---------------- router ---------------- */
const LOGIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cracked GTM Onboarding</title><meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@500;700&display=swap" rel="stylesheet">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FDFCF7;color:#111;font-family:Archivo,system-ui,sans-serif;padding:16px}
form{width:100%;max-width:380px;border:3px solid #111;box-shadow:10px 10px 0 #D7191F;background:#fff;padding:28px;display:flex;flex-direction:column;gap:14px}
h1{margin:0;font-family:'Archivo Black',sans-serif;font-size:28px;letter-spacing:-.03em}input{font:inherit;padding:12px;border:2px solid #111}
button{font-family:'Archivo Black',sans-serif;font-size:16px;padding:14px;background:#111;color:#FDFCF7;border:3px solid #111;box-shadow:5px 5px 0 #D7191F;cursor:pointer}p{margin:0;font-size:14px;color:#D7191F;min-height:1.2em}</style></head>
<body><form id="f"><h1>Cracked GTM<br>Onboarding Engine</h1><label for="pw">Team password</label><input id="pw" type="password" autocomplete="current-password" required autofocus><button>Sign in</button><p id="err"></p></form>
<script>f.onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw.value})});if(r.ok)location.reload();else{const b=await r.json().catch(()=>({}));err.textContent=b.error||'Wrong password';}};</script></body></html>`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/api/login" && req.method === "POST") {
        if (!env.ONBOARDING_PASSWORD) return fail(503, "Set the ONBOARDING_PASSWORD secret on the Worker first.");
        const { password } = await req.json().catch(() => ({}));
        if (!password || !timingSafeEqual(await hmac("cmp", password), await hmac("cmp", env.ONBOARDING_PASSWORD))) return fail(401, "Wrong password");
        return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=${await makeSession(env)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` });
      }
      if (path === "/api/logout") return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });

      const authed = await validSession(req, env);

      if (path === "/onboarding" || path.startsWith("/onboarding/")) {
        if (!authed) return new Response(LOGIN_HTML, { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
        if (path === "/onboarding") return Response.redirect(url.origin + "/onboarding/", 301);
        const res = await env.ASSETS.fetch(req);
        const out = new Response(res.body, res);
        out.headers.set("cache-control", "no-store"); out.headers.set("x-robots-tag", "noindex");
        return out;
      }

      if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);
      if (!authed) return fail(401, "Signed out. Reload the page and sign in.");

      const s = store(env);
      const m = path.match(/^\/api\/clients\/([^/]+)$/);

      if (path === "/api/status") return json({ claude: !!env.ANTHROPIC_API_KEY, prospeo: !!env.PROSPEO_API_KEY, model: env.CLAUDE_MODEL || DEFAULT_MODEL });
      if (path === "/api/clients" && req.method === "GET") return json(await s.list("client"));
      if (m) {
        if (!safeId(m[1])) return fail(400, "Bad client id");
        if (req.method === "GET") { const c = await s.get("client", m[1]); return c ? json(c) : fail(404, "Client not found"); }
        if (req.method === "PUT") {
          const body = await req.text();
          if (body.length > 900_000) return fail(413, "Client record is too large. Trim the pasted inputs.");
          return json(await s.put("client", m[1], JSON.parse(body)));
        }
        if (req.method === "DELETE") return json({ ok: await s.del("client", m[1]) });
      }
      if (path === "/api/settings") {
        if (req.method === "GET") return json((await s.get("settings", "main")) || {});
        if (req.method === "PUT") return json(await s.put("settings", "main", await req.json()));
      }
      if (path === "/api/claude" && req.method === "POST") {
        const { prompt, maxTokens, expectJson = true, tier = "smart", prefix = "" } = await req.json();
        if (!prompt || prompt.length > 400_000) return fail(400, "Prompt missing or too long");
        // If the answer runs out of room, retry once with double the room and a "be concise" instruction.
        // If it's still cut off, salvage every complete item from the partial JSON instead of failing.
        let budget = Math.min(Math.max(Number(maxTokens) || 8000, 4000), 32000);
        let out = await askClaude(env, prompt, { maxTokens: budget, tier, prefix }); let cost = out.cost;
        if (!expectJson) return json({ text: out.text, stop: out.stop });
        let parsed = extractJSON(out.text);
        if (parsed == null && out.stop === "max_tokens") {
          budget = Math.min(budget * 2, 32000);
          out = await askClaude(env, prompt + "\n\nKeep it tight: every string under 25 words, no extra fields. The JSON must be complete.", { maxTokens: budget, tier, prefix }); cost += out.cost;
          parsed = extractJSON(out.text);
        }
        let salvaged = false;
        if (parsed == null && out.stop === "max_tokens") { parsed = repairTruncatedJSON(out.text); salvaged = parsed != null; }
        if (parsed == null) return fail(502, out.stop === "max_tokens" ? "Claude's answer was still too long after a retry. Try again; if it repeats, remove a few customers or sources." : "Claude's answer didn't parse as JSON. Retry.", { raw: out.text.slice(0, 2000), cost });
        return json({ data: parsed, stop: out.stop, usage: out.usage, salvaged, cost, model: out.model });
      }
      if (path === "/api/pull-site" && req.method === "POST") {
        const { url: u } = await req.json(); return json(await pullSite(u, env, url.hostname));
      }
      if (path === "/api/research-customer" && req.method === "POST") {
        // One customer: read their site and find their leadership team in Prospeo.
        const { domain } = await req.json();
        const out = { domain, site: "", siteError: "", people: [], peopleError: "", company: null };
        try { const r = await pullSite(domain, env, url.hostname); out.site = r.text.slice(0, 6000); } catch (e) { out.siteError = e.error || "Couldn't read site"; }
        if (env.PROSPEO_API_KEY) {
          try {
            const d = await prospeoSearch(env, { page: 1, filters: {
              company: { websites: { include: [rootDomain(domain) || domain] } },
              person_seniority: { include: ["Founder/Owner", "C-Suite", "Partner", "Vice President", "Head", "Director"] },
            } });
            out.people = (d.results || []).slice(0, 25); out.credits = (d.results || []).length && !d.free ? 1 : 0;
            out.total = d.pagination?.total_count;
          } catch (e) { out.peopleError = e.error || "Prospeo search failed"; }
        } else out.peopleError = "PROSPEO_API_KEY is not set, so team members can't be looked up.";
        return json(out);
      }
      if (path === "/api/enrich-buyer" && req.method === "POST") {
        // Full buyer profile from a LinkedIn URL: title, seniority, departments, location, job history.
        const { linkedin } = await req.json();
        if (!/linkedin\.com\/in\//i.test(linkedin || "")) return fail(400, "Use a LinkedIn profile URL like linkedin.com/in/name.");
        if (!env.PROSPEO_API_KEY) return fail(503, "PROSPEO_API_KEY is not set on the Worker.");
        const r = await fetch("https://api.prospeo.io/enrich-person", {
          method: "POST",
          headers: { "X-KEY": env.PROSPEO_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ data: { linkedin_url: linkedin.trim() } }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) return fail(502, d.error_code === "NO_MATCH" ? "Prospeo couldn't find that LinkedIn profile." : "Prospeo said: " + (d.error_code || d.message || r.status));
        return json({ person: d.person || null, company: d.company || null, credits: !d.free_enrichment && d.person?.email?.email ? 1 : 0 });
      }
      if (path === "/api/pull-stripe" && req.method === "POST") {
        const { key } = await req.json(); return json(await pullStripe(key));
      }
      if (path === "/api/research-source" && req.method === "POST") {
        // FAST (default): the server reads the source like a browser (the reader renders JavaScript),
        // follows its own listing/pagination links without AI, then a small model reads the compact
        // text once per chunk and extracts companies. No AI-driven browsing, so it costs cents.
        // DEEP: the old agent (web search + web fetch), capped, for sources the fast path can't read.
        if (!env.ANTHROPIC_API_KEY) return fail(503, "ANTHROPIC_API_KEY is not set on the Worker.");
        const { source, brief, exclude = [], limit = 30, mode = "fast" } = await req.json();
        if (!source?.url && !source?.query) return fail(400, "Source needs a URL or a search query.");
        const max = Math.min(Number(limit) || 30, 50);
        const ask = `SIGNAL WE'RE TRACKING: ${source.signal || ""}
SOURCE: ${source.name || ""} ${source.url || ""}
WHAT TO EXTRACT: ${source.extract || "company name, website, and the evidence of the signal with a date"}
WHO WE'RE LOOKING FOR:
${String(brief || "").slice(0, 3000)}
Skip these existing customers: ${exclude.slice(0, 150).join(", ") || "none"}
Rules: only companies you see evidence for on the page; never invent companies or websites (leave website empty if not shown); prefer the most recent signals; rate fit 0-100 against WHO WE'RE LOOKING FOR from what the page says, with a one-line why; at most ${max} companies, best fit first.
Reply with only: {"companies":[{"company":"","website":"","signal":"","evidence":"","evidence_url":"","what_they_do":"","fit":0,"why":""}],"notes":""}`;
        let cost = 0, pages = [], searches = 0, fetches = 0;

        if (mode === "fast") {
          if (source.url) {
            const first = await readPage(source.url, env, url.hostname).catch(() => null);
            if (first) {
              pages.push({ url: source.url, text: first.text, via: first.via });
              // Follow up to 3 pagination / listing links on the same site, no AI involved
              const base = new URL(source.url);
              const more = [...new Set(first.links || [])].filter(l => { try { const x = new URL(l); return x.hostname === base.hostname && x.href !== base.href && /([?&](page|p|batch|offset|cursor)=|\/page\/\d|\/(companies|portfolio|startups|batch|cohort|directory|list)\b)/i.test(x.pathname + x.search); } catch { return false; } }).slice(0, 3);
              for (const l of more) { const p = await readPage(l, env, url.hostname).catch(() => null); if (p) pages.push({ url: l, text: p.text, via: p.via }); }
            }
          }
          if (!pages.length && source.query) {
            // No page to read: one capped search with the small model
            const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
              body: JSON.stringify({ model: modelFor(env, "fast"), max_tokens: 6000, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }], messages: [{ role: "user", content: `Search for: ${source.query}\n\n${ask}` }] }) });
            const b = await r.json().catch(() => ({}));
            if (!r.ok) return fail(502, "Claude API error: " + (b?.error?.message || r.status));
            cost += costOf(modelFor(env, "fast"), b.usage); searches = b.usage?.server_tool_use?.web_search_requests || 0;
            const txt = (b.content || []).filter(x => x.type === "text").map(x => x.text).join("");
            const parsed = extractJSON(txt) || repairTruncatedJSON(txt);
            return json({ companies: arr2(parsed?.companies), notes: parsed?.notes || "", mode, pages: 0, searches, cost });
          }
          if (!pages.length) return fail(422, "Couldn't read this source. Try Deep research, or replace it with a direct listing URL.");
          // Trim each page to the useful part and read in chunks with the small model
          const textAll = pages.map(p => `## PAGE: ${p.url}\n${p.text.replace(/\n{2,}/g, "\n").slice(0, 14000)}`).join("\n\n");
          const chunks = []; for (let k = 0; k < textAll.length && chunks.length < 4; k += 14000) chunks.push(textAll.slice(k, k + 14000));
          let companies = [], notes = [];
          for (const ch of chunks) {
            const out = await askClaude(env, "PAGE TEXT:\n" + ch, { maxTokens: 6000, tier: "fast", prefix: "You extract companies showing a buying signal from page text a browser captured.\n" + ask });
            cost += out.cost;
            const parsed = extractJSON(out.text) || repairTruncatedJSON(out.text);
            companies = companies.concat(arr2(parsed?.companies)); if (parsed?.notes) notes.push(parsed.notes);
          }
          const seen = new Set(); companies = companies.filter(x => { const k = (x.website || x.company || "").toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => (b.fit || 0) - (a.fit || 0)).slice(0, max);
          return json({ companies, notes: notes.join(" ").slice(0, 400), mode, pages: pages.length, searches: 0, fetches: pages.length, cost, read: true });
        }

        // DEEP: capped agent
        let pageText = "";
        if (source.url) { const p = await readPage(source.url, env, url.hostname).catch(() => null); if (p) pageText = p.text.slice(0, 12000); }
        const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }, { type: "web_fetch_20250910", name: "web_fetch", max_uses: 3, max_content_tokens: 12000 }];
        let messages = [{ role: "user", content: `You are a lead researcher. Use web_search and web_fetch to find companies showing this signal from this source.\n${ask}\n\n${pageText ? "SOURCE PAGE (pre-read, may be partial):\n" + pageText : ""}` }];
        let text = "", turns = 0; const model = modelFor(env, "fast");
        while (turns++ < 3) {
          const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 10000, tools, messages }) });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) return fail(502, "Claude API error: " + (body?.error?.message || r.status));
          cost += costOf(model, body.usage);
          for (const b of body.content || []) { if (b.type === "server_tool_use") b.name === "web_search" ? searches++ : fetches++; if (b.type === "text") text += b.text; }
          if (body.stop_reason === "pause_turn") { messages = [...messages, { role: "assistant", content: body.content }]; continue; }
          break;
        }
        const tail = text.slice(text.lastIndexOf('{"companies"') >= 0 ? text.lastIndexOf('{"companies"') : 0);
        const parsed = extractJSON(tail) || repairTruncatedJSON(tail);
        if (!parsed || !Array.isArray(parsed.companies)) return fail(502, "Deep research didn't return a company list.", { cost });
        return json({ companies: parsed.companies, notes: parsed.notes || "", mode, searches, fetches, cost, read: !!pageText });
      }
      if (path === "/api/prospeo/people-at" && req.method === "POST") {
        // Buyers at specific companies (from signals): websites include + buyer-pattern titles/seniority
        if (!env.PROSPEO_API_KEY) return fail(503, "PROSPEO_API_KEY is not set on the Worker.");
        const { websites = [], titles = [], seniority = [], page = 1 } = await req.json();
        const sites = [...new Set(websites.map(rootDomain).filter(Boolean))].slice(0, 500);
        if (!sites.length) return fail(400, "No valid company websites to search.");
        const base = { company: { websites: { include: sites } } };
        const tries = [
          { ...base, ...(titles.length ? { person_job_title: { include: titles, match_mode: "CONTAINS" } } : {}), ...(seniority.length ? { person_seniority: { include: seniority } } : {}) },
          { ...base, ...(seniority.length ? { person_seniority: { include: seniority } } : { person_seniority: { include: ["Founder/Owner", "C-Suite"] } }) },
        ];
        let last = {};
        for (const filters of tries) {
          const r = await fetch("https://api.prospeo.io/search-person", { method: "POST", headers: { "X-KEY": env.PROSPEO_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ page, filters }) });
          const d = await r.json().catch(() => ({}));
          if (r.ok && !d.error) return json({ ...d, usedTitles: !!filters.person_job_title, credits: (d.results || []).length && !d.free ? 1 : 0 });
          last = d;
          if (d.error_code !== "NO_RESULTS" && d.error_code !== "INVALID_FILTERS") break;
          await new Promise(res => setTimeout(res, 1200));
        }
        if (last.error_code === "NO_RESULTS") return json({ results: [], pagination: { total_count: 0 } });
        return fail(502, "Prospeo said: " + ([last.error_code, last.filter_error].filter(Boolean).join(" · ") || "error"));
      }
      if (path === "/api/prospeo/suggest" && req.method === "POST") {
        // Free Prospeo lookup that returns location names exactly as Prospeo stores them
        if (!env.PROSPEO_API_KEY) return fail(503, "PROSPEO_API_KEY is not set on the Worker.");
        const { location } = await req.json();
        const r = await fetch("https://api.prospeo.io/search-suggestions", { method: "POST", headers: { "X-KEY": env.PROSPEO_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ location_search: String(location || "").slice(0, 100) }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) return fail(502, "Prospeo said: " + (d.error_code || r.status));
        return json({ location_suggestions: d.location_suggestions || [] });
      }
      if (path === "/api/prospeo/search" && req.method === "POST") {
        // Try the full search, then drop filters one at a time if Prospeo rejects it.
        // Every attempt and Prospeo's exact reply comes back so the page can show what happened.
        if (!env.PROSPEO_API_KEY) return fail(503, "PROSPEO_API_KEY is not set on the Worker.");
        const body = await req.json();
        const filters = { ...(body.filters || {}) };
        // Prospeo wants registrable domains (acme.com, not app.acme.com); drop anything malformed up front
        const cleanSites = list => [...new Set(arr2(list).map(rootDomain).filter(Boolean))];
        if (filters.company?.websites) {
          const w = filters.company.websites;
          filters.company = { websites: { ...(w.include ? { include: cleanSites(w.include) } : {}), ...(w.exclude ? { exclude: cleanSites(w.exclude) } : {}) } };
          if (!filters.company.websites.include?.length && !filters.company.websites.exclude?.length) delete filters.company;
        }
        const order = [null, "company_website_search", "company_job_posting_hiring_for", "company_headcount_growth", "person_job_change", "person_past_job_title", "company_type", "company_technology", "company_founded", "company_funding", "person_location_search", "company_location_search", "company_industry", "company_keywords", "person_time_in_current_role", "person_year_of_experience", "company_lookalike", "person_job_title", "company_headcount_range", "person_department", "person_seniority"];
        const attempts = [];
        const send = async () => {
          const sent = { page: body.page || 1, filters: JSON.parse(JSON.stringify(filters)) };
          if (attempts.length) await new Promise(r => setTimeout(r, 1500)); // stay under Prospeo's rate limit
          const r = await fetch("https://api.prospeo.io/search-person", { method: "POST", headers: { "X-KEY": env.PROSPEO_API_KEY, "content-type": "application/json" }, body: JSON.stringify(sent) });
          const raw = await r.text(); let d = {}; try { d = JSON.parse(raw); } catch {}
          return { r, d, raw, sent };
        };
        let k = 0, badSiteFixes = 0;
        while (k < order.length && attempts.length < 10) {
          const drop = order[k];
          if (drop && !filters[drop]) { k++; continue; }
          if (drop) delete filters[drop];
          const { r, d, raw, sent } = await send();
          const ok = r.ok && !d.error;
          attempts.push({ dropped: drop, status: r.status, ok, error_code: d.error_code || "", filter_error: d.filter_error || "", message: d.message || (ok ? "" : raw.slice(0, 300)), filters: Object.keys(sent.filters) });
          if (ok) return json({ ...d, attempts, credits: (d.results || []).length && !d.free ? 1 : 0 });
          if (d.error_code === "NO_RESULTS") return json({ results: [], pagination: { total_count: 0 }, attempts });
          if (["INVALID_API_KEY", "INSUFFICIENT_CREDITS"].includes(d.error_code) || r.status === 429 || /rate limit/i.test(d.error_code || "")) break;
          // A bad website in the include/exclude list: remove just that site and retry, keep every other filter
          const bad = /website format:\s*(\S+)/i.exec(d.filter_error || "");
          if (bad && filters.company?.websites && badSiteFixes < 5) {
            badSiteFixes++;
            const w = filters.company.websites; const b = bad[1].toLowerCase();
            for (const key of ["include", "exclude"]) if (w[key]) w[key] = w[key].filter(x => x.toLowerCase() !== b);
            attempts[attempts.length - 1].dropped = (drop ? drop + " + " : "") + "website " + b;
            continue; // same k, so no filter is dropped
          }
          k++;
        }
        const last = attempts[attempts.length - 1] || {};
        return json({ error: "Prospeo said: " + ([last.error_code, last.filter_error, last.message].filter(Boolean).join(" · ") || "HTTP " + last.status), attempts }, 502);
      }
      return fail(404, "Unknown endpoint");
    } catch (e) {
      if (e && e.status) return fail(e.status, e.error, e.detail ? { detail: e.detail } : {});
      return fail(500, "Server error: " + (e?.message || String(e)));
    }
  },
};
