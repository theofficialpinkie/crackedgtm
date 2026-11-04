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
    screen.innerHTML = `<h2>What’s on your mind?</h2><p class="sub">A big leap. A tiny doubt. That thing you keep<br>wondering about. Ask the future anything.</p><form><label for="question">YOUR QUESTION</label><textarea id="question" maxlength="500" placeholder="Will this be the year I finally launch my idea?" required>${escapeHTML(state.question)}</textarea><button class="secondary" id="mic" type="button">ASK OUT LOUD</button><span class="mic" id="micStatus"></span><details class="sample-options"><summary>No live key yet? Try an edited example</summary><button class="secondary sample-question" type="button" data-question="Should I launch my idea now or keep working on it?">Should I launch my idea now or keep working on it?</button><button class="secondary sample-question" type="button" data-question="Should I leave my job to do something of my own?">Should I leave my job to do something of my own?</button><button class="secondary sample-question" type="button" data-question="Is there potential with this person, or am I imagining it?">Is there potential with this person, or am I imagining it?</button><p class="small">These are written examples of the intended experience, not generated readings.</p></details><button class="primary" type="submit">GET MY TAPP READING <span>↗</span></button></form>`;
  if (state.step === 4)
    screen.innerHTML = `<h2>A little perspective,<br>${escapeHTML(state.name)}.</h2><div class="fortune"><div class="verdict">${escapeHTML(state.fortune.verdict)}</div><p>${escapeHTML(state.fortune.prediction).replaceAll("\n", "<br>")}</p></div><button class="primary" id="listen">HEAR YOUR READING <span>▶</span></button><button class="secondary" id="reset">Next caller →</button>${state.fortune.cards?.length ? `<details class="card-details"><summary>Your Tapp cards</summary><div class="cards">${(state.fortune.cards || []).map((c, i) => `<article class="tarot-card"><span>${i + 1} / ${escapeHTML(c.position)}</span><strong>${escapeHTML(c.name)}</strong><em>${escapeHTML(c.orientation)}</em></article>`).join("")}</div></details>` : ""}<p class="small">${escapeHTML(state.fortune.notice || "A reflective tarot reading. The next move is yours.")}</p>`;
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
      button.textContent = "THE CARDS ARE TURNING…";
      state.fortune = await (
        await api("/fortune/api/fortune", { id: state.id, question: state.question })
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
async function listen() {
  const b = screen.querySelector("#listen");
  b.disabled = true;
  try {
    const res = await api("/fortune/api/speech", { id: state.id });
    if (res.headers.get("Content-Type").includes("audio/")) {
      document.querySelector("#voiceMode").textContent = "KALPA VOICE";
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        notice("Audio playback failed.");
      };
      await audio.play();
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
    b.disabled = false;
  }
}
const hashToken = new URLSearchParams(location.hash.slice(1)).get("kiosk");
if (hashToken) {
  sessionStorage.setItem("kioskToken", hashToken);
  history.replaceState(null, "", location.pathname);
}
render();
