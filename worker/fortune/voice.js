// Kalpa Labs text-to-speech + audio helpers for the fortune phone.
// API (api.kalpalabs.ai, OpenAPI 0.1.0): POST /v1/tts/{voice_id}
//   Authorization: Bearer <KALPA_API_KEY>
//   body { text (1-8000 chars), model?, params? { max_new_tokens 16-2048, ... } }
//   -> { audio: { data_b64: <24 kHz mono 16-bit PCM WAV>, sample_rate, format: "wav" }, ... }
//   errors -> { error: { type, message, request_id } } with 401/404/422/429/502

// Arjun, the default voice in Kalpa's own Pipecat integration. Set KALPA_VOICE_ID to choose another.
export const DEFAULT_VOICE = "18c26f49-9f9c-400c-bec9-7467f28e1db5";

export function kalpaConfigured(env) {
  return !!env.KALPA_API_KEY;
}

export async function kalpaSpeak(env, text, { long = false, voice: chosen } = {}) {
  const voice = chosen || env.KALPA_VOICE_ID || DEFAULT_VOICE;
  const body = { text: String(text).slice(0, 8000) };
  if (env.KALPA_MODEL) body.model = env.KALPA_MODEL;
  // The default token budget (512) can cut off a full reading; give long text the maximum.
  if (long) body.params = { max_new_tokens: 2048 };
  const base = env.KALPA_BASE_URL || "https://api.kalpalabs.ai";
  const r = await fetch(`${base}/v1/tts/${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.KALPA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(long ? 25000 : 12000),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json())?.error?.message || ""; } catch {}
    const e = new Error(`Kalpa ${r.status}${detail ? ": " + detail : ""}`);
    e.status = r.status;
    throw e;
  }
  const data = await r.json();
  const b64 = data?.audio?.data_b64;
  if (!b64) throw new Error("Kalpa returned no audio.");
  if (b64.length > 14_000_000) throw new Error("Kalpa audio too large.");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Parse a PCM WAV and return { rate, channels, samples: Int16Array (mono) }.
export function readWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file.");
  let off = 12, rate = 0, channels = 1, bits = 16, fmt = 1, data = null;
  while (off + 8 <= bytes.length) {
    const id = tag(off), size = dv.getUint32(off + 4, true), start = off + 8;
    if (id === "fmt ") {
      fmt = dv.getUint16(start, true);
      channels = dv.getUint16(start + 2, true);
      rate = dv.getUint32(start + 4, true);
      bits = dv.getUint16(start + 14, true);
    } else if (id === "data") {
      data = [start, Math.min(size, bytes.length - start)];
      break;
    }
    off = start + size + (size & 1);
  }
  if (!data || !rate || fmt !== 1 || bits !== 16) throw new Error("Unsupported WAV audio.");
  const frames = Math.floor(data[1] / (2 * channels));
  const samples = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += dv.getInt16(data[0] + (i * channels + c) * 2, true);
    samples[i] = Math.round(sum / channels);
  }
  return { rate, samples };
}

export function writeWav(samples, rate) {
  const out = new Uint8Array(44 + samples.length * 2);
  const dv = new DataView(out.buffer);
  const put = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  put(0, "RIFF"); dv.setUint32(4, 36 + samples.length * 2, true); put(8, "WAVE");
  put(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  put(36, "data"); dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, samples[i], true);
  return out;
}

// Phone calls carry 8 kHz audio, so convert once here (averaging each window acts as the
// anti-alias filter). This cuts storage 3x and avoids Twilio transcoding at play time.
export function toPhoneWav(bytes) {
  const { rate, samples } = readWav(bytes);
  const target = 8000;
  if (rate === target) return writeWav(samples, rate);
  const ratio = rate / target, n = Math.floor(samples.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b && j < samples.length; j++) sum += samples[j];
    out[i] = Math.round(sum / (b - a));
  }
  return writeWav(out, target);
}

const CHUNK = 393216; // bytes per stored row (well under the Durable Object's 2 MB row limit once base64'd)
const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768)); return btoa(s); };

export async function saveAudio(st, kind, id, wav) {
  const n = Math.ceil(wav.length / CHUNK);
  for (let i = 0; i < n; i++) await st.put(kind, `${id}:${i}`, { b64: toB64(wav.subarray(i * CHUNK, (i + 1) * CHUNK)) });
  await st.put(kind, id, { n, bytes: wav.length });
}
export async function loadAudio(st, kind, id) {
  const head = await st.get(kind, id);
  if (!head?.n) return null;
  const out = new Uint8Array(head.bytes);
  let pos = 0;
  for (let i = 0; i < head.n; i++) {
    const part = await st.get(kind, `${id}:${i}`);
    if (!part) return null;
    const bin = atob(part.b64);
    for (let j = 0; j < bin.length; j++) out[pos++] = bin.charCodeAt(j);
  }
  return out;
}

// Voice catalog for kalpa-tts-1 (GET /v1/voices?model=...), cached briefly per isolate.
let voiceCache = { at: 0, list: null };
export async function listVoices(env) {
  if (voiceCache.list && Date.now() - voiceCache.at < 600000) return voiceCache.list;
  const base = env.KALPA_BASE_URL || "https://api.kalpalabs.ai";
  const model = env.KALPA_MODEL || "kalpa-tts-1";
  const r = await fetch(`${base}/v1/voices?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${env.KALPA_API_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Kalpa voices ${r.status}`);
  const data = await r.json();
  const list = (data.data || []).map((v) => ({ ...v }));
  voiceCache = { at: Date.now(), list };
  return list;
}
