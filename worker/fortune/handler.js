// Fortune phone ("The Future Is Calling") at crackedgtm.ai/fortune.
// Ported from theofficialpinkie/magic-eight-phone server.js; the reading logic is unchanged.
//
// Worker secrets (Cloudflare > Workers > dry-bird-b050 > Settings > Variables and secrets):
//   FORTUNE_PASSWORD      password viewers type at /fortune/login (10+ chars, not the admin token)
//   FORTUNE_ADMIN_TOKEN   24+ chars; only this can call GET /fortune/api/export (Bearer)
//   OPENAI_API_KEY        live readings (Erika Owl phone prompt + mytarotapp deck)
// Optional: OPENAI_MODEL (default gpt-4o-mini), TAPP_BASE_URL (leave unset),
//           KALPA_API_KEY (+ optional KALPA_VOICE_ID, KALPA_MODEL) for Kalpa voice; text works without it,
//           TWILIO_AUTH_TOKEN for the booth phone (see phone.js).
//
// Everything under /fortune is password-gated server-side: pages, brief, app assets and APIs.
// Login sessions are opaque random cookies; only their SHA-256 lives in the Durable Object,
// so logout revokes immediately and sessions survive deploys. The phone (Twilio) routes are
// live in phone.js and verify Twilio's signature instead of the viewer password.

import { makeFortune, drawCards } from "./fortune.js";
import { kalpaSpeak, kalpaConfigured } from "./voice.js";
import { handleTwilio, warmPrompts } from "./phone.js";

const BASE = "/fortune";
const COOKIE = "fp_session";
const SESSION_HOURS = 12;
const LOGIN_WINDOW_MS = 15 * 60000, LOGIN_MAX_PER_IP = 5, LOGIN_MAX_GLOBAL = 50;
const enc = new TextEncoder();
const apiBuckets = new Map(); // best-effort per-isolate API rate limit

const sha256hex = async (s) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(s))))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
async function same(a, b) {
  // Compare digests so length differences don't leak through timing.
  const [x, y] = await Promise.all([sha256hex("cmp:" + a), sha256hex("cmp:" + b)]);
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return r === 0;
}
const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const cookieOf = (req, name) => {
  const c = (req.headers.get("cookie") || "").split(/;\s*/).find((x) => x.startsWith(name + "="));
  return c ? c.slice(name.length + 1) : "";
};
const SEC = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...SEC } });
const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...SEC } });
function redirect(location, cookie) {
  const h = new Headers({ location, ...SEC });
  if (cookie) h.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers: h });
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const safeNext = (n) =>
  typeof n === "string" && /^\/fortune(\/[\w\-./?=&#%]*)?$/.test(n) && !n.includes("//") ? n : BASE + "/";

export function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!/^[+\d\s().-]+$/.test(raw))
    throw new Error("Enter a valid mobile number, including country code for numbers outside the US.");
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && !raw.startsWith("+")) digits = "1" + digits;
  if (digits.length < 8 || digits.length > 15 || digits[0] === "0")
    throw new Error("Use 8–15 digits including country code; US numbers may use 10 digits.");
  return "+" + digits;
}
function text(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(`Enter ${label} (${max} characters maximum).`);
  return value.trim();
}
const newSession = () => ({
  id: crypto.randomUUID(),
  mode: "demo",
  created: new Date().toISOString(),
  stage: "phone",
  recording: false,
  followUp: false,
});

/* ---------------- login ---------------- */
const loginPage = ({ error = "", next = BASE + "/" } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>The Future Is Calling · Private</title><link rel="icon" href="/favicon.svg">
<style>
:root{--bg:#0f0d0c;--fg:#f4ede4;--muted:#a59a8e;--accent:#e2483d;--line:#2d2723}
@media (prefers-color-scheme: light){:root{--bg:#f7f2ea;--fg:#1d1916;--muted:#6f655b;--line:#ddd3c6}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;padding:16px}
form{width:100%;max-width:360px;border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:22px;margin:0 0 4px}p{color:var(--muted);margin:0 0 20px;font-size:14px}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:6px}
input{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--fg);font-size:16px}
button{margin-top:14px;width:100%;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-weight:600;font-size:16px;cursor:pointer}
.err{color:var(--accent);font-size:14px;margin:12px 0 0}
</style></head><body>
<form method="post" action="${BASE}/login">
<h1>The Future Is Calling</h1><p>Private preview. Enter the password you were sent.</p>
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<input type="hidden" name="next" value="${esc(next)}">
<button type="submit">Enter</button>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
</form></body></html>`;

async function throttled(st, ip) {
  const now = Date.now();
  const [g, mine] = await Promise.all([st.get("fortune_throttle", "global"), st.get("fortune_throttle", ip)]);
  return (g && g.reset > now && g.count >= LOGIN_MAX_GLOBAL) || (mine && mine.reset > now && mine.count >= LOGIN_MAX_PER_IP);
}
async function recordFailure(st, ip) {
  const now = Date.now();
  for (const id of [ip, "global"]) {
    const f = await st.get("fortune_throttle", id);
    await st.put("fortune_throttle", id,
      !f || f.reset < now ? { count: 1, reset: now + LOGIN_WINDOW_MS } : { count: f.count + 1, reset: f.reset });
  }
}
async function isViewer(req, st) {
  const v = cookieOf(req, COOKIE);
  if (!/^[A-Za-z0-9_-]{43}$/.test(v)) return false;
  const row = await st.get("fortune_login", await sha256hex(v));
  return !!row && row.expires > Date.now();
}
const cookieAttrs = `Path=${BASE}; HttpOnly; Secure; SameSite=Lax`;

/* ---------------- main ---------------- */
export async function handleFortune(req, env, ctx, url, st) {
  const path = url.pathname;
  try {
    if (path === BASE + "/health")
      return json({
        ok: true,
        passwordConfigured: !!env.FORTUNE_PASSWORD,
        readingConfigured: !!(env.OPENAI_API_KEY || env.TAPP_BASE_URL),
        kalpaConfigured: kalpaConfigured(env),
        phoneConfigured: !!env.TWILIO_AUTH_TOKEN,
        recordingEnabled: false,
      });

    // The booth phone: Twilio can't log in, so these routes check Twilio's signature instead.
    if (path.startsWith(BASE + "/twilio/")) return await handleTwilio(req, env, ctx, url, st);

    // Fail closed: nothing under /fortune is served until a valid password is configured.
    const pw = env.FORTUNE_PASSWORD || "";
    const admin = env.FORTUNE_ADMIN_TOKEN || "";
    if (pw.length < 10 || pw === admin)
      return html("<!doctype html><title>Not configured</title><p>This page isn't set up yet.</p>", 503);

    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    const ipKey = "ip:" + (await sha256hex(ip)).slice(0, 32);

    if (path === BASE + "/login") {
      if (req.method === "GET") return html(loginPage({ next: safeNext(url.searchParams.get("next")) }));
      if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
      const form = await req.formData().catch(() => null);
      const next = safeNext(form?.get("next"));
      if (await throttled(st, ipKey))
        return html(loginPage({ next, error: "Too many attempts. Try again in 15 minutes." }), 429);
      if (!(await same(String(form?.get("password") || ""), pw))) {
        await recordFailure(st, ipKey);
        return html(loginPage({ next, error: "That password didn't work." }), 401);
      }
      await st.del("fortune_throttle", ipKey);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const value = b64url(bytes);
      await st.put("fortune_login", await sha256hex(value), { expires: Date.now() + SESSION_HOURS * 3600e3 });
      return redirect(next, `${COOKIE}=${value}; Max-Age=${SESSION_HOURS * 3600}; ${cookieAttrs}`);
    }
    if (path === BASE + "/logout") {
      const v = cookieOf(req, COOKIE);
      if (v) await st.del("fortune_login", await sha256hex(v));
      return redirect(BASE + "/login", `${COOKIE}=; Max-Age=0; ${cookieAttrs}`);
    }

    const adminExport =
      [BASE + "/api/export", BASE + "/api/voice-check"].includes(path) && admin.length >= 24 &&
      (await same(req.headers.get("authorization") || "", `Bearer ${admin}`));
    const viewer = await isViewer(req, st);
    if (!viewer && !adminExport) {
      if (path.startsWith(BASE + "/api/")) return json({ error: "Log in first." }, 401);
      return redirect(BASE + "/login?next=" + encodeURIComponent(path));
    }

    if (path.startsWith(BASE + "/api/")) {
      const origin = req.headers.get("origin");
      if (origin && origin !== url.origin) return json({ error: "Untrusted origin." }, 403);
      const now = Date.now();
      let b = apiBuckets.get(ipKey);
      if (!b || b.reset < now) apiBuckets.set(ipKey, (b = { count: 0, reset: now + 60000 }));
      if (++b.count > 120) return json({ error: "Please wait a moment." }, 429);

      const route = path.slice((BASE + "/api").length);
      if (route === "/export" && req.method === "GET") {
        // Viewers never reach this: only the admin bearer token exports contacts.
        if (!adminExport) return json({ error: "Admin access required." }, 401);
        const contacts = (await st.list("fortune_session"))
          .filter((s) => s.followUp && s.confirmedAt && s.permissionAt)
          .map(({ id, created, name, phone, question, fortune, permissionAt, mode, stage }) =>
            ({ id, created, name, phone, question, fortune, permissionAt, mode, status: stage }));
        return json({ contacts });
      }
      if (req.method !== "POST") return json({ error: "POST required." }, 405);
      if (route === "/voice-check") {
        // Admin-only: confirms the Kalpa key works and pre-generates the phone prompts.
        if (!adminExport) return json({ error: "Admin access required." }, 401);
        if (!kalpaConfigured(env)) return json({ kalpa: false, error: "KALPA_API_KEY is not set." }, 503);
        const t0 = Date.now();
        try {
          const wav = await kalpaSpeak(env, "The future is calling.");
          const sample = { bytes: wav.length, ms: Date.now() - t0 };
          return json({ kalpa: true, sample, prompts: await warmPrompts(env, st, url.origin) });
        } catch (e) {
          return json({ kalpa: false, error: e.message }, 502);
        }
      }
      if (route === "/session") {
        const s = newSession();
        await st.put("fortune_session", s.id, s);
        return json({ id: s.id }, 201);
      }
      const raw = await req.text();
      if (raw.length > 16384) throw new Error("Request too large.");
      const data = JSON.parse(raw);
      const s = typeof data.id === "string" ? await st.get("fortune_session", data.id) : null;
      if (!s || s.mode !== "demo") return json({ error: "Session not found." }, 404);
      const save = () => st.put("fortune_session", s.id, s);

      if (route === "/contact") {
        if (!["phone", "confirmed"].includes(s.stage))
          return json({ error: "Start a fresh session to change contact details." }, 409);
        s.phone = normalizePhone(data.phone);
        s.name = text(data.name, "your name", 80);
        if (data.confirmed !== true) throw new Error("Confirm your name and number first.");
        if (typeof data.followUp !== "boolean") throw new Error("Choose your follow-up preference.");
        s.followUp = data.followUp;
        s.confirmedAt = new Date().toISOString();
        s.permissionAt = s.confirmedAt;
        s.stage = "confirmed";
        await save();
        return json({ saved: true });
      }
      if (route === "/fortune") {
        if (s.stage !== "confirmed") return json({ error: "Save confirmed contact details first." }, 409);
        s.question = text(data.question, "a question", 500);
        s.cards ||= drawCards();
        s.stage = "reading";
        await save();
        try {
          s.fortune = await makeFortune(s, { env });
        } catch (error) {
          s.stage = "confirmed";
          await save();
          return json({ error: error.message }, 503);
        }
        s.stage = "complete";
        await save();
        return json(s.fortune);
      }
      if (route === "/speech") {
        if (s.stage !== "complete") return json({ error: "Get a fortune first." }, 409);
        if (!kalpaConfigured(env)) return json({ provider: "browser-demo" });
        let audio;
        try {
          audio = await kalpaSpeak(env, s.fortune.text, { long: true });
        } catch (e) {
          console.log("fortune: Kalpa speech failed:", e.message);
          throw new Error("Kalpa speech failed.");
        }
        return new Response(audio, { headers: { "content-type": "audio/wav", ...SEC } });
      }
      return json({ error: "Not found." }, 404);
    }

    if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "Method not allowed." }, 405);
    const pages = {
      [BASE]: null,
      [BASE + "/"]: "/fortune/",
      [BASE + "/app.js"]: "/fortune/app.js",
      [BASE + "/style.css"]: "/fortune/style.css",
      [BASE + "/brief"]: "/fortune/brief",
    };
    if (path === BASE) return redirect(BASE + "/");
    if (path === BASE + "/brief/" || path === BASE + "/brief.html" || path === BASE + "/index.html")
      return redirect(path.startsWith(BASE + "/brief") ? BASE + "/brief" : BASE + "/");
    if (!Object.hasOwn(pages, path)) return json({ error: "Not found." }, 404);
    const res = await env.ASSETS.fetch(new Request(url.origin + pages[path]));
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
    out.headers.set("cache-control", "private, no-store");
    out.headers.set("vary", "Cookie");
    return out;
  } catch (e) {
    return json({
      error: e.message === "Request too large." ? e.message
        : e.message?.startsWith("Kalpa") ? "Speech is unavailable. Try again."
        : e instanceof SyntaxError ? "Invalid request." : e.message || "Request failed.",
    }, 400);
  }
}
