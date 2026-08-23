(() => {
  "use strict";

  /* ========== International Morse ========== */
  const MORSE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.",
    G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
    M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.",
    S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
    Y: "-.--", Z: "--..",
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
    "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.",
    "!": "-.-.--", "/": "-..-.", "(": "-.--.", ")": "-.--.-",
    "&": ".-...", ":": "---...", ";": "-.-.-.", "=": "-...-",
    "+": ".-.-.", "-": "-....-", _: "..--.-", '"': ".-..-.",
    $: "...-..-", "@": ".--.-.",
  };

  const COMMON_WORDS = [
    "SOS", "CQ", "QRZ", "QTH", "73", "88", "HI", "OK", "YES", "NO",
    "HELLO", "TEST", "NAME", "CQDX", "DE", "UR", "RST", "BTU", "SK",
  ];

  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const DIGITS = "0123456789".split("");

  /* ========== DOM ========== */
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll("[data-panel]");
  const wpmSlider = document.getElementById("wpm");
  const wpmValue = document.getElementById("wpm-value");
  const freqSlider = document.getElementById("freq");
  const freqValue = document.getElementById("freq-value");
  const charsetSelect = document.getElementById("charset");

  const listenMorse = document.getElementById("listen-morse");
  const listenHint = document.getElementById("listen-hint");
  const listenNext = document.getElementById("listen-next");
  const listenReplay = document.getElementById("listen-replay");
  const listenMic = document.getElementById("listen-mic");
  const listenInput = document.getElementById("listen-input");
  const listenCheck = document.getElementById("listen-check");
  const listenFeedback = document.getElementById("listen-feedback");
  const listenStreak = document.getElementById("listen-streak");

  const speakHeard = document.getElementById("speak-heard");
  const speakMorse = document.getElementById("speak-morse");
  const speakMic = document.getElementById("speak-mic");
  const speakPlay = document.getElementById("speak-play");
  const speakStatus = document.getElementById("speak-status");

  const textInput = document.getElementById("text-input");
  const textMorse = document.getElementById("text-morse");
  const textPlay = document.getElementById("text-play");
  const textStop = document.getElementById("text-stop");

  const refGrid = document.getElementById("ref-grid");

  /* ========== Audio (Web Audio API) ========== */
  let audioCtx = null;
  let playToken = 0;

  function ensureCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function unitMs() {
    const wpm = parseInt(wpmSlider.value, 10) || 15;
    return 1200 / wpm;
  }

  function toneFreq() {
    return parseInt(freqSlider.value, 10) || 600;
  }

  function sleep(ms, token) {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (token !== playToken) resolve(false);
        else resolve(true);
      }, ms);
    });
  }

  async function playTone(durationMs, token) {
    const ctx = ensureCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = toneFreq();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.008);
    gain.gain.setValueAtTime(0.22, now + durationMs / 1000 - 0.012);
    gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
    const ok = await sleep(durationMs, token);
    try {
      osc.disconnect();
      gain.disconnect();
    } catch (_) {}
    return ok;
  }

  function textToMorse(text) {
    const parts = [];
    const upper = String(text).toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      const ch = upper[i];
      if (ch === " ") {
        parts.push(" / ");
      } else if (MORSE[ch]) {
        if (parts.length && parts[parts.length - 1] !== " / ") parts.push(" ");
        parts.push(MORSE[ch]);
      }
    }
    return parts.join("").trim() || "—";
  }

  async function playMorseString(morseStr, token) {
    const u = unitMs();
    const chars = morseStr.replace(/\s*\/\s*/g, " / ").split("");
    let i = 0;
    while (i < chars.length) {
      if (token !== playToken) return;
      const c = chars[i];
      if (c === ".") {
        if (!(await playTone(u, token))) return;
        if (!(await sleep(u, token))) return;
      } else if (c === "-") {
        if (!(await playTone(3 * u, token))) return;
        if (!(await sleep(u, token))) return;
      } else if (c === " ") {
        if (!(await sleep(2 * u, token))) return;
      } else if (c === "/") {
        if (!(await sleep(4 * u, token))) return;
      }
      i++;
    }
  }

  async function playText(text) {
    playToken++;
    const token = playToken;
    const m = textToMorse(text);
    await playMorseString(m, token);
  }

  function stopPlay() {
    playToken++;
  }

  /* ========== Speech Recognition ========== */
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let recognizing = false;

  function createRecognition() {
    if (!SpeechRecognition) return null;
    const r = new SpeechRecognition();
    r.lang = "en-US";
    r.interimResults = false;
    r.maxAlternatives = 3;
    r.continuous = false;
    return r;
  }

  function normalizeSpeech(s) {
    if (!s) return "";
    let t = s.toUpperCase().trim();
    const map = {
      ALPHA: "A", BRAVO: "B", CHARLIE: "C", DELTA: "D", ECHO: "E",
      FOXTROT: "F", GOLF: "G", HOTEL: "H", INDIA: "I", JULIET: "J",
      KILO: "K", LIMA: "L", MIKE: "M", NOVEMBER: "N", OSCAR: "O",
      PAPA: "P", QUEBEC: "Q", ROMEO: "R", SIERRA: "S", TANGO: "T",
      UNIFORM: "U", VICTOR: "V", WHISKEY: "W", XRAY: "X", "X-RAY": "X",
      YANKEE: "Y", ZULU: "Z",
      ZERO: "0", ONE: "1", TWO: "2", THREE: "3", FOUR: "4",
      FIVE: "5", SIX: "6", SEVEN: "7", EIGHT: "8", NINE: "9",
      OH: "O",
    };
    if (map[t]) return map[t];
    const letterMatch = t.match(/(?:LETTER|THE LETTER)\s+([A-Z])/);
    if (letterMatch) return letterMatch[1];
    t = t.replace(/[^A-Z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    if (t.length === 1) return t;
    return t;
  }

  function listenOnce() {
    return new Promise((resolve) => {
      if (!SpeechRecognition) {
        resolve({ error: "このブラウザは音声認識に対応していません（Chrome 推奨）" });
        return;
      }
      if (recognizing) {
        try { recognition.stop(); } catch (_) {}
      }
      recognition = createRecognition();
      recognizing = true;

      recognition.onresult = (ev) => {
        const alts = [];
        for (let i = 0; i < ev.results[0].length; i++) {
          alts.push(normalizeSpeech(ev.results[0][i].transcript));
        }
        recognizing = false;
        resolve({ text: alts[0] || "", alternatives: alts });
      };
      recognition.onerror = (ev) => {
        recognizing = false;
        resolve({ error: ev.error === "not-allowed" ? "マイクの許可が必要です" : "認識できませんでした" });
      };
      recognition.onend = () => {
        if (recognizing) {
          recognizing = false;
          resolve({ error: "認識が終了しました" });
        }
      };
      try {
        recognition.start();
      } catch (e) {
        recognizing = false;
        resolve({ error: "音声認識を開始できません" });
      }
    });
  }

  /* ========== Mode: Listen ========== */
  let currentAnswer = "";
  let streak = 0;
  let showMorseWhilePlaying = false;

  function pickChallenge() {
    const mode = charsetSelect.value;
    if (mode === "letters") {
      return LETTERS[Math.floor(Math.random() * LETTERS.length)];
    }
    if (mode === "digits") {
      return DIGITS[Math.floor(Math.random() * DIGITS.length)];
    }
    if (mode === "common") {
      return COMMON_WORDS[Math.floor(Math.random() * COMMON_WORDS.length)];
    }
    const pool = LETTERS.concat(DIGITS);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function setListenEnabled(on) {
    listenReplay.disabled = !on;
    listenMic.disabled = !on;
    listenInput.disabled = !on;
    listenCheck.disabled = !on;
  }

  async function startListenChallenge() {
    stopPlay();
    currentAnswer = pickChallenge();
    listenFeedback.textContent = "";
    listenFeedback.className = "feedback";
    listenInput.value = "";
    listenMorse.textContent = "···";
    listenHint.textContent = "再生中…";
    setListenEnabled(true);

    const code = textToMorse(currentAnswer);
    listenMorse.textContent = showMorseWhilePlaying ? code : "♪";
    await playText(currentAnswer);
    listenMorse.textContent = code;
    listenHint.textContent = "答えを声で言うか入力してください";
  }

  function checkListenAnswer(raw) {
    const ans = String(raw || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const expected = currentAnswer.replace(/[^A-Z0-9]/g, "");
    if (!ans) return;
    if (ans === expected) {
      streak++;
      listenStreak.textContent = String(streak);
      listenFeedback.textContent = "正解！ " + currentAnswer;
      listenFeedback.className = "feedback ok";
    } else {
      streak = 0;
      listenStreak.textContent = "0";
      listenFeedback.textContent = "不正解… 正解は " + currentAnswer;
      listenFeedback.className = "feedback ng";
    }
  }

  listenNext.addEventListener("click", () => startListenChallenge());
  listenReplay.addEventListener("click", async () => {
    if (!currentAnswer) return;
    listenHint.textContent = "再生中…";
    await playText(currentAnswer);
    listenHint.textContent = "答えを声で言うか入力してください";
  });
  listenCheck.addEventListener("click", () => checkListenAnswer(listenInput.value));
  listenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkListenAnswer(listenInput.value);
  });

  listenMic.addEventListener("click", async () => {
    if (!currentAnswer) return;
    listenMic.classList.add("listening");
    listenMic.disabled = true;
    listenFeedback.textContent = "聞いています…";
    listenFeedback.className = "feedback";
    const result = await listenOnce();
    listenMic.classList.remove("listening");
    listenMic.disabled = false;
    if (result.error) {
      listenFeedback.textContent = result.error;
      listenFeedback.className = "feedback ng";
      return;
    }
    const candidates = result.alternatives || [result.text];
    listenInput.value = candidates[0] || "";
    const expected = currentAnswer.replace(/[^A-Z0-9]/g, "");
    const hit = candidates.some((c) => c.replace(/[^A-Z0-9]/g, "") === expected);
    if (hit) {
      checkListenAnswer(expected);
    } else {
      checkListenAnswer(candidates[0]);
    }
  });

  /* ========== Mode: Speak → Morse ========== */
  let lastSpoken = "";

  speakMic.addEventListener("click", async () => {
    speakMic.classList.add("listening");
    speakStatus.textContent = "聞いています…";
    const result = await listenOnce();
    speakMic.classList.remove("listening");
    if (result.error) {
      speakStatus.textContent = result.error;
      return;
    }
    lastSpoken = (result.text || "").replace(/[^A-Z0-9\s]/g, "").trim();
    if (!lastSpoken) {
      speakStatus.textContent = "英数字として認識できませんでした";
      speakHeard.textContent = "—";
      speakMorse.textContent = "—";
      speakPlay.disabled = true;
      return;
    }
    speakHeard.textContent = lastSpoken;
    speakMorse.textContent = textToMorse(lastSpoken);
    speakPlay.disabled = false;
    speakStatus.textContent = "再生できます";
    await playText(lastSpoken);
  });

  speakPlay.addEventListener("click", () => {
    if (lastSpoken) playText(lastSpoken);
  });

  /* ========== Mode: Text ========== */
  function updateTextMorse() {
    const t = textInput.value;
    textMorse.textContent = t.trim() ? textToMorse(t) : "—";
  }

  textInput.addEventListener("input", updateTextMorse);
  textPlay.addEventListener("click", () => {
    const t = textInput.value.trim();
    if (t) playText(t);
  });
  textStop.addEventListener("click", stopPlay);

  /* ========== Tabs ========== */
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.mode;
      tabs.forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      panels.forEach((p) => {
        p.classList.toggle("hidden", p.dataset.panel !== mode);
      });
      stopPlay();
    });
  });

  /* ========== Settings display ========== */
  wpmSlider.addEventListener("input", () => {
    wpmValue.textContent = wpmSlider.value;
  });
  freqSlider.addEventListener("input", () => {
    freqValue.textContent = freqSlider.value;
  });

  /* ========== Reference grid ========== */
  function buildRef() {
    const chars = LETTERS.concat(DIGITS);
    refGrid.innerHTML = "";
    chars.forEach((ch) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "ref-item";
      el.innerHTML =
        '<span class="ref-char">' +
        ch +
        '</span><span class="ref-code">' +
        MORSE[ch] +
        "</span>";
      el.addEventListener("click", () => playText(ch));
      refGrid.appendChild(el);
    });
  }
  buildRef();

  document.body.addEventListener(
    "pointerdown",
    () => {
      ensureCtx();
    },
    { once: true }
  );
})();
