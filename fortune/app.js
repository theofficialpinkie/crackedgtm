const screen = document.querySelector("#screen"),
  error = document.querySelector("#error");
let state = {
    step: 0,
    phone: "",
    name: "",
    question: "",
    followUp: null,
    id: null,
    fortune: null,
  },
  busy = false;
// Kalpa voice choice, kept between callers so the booth host can set it once.
const sound = { voices: [], mode: "solo", reader: "", skeptic: "", hinglish: false };
const PRESETS = [
  ["Wren", "Grant", "English duo"],
  ["Isla", "Otis", "English duo"],
  ["Kiara", "Dev", "Indian English"],
  ["Tessa", "Nikhil", "Mixed accents"],
];
const vname = (v) => v.name.replace(/\s*\(.*\)\s*$/, "");
const byName = (n) => sound.voices.find((v) => vname(v) === n);
fetch("/fortune/api/voices")
  .then((r) => (r.ok ? r.json() : { voices: [] }))
  .then((d) => {
    sound.voices = d.voices || [];
    if (sound.voices.length) {
      sound.reader ||= (byName("Wren") || sound.voices[0]).id;
      sound.skeptic ||= (byName("Grant") || sound.voices[1] || sound.voices[0]).id;
      if (state.step === 3) render();
    }
  })
  .catch(() => {});
function voiceOptions(selected) {
  const group = (label, list) => list.length ? `<optgroup label="${label}">${list.map((v) => `<option value="${escapeHTML(v.id)}" ${v.id === selected ? "selected" : ""}>${escapeHTML(vname(v))} · ${v.gender === "feminine" ? "female" : v.gender === "masculine" ? "male" : escapeHTML(v.gender || "")}</option>`).join("")}</optgroup>` : "";
  const hindi = sound.voices.filter((v) => /hindi/i.test(v.name));
  const other = sound.voices.filter((v) => !/hindi/i.test(v.name));
  return group("English", other) + group("Indian English / Hindi", hindi);
}
function voicePicker() {
  if (!sound.voices.length) return "";
  const duo = sound.mode === "duo";
  return `<fieldset class="voices"><legend>HOW SHOULD IT SOUND? · KALPA VOICES</legend>
<div class="modes"><label><input type="radio" name="mode" value="solo" ${duo ? "" : "checked"}>One reader</label><label><input type="radio" name="mode" value="duo" ${duo ? "checked" : ""}>Two voices: a reader + a skeptic</label></div>
<div class="voice-row"><div><label for="reader">${duo ? "THE READER" : "VOICE"}</label><select id="reader">${voiceOptions(sound.reader)}</select></div>
${duo ? `<div><label for="skeptic">THE SKEPTIC</label><select id="skeptic">${voiceOptions(sound.skeptic)}</select></div>` : ""}</div>
${duo ? `<div class="presets"><span>Try:</span>${PRESETS.filter(([a, b]) => byName(a) && byName(b)).map(([a, b, tag]) => `<button type="button" class="chip" data-preset="${a}|${b}">${a} & ${b} <em>${tag}</em></button>`).join("")}</div>` : ""}
<label class="check"><input type="checkbox" id="hinglish" ${sound.hinglish ? "checked" : ""}>Speak in Hinglish (best with the Indian English voices)</label>
</fieldset>`;
}
function readPicker() {
  const m = screen.querySelector("input[name=mode]:checked");
  if (m) sound.mode = m.value;
  const r = screen.querySelector("#reader"), k = screen.querySelector("#skeptic"), h = screen.querySelector("#hinglish");
  if (r) sound.reader = r.value;
  if (k) sound.skeptic = k.value;
  if (h) sound.hinglish = h.checked;
}
const labels = [
  "YOUR NUMBER",
  "YOUR NAME",
  "CONFIRM DETAILS",
  "ASK THE FUTURE",
  "YOUR FORTUNE",
];
const escapeHTML = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function api(path, data) {
  if (window.FORTUNE_DEMO) return window.FORTUNE_DEMO.request(path, data);
  const token = sessionStorage.getItem("kioskToken") || "";
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Kiosk-Token": token } : {}),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    let d = await res.json();
    throw new Error(d.error || "Please try again.");
  }
  return res;
}
function keepQuestion() {
  const q = screen.querySelector("#question");
  if (q) state.question = q.value;
}
let player = null; // the audio currently playing, so "Next caller" can stop it
function notice(message) {
  error.textContent = message;
}
function render() {
  notice("");
  document.querySelector("#stepLabel").textContent =
    `0${state.step + 1} / ${labels[state.step]}`;
  document.querySelector("#progress").style.width = `${(state.step + 1) * 20}%`;
  if (state.step === 0)
    screen.innerHTML = `<h2>First, your number.</h2><p class="sub">A little introduction before we look ahead.<br>Enter your mobile number, then continue.</p><form><label for="phone">MOBILE NUMBER</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(415) 555-0123" maxlength="25" value="${escapeHTML(state.phone)}" required><div class="keypad" aria-label="Phone keypad">${["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫"].map((n) => `<button type="button" data-key="${n}" aria-label="${n === "⌫" ? "Delete last digit" : n}">${n}</button>`).join("")}</div><button class="primary" type="submit">CONTINUE <span>→</span></button></form><p class="small">Include your country code outside the US. We’ll ask before following up. This demo stores your name and number for the experience. It does not retain voice recordings.</p>`;
  if (state.step === 1)
    screen.innerHTML = `<h2>And what’s your name?</h2><p class="sub">The future prefers a proper introduction.</p><form><label for="name">YOUR NAME</label><input id="name" autocomplete="given-name" maxlength="80" placeholder="Say or type your name" value="${escapeHTML(state.name)}" required><button class="secondary" type="button" id="mic">USE MY VOICE</button><span class="mic" id="micStatus"></span><button class="primary" type="submit">CONTINUE <span>→</span></button></form><button class="secondary" id="back">← Back</button><p class="small">Microphone input depends on your browser’s speech service. You can always type instead.</p>`;
  if (state.step === 2)
    screen.innerHTML = `<h2>Have we got that right?</h2><p class="sub">Just these two details. That’s it.</p><div class="detail"><span>PHONE NUMBER</span><strong>${escapeHTML(state.phone)}</strong></div><div class="detail"><span>NAME</span><strong>${escapeHTML(state.name)}</strong></div><form><fieldset class="permission"><legend>May the team follow up after the event?</legend><label><input type="radio" name="followUp" value="yes" required ${state.followUp === true ? "checked" : ""}>Yes</label><label><input type="radio" name="followUp" value="no" required ${state.followUp === false ? "checked" : ""}>No thanks</label></fieldset><button class="primary" type="submit">CONFIRM & ASK THE FUTURE <span>→</span></button></form><button class="secondary" id="edit">Edit details</button>`;
  if (state.step === 3)
    screen.innerHTML = `<h2>What’s on your mind?</h2><p class="sub">A big leap. A tiny doubt. That thing you keep<br>wondering about. Ask the future anything.</p><form><label for="question">YOUR QUESTION</label><textarea id="question" maxlength="500" placeholder="Will this be the year I finally launch my idea?" required>${escapeHTML(state.question)}</textarea><button class="secondary" id="mic" type="button">ASK OUT LOUD</button><span class="mic" id="micStatus"></span><details class="sample-options"><summary>No live key yet? Try an edited example</summary><button class="secondary sample-question" type="button" data-question="Should I launch my idea now or keep working on it?">Should I launch my idea now or keep working on it?</button><button class="secondary sample-question" type="button" data-question="Should I leave my job to do something of my own?">Should I leave my job to do something of my own?</button><button class="secondary sample-question" type="button" data-question="Is there potential with this person, or am I imagining it?">Is there potential with this person, or am I imagining it?</button><p class="small">These are written examples of the intended experience, not generated readings.</p></details>${voicePicker()}<button class="primary" type="submit">${sound.mode === "duo" && sound.voices.length ? "START THE CONVERSATION" : "GET MY TAPP READING"} <span>↗</span></button></form>`;
  if (state.step === 4) {
    const f = state.fortune, duo = Array.isArray(f.turns);
    const names = duo ? { teller: f.duo.teller.name, skeptic: f.duo.skeptic.name } : null;
    const body = duo
      ? `<div class="dialogue">${f.turns.map((t, i) => `<p class="line ${t.who}" data-line="${i}"><b>${escapeHTML(names[t.who])}</b>${escapeHTML(t.text)}</p>`).join("")}</div>`
      : `<p>${escapeHTML(f.prediction).replaceAll("\n", "<br>")}</p>`;
    screen.innerHTML = `<h2>A little perspective,<br>${escapeHTML(state.name)}.</h2><div class="fortune"><div class="verdict">${escapeHTML(f.verdict)}</div>${body}</div><button class="primary" id="listen">${duo ? "HEAR THE CONVERSATION" : "HEAR YOUR READING"} <span>▶</span></button><button class="secondary" id="reset">Next caller →</button>${f.cards?.length ? `<details class="card-details"><summary>Your Tapp cards</summary><div class="cards">${(f.cards || []).map((c, i) => `<article class="tarot-card"><span>${i + 1} / ${escapeHTML(c.position)}</span><strong>${escapeHTML(c.name)}</strong><em>${escapeHTML(c.orientation)}</em></article>`).join("")}</div></details>` : ""}<p class="small">${escapeHTML(f.notice || "A reflective tarot reading. The next move is yours.")}</p>`;
  }
  screen.querySelectorAll("input[name=mode]").forEach((el) => el.addEventListener("change", () => { readPicker(); keepQuestion(); render(); }));
  screen.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    const [a, k] = b.dataset.preset.split("|");
    sound.reader = byName(a).id; sound.skeptic = byName(k).id;
    sound.hinglish = /hindi/i.test(byName(a).name) && /hindi/i.test(byName(k).name) ? sound.hinglish : false;
    keepQuestion(); render();
  }));
  screen.querySelectorAll(".sample-question").forEach(button => button.addEventListener("click", () => { screen.querySelector("#question").value = button.dataset.question; }));
  const form = screen.querySelector("form");
  if (form) form.addEventListener("submit", submit);
  screen.querySelectorAll("[data-key]").forEach(
    (b) =>
      (b.onclick = () => {
        const i = screen.querySelector("#phone");
        i.value =
          b.dataset.key === "⌫"
            ? i.value.slice(0, -1)
            : i.value + b.dataset.key;
      }),
  );
  screen.querySelector("#back")?.addEventListener("click", () => {
    state.step--;
    render();
  });
  screen.querySelector("#edit")?.addEventListener("click", () => {
    state.step = 0;
    render();
  });
  screen.querySelector("#mic")?.addEventListener("click", speakInput);
  screen.querySelector("#listen")?.addEventListener("click", listen);
  screen.querySelector("#reset")?.addEventListener("click", () => {
    window.speechSynthesis?.cancel();
    if (player) { player.pause(); player = null; }
    state = {
      step: 0,
      phone: "",
      name: "",
      question: "",
      followUp: null,
      id: null,
      fortune: null,
    };
    render();
  });
}
async function submit(e) {
  e.preventDefault();
  if (busy) return;
  busy = true;
  const button = e.target.querySelector("[type=submit]");
  button.disabled = true;
  notice("");
  try {
    if (state.step === 0) {
      const phone = screen.querySelector("#phone").value.trim();
      if (!/^[+\d\s().-]+$/.test(phone))
        throw new Error("Please enter a mobile number.");
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15)
        throw new Error(
          "Use 8–15 digits; include country code outside the US.",
        );
      state.phone = phone;
      state.step = 1;
    } else if (state.step === 1) {
      state.name = screen.querySelector("#name").value.trim();
      if (!state.name) throw new Error("Please enter your name.");
      state.step = 2;
    } else if (state.step === 2) {
      state.followUp = new FormData(e.target).get("followUp") === "yes";
      if (!state.id)
        state.id = (await (await api("/fortune/api/session", {})).json()).id;
      await api("/fortune/api/contact", {
        id: state.id,
        phone: state.phone,
        name: state.name,
        followUp: state.followUp,
        confirmed: true,
      });
      state.step = 3;
    } else if (state.step === 3) {
      state.question = screen.querySelector("#question").value.trim();
      readPicker();
      const duo = sound.mode === "duo" && sound.voices.length;
      if (duo && sound.reader === sound.skeptic) throw new Error("Pick two different voices.");
      button.textContent = duo ? "THEY'RE LOOKING AT YOUR CARDS…" : "THE CARDS ARE TURNING…";
      state.fortune = await (
        await api("/fortune/api/fortune", {
          id: state.id,
          question: state.question,
          ...(sound.voices.length ? { mode: duo ? "duo" : "solo", reader: sound.reader, skeptic: sound.skeptic, hinglish: sound.hinglish } : {}),
        })
      ).json();
      state.step = 4;
    }
    render();
  } catch (e) {
    notice(e.message);
    button.textContent = state.step === 3 ? "TRY READING AGAIN →" : "CONTINUE →";
    button.disabled = false;
  } finally {
    busy = false;
  }
}
function speakInput() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    notice("Voice input is unavailable in this browser. Please type instead.");
    return;
  }
  const target = screen.querySelector(state.step === 1 ? "#name" : "#question");
  const r = new Speech();
  r.lang = "en-US";
  r.interimResults = false;
  r.onstart = () =>
    (document.querySelector("#micStatus").textContent = " Listening…");
  r.onresult = (e) => {
    target.value = e.results[0][0].transcript;
  };
  r.onend = () => {
    const s = document.querySelector("#micStatus");
    if (s) s.textContent = "";
  };
  r.onerror = () =>
    notice("Could not hear that. Try again or type your answer.");
  r.start();
}
function playBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    player = audio;
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Audio playback failed.")); };
    audio.play().catch(reject);
  });
}
async function listenDuo(b) {
  const turns = state.fortune.turns, id = state.id;
  const fetchTurn = (i) => api("/fortune/api/speech", { id, turn: i }).then((r) => r.blob());
  const mode = document.querySelector("#voiceMode");
  mode.textContent = "KALPA VOICES · " + state.fortune.duo.teller.name.toUpperCase() + " & " + state.fortune.duo.skeptic.name.toUpperCase() + " · LOADING…";
  let next = fetchTurn(0);
  for (let i = 0; i < turns.length; i++) {
    const blob = await next;
    if (state.id !== id || state.step !== 4) return; // next caller pressed
    // Start rendering the next line while this one plays.
    next = i + 1 < turns.length ? fetchTurn(i + 1) : null;
    next?.catch(() => {});
    screen.querySelectorAll(".line").forEach((el) => el.classList.toggle("speaking", Number(el.dataset.line) === i));
    mode.textContent = "KALPA VOICES · " + state.fortune.duo.teller.name.toUpperCase() + " & " + state.fortune.duo.skeptic.name.toUpperCase();
    await playBlob(blob);
  }
  screen.querySelectorAll(".line").forEach((el) => el.classList.remove("speaking"));
}
async function listen() {
  const b = screen.querySelector("#listen");
  b.disabled = true;
  try {
    if (Array.isArray(state.fortune.turns)) {
      await listenDuo(b);
      return;
    }
    const res = await api("/fortune/api/speech", { id: state.id });
    if (res.headers.get("Content-Type").includes("audio/")) {
      document.querySelector("#voiceMode").textContent = "KALPA VOICE";
      await playBlob(await res.blob());
    } else {
      if (!window.speechSynthesis)
        throw new Error("Speech playback is unavailable in this browser.");
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(state.fortune.text);
      utterance.rate = 0.92;
      window.speechSynthesis.speak(utterance);
      document.querySelector("#voiceMode").textContent =
        "BROWSER DEMO VOICE · NOT KALPA";
    }
  } catch (e) {
    notice(e.message);
  } finally {
    const again = screen.querySelector("#listen");
    if (again) again.disabled = false;
  }
}
const hashToken = new URLSearchParams(location.hash.slice(1)).get("kiosk");
if (hashToken) {
  sessionStorage.setItem("kioskToken", hashToken);
  history.replaceState(null, "", location.pathname);
}
render();
