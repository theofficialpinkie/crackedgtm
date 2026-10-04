// Cracked GTM Onboarding Engine backend.
// Serves the static landing page untouched; only /onboarding* and /api/* run through this Worker.
//
// Secrets (set with `npx wrangler secret put NAME` or in the Cloudflare dashboard):
//   ONBOARDING_PASSWORD  shared password for you and Khaled (required)
//   ANTHROPIC_API_KEY    builds the ICP, scores leads, runs backtests
//   PROSPEO_API_KEY      live list building
// Optional var: CLAUDE_MODEL (defaults below)

import { DurableObject } from "cloudflare:workers";

const DEFAULT_MODEL = "claude-sonnet-5-5";
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
const safeId = s => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(s || ""));

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
async function askClaude(env, prompt, { maxTokens = 8000, system } = {}) {
  if (!env.ANTHROPIC_API_KEY) throw { status: 503, error: "ANTHROPIC_API_KEY is not set on the Worker. Add it in Cloudflare > Workers > Settings > Variables and secrets." };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || DEFAULT_MODEL,
      max_tokens: maxTokens,
      system: system || "You are a precise GTM research analyst. When asked for JSON, reply with one valid JSON value and nothing else.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw { status: 502, error: "Claude API error: " + (body?.error?.message || r.status) };
  const text = (body.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return { text, stop: body.stop_reason, usage: body.usage };
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
  if (!r.ok || data.error) throw { status: 502, error: "Prospeo said: " + (data.error_code || data.message || data.filter_error || r.status), detail: data };
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
        const { prompt, maxTokens, expectJson = true } = await req.json();
        if (!prompt || prompt.length > 400_000) return fail(400, "Prompt missing or too long");
        const out = await askClaude(env, prompt, { maxTokens: Math.min(Number(maxTokens) || 8000, 16000) });
        if (!expectJson) return json({ text: out.text, stop: out.stop });
        const parsed = extractJSON(out.text);
        if (parsed == null) return fail(502, out.stop === "max_tokens" ? "Claude's answer was cut off. Trim the inputs and retry." : "Claude's answer didn't parse as JSON. Retry.", { raw: out.text.slice(0, 2000) });
        return json({ data: parsed, stop: out.stop, usage: out.usage });
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
              company: { websites: { include: [domain] } },
              person_seniority: { include: ["Founder/Owner", "C-Suite", "Partner", "Vice President", "Head", "Director"] },
            } });
            out.people = (d.results || []).slice(0, 25);
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
        return json({ person: d.person || null, company: d.company || null });
      }
      if (path === "/api/pull-stripe" && req.method === "POST") {
        const { key } = await req.json(); return json(await pullStripe(key));
      }
      if (path === "/api/prospeo/search" && req.method === "POST") {
        return json(await prospeoSearch(env, await req.json()));
      }
      return fail(404, "Unknown endpoint");
    } catch (e) {
      if (e && e.status) return fail(e.status, e.error, e.detail ? { detail: e.detail } : {});
      return fail(500, "Server error: " + (e?.message || String(e)));
    }
  },
};
