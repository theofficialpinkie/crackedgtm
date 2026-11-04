// The booth phone: Twilio calls these webhooks, the visitor types their number on the keypad,
// says their name and question, and hears the reading in a Kalpa voice.
//
//   Red phone -> Grandstream HT801 adapter -> Twilio SIP domain -> POST /fortune/twilio/incoming
//   Each step answers with TwiML; <Gather> sends keypad Digits / SpeechResult to the next route.
//
// Ported step-for-step from magic-eight-phone server.js. Differences: every spoken prompt is
// Kalpa audio (<Play>) when KALPA_API_KEY is set, falling back to Twilio <Say> if Kalpa is slow
// or down so a caller is never stuck; fixed prompts are generated once and cached.
//
// Secrets: TWILIO_AUTH_TOKEN (required; every request's X-Twilio-Signature is verified).
// These routes are outside the viewer password (Twilio can't log in) but reject unsigned calls.

import { makeFortune, drawCards } from "./fortune.js";
import { kalpaConfigured, kalpaSpeak, toPhoneWav, saveAudio, loadAudio } from "./voice.js";

const BASE = "/fortune/twilio";
const enc = new TextEncoder();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const xml = (content) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`, {
    headers: { "content-type": "text/xml", "cache-control": "no-store" },
  });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const PROMPTS = {
  welcome: "The future is calling. I am an AI fortune teller. We keep your name and number for this experience; follow-up is optional. Enter your mobile number, including country code, then press pound.",
  badNumber: "I did not get a valid number. Enter your mobile number, then pound.",
  askName: "Now, what is your name?",
  sayName: "Please say your name.",
  reenter: "Enter your mobile number, then pound.",
  confirmAgain: "Press 1 to confirm your name and number, or 2 to restart.",
  consent: "May the team follow up after the event? Press 1 for yes, or 2 for no. This first version does not save voice recordings.",
  consentAgain: "Press 1 for follow-up, or 2 for no follow-up.",
  askQuestion: "Your details are saved. What would you like to ask the future?",
  askShort: "Ask the future a short question.",
  thinking: "Give me a moment to see how the story unfolds.",
  goodbye: "Thank you. Please hang up for the next caller.",
  failed: "The reader could not connect. Your details are saved. Please ask our host for help.",
  stale: "That step has already changed. Please hang up and try again.",
};

export async function validTwilio(url, params, signature, token) {
  if (!signature || !token) return false;
  let data = url;
  for (const k of [...new Set(params.keys())].sort()) for (const v of params.getAll(k)) data += k + v;
  const key = await crypto.subtle.importKey("raw", enc.encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)))));
  if (expected.length !== signature.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) r |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return r === 0;
}

// Returns <Play> of Kalpa audio, or <Say> if Kalpa isn't configured or fails in time.
async function speak(env, st, origin, text, { cache = false, long = false } = {}) {
  if (!kalpaConfigured(env)) return `<Say>${esc(text)}</Say>`;
  try {
    if (cache) {
      const id = hex(await crypto.subtle.digest("SHA-256", enc.encode(`${env.KALPA_VOICE_ID || ""}|${env.KALPA_MODEL || ""}|${text}`))).slice(0, 40);
      if (!(await st.get("fortune_prompt", id))) await saveAudio(st, "fortune_prompt", id, toPhoneWav(await kalpaSpeak(env, text)));
      return `<Play>${esc(`${origin}${BASE}/media/p/${id}`)}</Play>`;
    }
    const wav = toPhoneWav(await kalpaSpeak(env, text, { long }));
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    await saveAudio(st, "fortune_media", token, wav);
    return `<Play>${esc(`${origin}${BASE}/media/m/${token}`)}</Play>`;
  } catch (e) {
    console.log("fortune: Kalpa fallback to Twilio voice:", e.message);
    return `<Say>${esc(text)}</Say>`;
  }
}

const gather = (action, inner, input = "dtmf", extra = "") =>
  `<Gather input="${input}" action="${BASE}/${action}" method="POST" timeout="8" actionOnEmptyResult="true" ${
    input === "speech" ? 'speechTimeout="auto" language="en-US"' : ""
  } ${extra}>${inner}</Gather>`;

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!/^[+\d\s().-]+$/.test(raw)) throw new Error("bad");
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && !raw.startsWith("+")) digits = "1" + digits;
  if (digits.length < 8 || digits.length > 15 || digits[0] === "0") throw new Error("bad");
  return "+" + digits;
}

// Pre-generate the fixed prompts so the first caller doesn't wait on Kalpa. Admin-only.
export async function warmPrompts(env, st, origin) {
  const out = [];
  for (const [name, text] of Object.entries(PROMPTS)) {
    const t0 = Date.now();
    const tag = await speak(env, st, origin, text, { cache: true });
    out.push({ name, kalpa: tag.startsWith("<Play>"), ms: Date.now() - t0 });
  }
  return out;
}

export async function handleTwilio(req, env, ctx, url, st) {
  const path = url.pathname.slice(BASE.length);
  const origin = url.origin;

  // Audio files Twilio plays. Tokens are random (per-call) or content hashes (fixed prompts).
  const m = path.match(/^\/media\/(p|m)\/([a-f0-9]{40,64})$/);
  if (m && (req.method === "GET" || req.method === "HEAD")) {
    const wav = await loadAudio(st, m[1] === "p" ? "fortune_prompt" : "fortune_media", m[2]);
    if (!wav) return new Response("Not found", { status: 404 });
    return new Response(req.method === "HEAD" ? null : wav, {
      headers: { "content-type": "audio/wav", "content-length": String(wav.length), "cache-control": m[1] === "p" ? "public, max-age=86400" : "no-store" },
    });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.TWILIO_AUTH_TOKEN) return new Response("Phone is not configured.", { status: 503 });
  const params = new URLSearchParams(await req.text());
  if (!(await validTwilio(url.href, params, req.headers.get("x-twilio-signature"), env.TWILIO_AUTH_TOKEN)))
    return new Response("Invalid Twilio signature.", { status: 403 });
  const id = params.get("CallSid") || "";
  if (!/^CA[a-f0-9]{32}$/i.test(id)) return new Response("Missing call ID.", { status: 400 });

  let s = await st.get("fortune_session", id);
  if (!s) {
    if (path !== "/incoming") return new Response("Start a new call.", { status: 409 });
    s = { mode: "phone", created: new Date().toISOString(), stage: "phone", recording: false, followUp: false };
    await st.put("fortune_session", id, s);
    // Housekeeping: per-call audio is only needed for a few minutes.
    ctx.waitUntil(st.delKindBefore("fortune_media", new Date(Date.now() - 3600e3).toISOString()).catch(() => {}));
  }
  const save = () => st.put("fortune_session", id, s);
  const say = (text, opts) => speak(env, st, origin, text, { cache: true, ...opts });
  const digits = params.get("Digits") || "";
  const spoken = (params.get("SpeechResult") || "").trim();

  // Stage guards stop delayed or duplicate requests from attaching input to the wrong step.
  const expected = { "/phone": "phone", "/name": "name", "/confirm": "confirm", "/consent": "consent", "/question": "question" }[path];
  if (expected && s.stage !== expected) return xml((await say(PROMPTS.stale)) + "<Hangup/>");

  if (path === "/incoming") return xml(gather("phone", await say(PROMPTS.welcome)));

  if (path === "/phone") {
    try {
      s.phone = normalizePhone(digits);
    } catch {
      return xml(gather("phone", await say(PROMPTS.badNumber)));
    }
    s.stage = "name";
    await save();
    return xml(gather("name", await say(PROMPTS.askName), "speech"));
  }

  if (path === "/name") {
    if (!spoken || spoken.length > 80) return xml(gather("name", await say(PROMPTS.sayName), "speech"));
    s.name = spoken;
    s.stage = "confirm";
    await save();
    const line = `I have ${s.name}, and ${s.phone.split("").join(" ")}. Press 1 to confirm, or 2 to start again.`;
    return xml(gather("confirm", await say(line, { cache: false }), "dtmf", 'numDigits="1"'));
  }

  if (path === "/confirm") {
    if (digits === "2") {
      s.stage = "phone";
      await save();
      return xml(gather("phone", await say(PROMPTS.reenter)));
    }
    if (digits !== "1") return xml(gather("confirm", await say(PROMPTS.confirmAgain), "dtmf", 'numDigits="1"'));
    s.stage = "consent";
    s.confirmedAt = new Date().toISOString();
    await save();
    return xml(gather("consent", await say(PROMPTS.consent), "dtmf", 'numDigits="1"'));
  }

  if (path === "/consent") {
    if (!["1", "2"].includes(digits)) return xml(gather("consent", await say(PROMPTS.consentAgain), "dtmf", 'numDigits="1"'));
    s.followUp = digits === "1";
    s.permissionAt = new Date().toISOString();
    s.stage = "question";
    await save();
    return xml(gather("question", await say(PROMPTS.askQuestion), "speech"));
  }

  if (path === "/question") {
    if (!spoken || spoken.length > 500) return xml(gather("question", await say(PROMPTS.askShort), "speech"));
    s.question = spoken;
    s.cards ||= drawCards();
    s.stage = "reading";
    s.readingStartedAt = Date.now();
    await save();
    // Answer Twilio right away; write the reading and its audio in the background.
    ctx.waitUntil((async () => {
      try {
        const fortune = await makeFortune(s, { env });
        const playback = await speak(env, st, origin, fortune.text, { long: true });
        const cur = await st.get("fortune_session", id);
        if (cur?.stage === "reading") await st.put("fortune_session", id, { ...cur, fortune, playback, stage: "ready" });
      } catch (e) {
        console.log("fortune: phone reading failed:", e.message);
        const cur = await st.get("fortune_session", id);
        if (cur?.stage === "reading") await st.put("fortune_session", id, { ...cur, stage: "reading_error" });
      }
    })());
    return xml((await say(PROMPTS.thinking)) + `<Pause length="1"/><Redirect method="POST">${BASE}/reading</Redirect>`);
  }

  if (path === "/reading") {
    if (s.stage === "ready") {
      s.stage = "complete";
      const playback = s.playback;
      delete s.playback;
      await save();
      return xml(playback + (await say(PROMPTS.goodbye)) + "<Hangup/>");
    }
    if (s.stage === "reading" && Date.now() - s.readingStartedAt < 55000)
      return xml(`<Pause length="2"/><Redirect method="POST">${BASE}/reading</Redirect>`);
    return xml((await say(PROMPTS.failed)) + "<Hangup/>");
  }

  return new Response("Unknown call step.", { status: 404 });
}
