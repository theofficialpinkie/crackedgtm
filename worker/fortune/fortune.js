// Unbiased integer in [0, n) from the Web Crypto API (Workers have no node:crypto randomInt).
function randomInt(n) {
  const limit = Math.floor(0x100000000 / n) * n, buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}
import deck from "./deck.js";
import { composeStory } from "./reading-style.js";
import { PHONE_READING_PROMPT } from "./tapp-reader.js";

export function drawCards(pick = randomInt) {
  const names = Object.keys(deck),
    cards = [];
  for (const position of [
    "What is behind you",
    "What is around you",
    "What is opening up",
  ]) {
    const name = names.splice(pick(names.length), 1)[0];
    const reversed = pick(2) === 1;
    cards.push({
      name,
      position,
      orientation: reversed ? "Reversed" : "Upright",
      meaning: (reversed ? deck[name].reversed : deck[name].upright).replace(
        /^Erika says:\s*/,
        "",
      ),
    });
  }
  return cards;
}
function validatedCards(cards) {
  if (
    !Array.isArray(cards) ||
    cards.length !== 3 ||
    new Set(cards.map((c) => c.name)).size !== 3
  )
    throw new Error("A reading needs three distinct cards.");
  return cards.map((c, i) => {
    if (!deck[c.name] || !["Upright", "Reversed"].includes(c.orientation))
      throw new Error("Invalid card.");
    return {
      ...c,
      position: [
        "What is behind you",
        "What is around you",
        "What is opening up",
      ][i],
      meaning: deck[c.name][
        c.orientation === "Reversed" ? "reversed" : "upright"
      ].replace(/^Erika says:\s*/, ""),
    };
  });
}
export async function makeFortune(
  { name, question, cards = drawCards() },
  options = {},
) {
  cards = validatedCards(cards);
  const base = options.tappBase ?? options.env?.TAPP_BASE_URL;
  const key = options.apiKey ?? options.env?.OPENAI_API_KEY;
  const fetcher = options.fetcher ?? fetch;
  let answer, provider;
  if (base) {
    const endpoint = new URL("/api/reading", base);
    if (
      endpoint.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(endpoint.hostname)
    )
      throw new Error("Use HTTPS for the Tapp endpoint.");
    const result = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, selectedCards: cards }),
      signal: AbortSignal.timeout(30000),
    });
    if (!result.ok)
      throw new Error(
        "Tapp reading service is unavailable. Your cards are saved; please retry.",
      );
    const data = await result.json();
    if (typeof data.answer !== "string" || !data.answer.trim())
      throw new Error("Tapp returned no reading.");
    answer = data.answer.trim().slice(0, 12000);
    provider = "tapp-live";
  } else if (key) {
    // A short burst of callers can hit OpenAI's per-minute limit; wait the time OpenAI asks
    // for (capped) and retry twice before showing an error, so a busy booth doesn't stall.
    let result;
    for (let attempt = 0; ; attempt++) {
      result = await fetcher("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.env?.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: PHONE_READING_PROMPT,
          },
          { role: "user", content: JSON.stringify({ name, question, cards }) },
        ],
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(30000),
    });
      if (result.status !== 429 || attempt >= 2) break;
      const peek = await result.clone().json().catch(() => ({}));
      if (peek.error?.code === "insufficient_quota") break;
      const ms = Number(result.headers.get("retry-after-ms")) || Number(result.headers.get("retry-after")) * 1000 || 2000;
      await new Promise((r) => setTimeout(r, Math.min(Math.max(ms, 500), 6000)));
    }
    if (!result.ok) {
      // Report actionable categories without returning upstream bodies or secrets.
      const upstream = await result.json().catch(() => ({}));
      const code = upstream.error?.code;
      const message = result.status === 401
        ? "The reading API rejected the configured key (401). Replace OPENAI_API_KEY in the server settings and redeploy."
        : result.status === 429 && code === "insufficient_quota"
          ? "The reading API has no available credit. Add API credit or use a funded project key, then retry."
          : result.status === 429
            ? "OpenAI is limiting how many readings this key can make right now. Wait a minute and retry. If it keeps happening, the OpenAI account likely needs credit added to raise its limits."
            : "The AI reader is unavailable. Your cards are saved; please retry.";
      throw new Error(message);
    }
    const data = await result.json();
    answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error("The AI reader returned no reading.");
    provider = "tapp-prompt-local";
  } else {
    answer = composeStory({ name, question, cards });
    provider = "tapp-deck-preview";
  }
  const clean = answer.replace(/#{1,6}\s*/g, "").replace(/\*\*/g, "");
  return {
    verdict: "Your reading",
    cards: provider === "tapp-deck-preview" ? [] : cards,
    provider,
    prediction: clean,
    text: clean,
    notice:
      provider === "tapp-deck-preview"
        ? "Edited sample reading only — not a live Tapp response. Configure the API key for personal answers."
        : provider === "tapp-live"
          ? "Reading generated by Tapp."
          : "Reading generated with mytarotapp’s Erika Owl prompt and deck, adapted for the phone.",
  };
}

// Admin check: one tiny request to read this key's real limits from OpenAI's response headers.
export async function openaiCheck(env, fetcher = fetch) {
  if (!env.OPENAI_API_KEY) return { ok: false, lines: ["OPENAI_API_KEY isn't set on the Worker yet."] };
  const model = env.OPENAI_MODEL || "gpt-4o-mini";
  const r = await fetcher("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Say ok." }], max_tokens: 1 }),
    signal: AbortSignal.timeout(15000),
  });
  const h = (k) => r.headers.get(k);
  const rpm = Number(h("x-ratelimit-limit-requests")) || 0;
  const tpm = Number(h("x-ratelimit-limit-tokens")) || 0;
  const body = r.ok ? null : await r.json().catch(() => ({}));
  const code = body?.error?.code;
  if (r.status === 401) return { ok: false, lines: ["OpenAI rejected the key (401). Recopy OPENAI_API_KEY into Cloudflare."] };
  if (code === "insufficient_quota")
    return { ok: false, lines: ["OpenAI key has no credit. Add credit at platform.openai.com → Settings → Billing."] };
  if (r.status === 404 || code === "model_not_found")
    return { ok: false, lines: [`This key can't use the model "${model}". Remove or fix OPENAI_MODEL, or check the key's project permissions.`] };
  const limits = rpm
    ? `Limit: ${rpm} requests and ${tpm.toLocaleString("en-US")} tokens per minute on ${model} (one reading ≈ 1 request, ~2,500 tokens).`
    : "OpenAI didn't report limits.";
  // ~2,500 tokens per reading; the lower of the two limits is how many readings fit in a minute.
  const perMin = rpm ? Math.min(rpm, Math.floor(tpm / 2500)) : 0;
  const enough = perMin >= 20;
  return {
    ok: r.ok && (perMin === 0 || enough),
    lines: [
      r.ok ? "OpenAI key works." : `OpenAI returned ${r.status}${code ? ` (${code})` : ""}.`,
      limits,
      ...(perMin
        ? [enough
            ? `That's room for about ${perMin} readings a minute, plenty for a booth.`
            : `That's only about ${perMin} readings a minute, too low for the event. Add credit at platform.openai.com → Settings → Billing to move up a usage tier, and check the project's rate limits under Settings → Limits.`]
        : []),
    ],
  };
}
