(() => {
  "use strict";

  const MORSE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.",
    G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
    M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.",
    S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
    Y: "-.--", Z: "--..",
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
    "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  };

  const REVERSE = {};
  Object.keys(MORSE).forEach((k) => {
    REVERSE[MORSE[k]] = k;
  });

  const micToggle = document.getElementById("mic-toggle");
  const statusEl = document.getElementById("status");
  const dbReadout = document.getElementById("db-readout");
  const levelFill = document.getElementById("level-fill");
  const thresholdMark = document.getElementById("threshold-mark");
  const threshSlider = document.getElementById("thresh");
  const threshValue = document.getElementById("thresh-value");
  const keyState = document.getElementById("key-state");
  const keyLabel = document.getElementById("key-label");
  const morseLine = document.getElementById("morse-line");
  const textLine = document.getElementById("text-line");
  const clearBtn = document.getElementById("clear-btn");
  const unitSlider = document.getElementById("unit");
  const unitValue = document.getElementById("unit-value");
  const refGrid = document.getElementById("ref-grid");

  let audioCtx = null;
  let mediaStream = null;
  let analyser = null;
  let micSource = null;
  let rafId = null;
  let isListening = false;

  const timeData = new Float32Array(2048);

  let keyed = false;
  let toneStart = 0;
  let silenceStart = 0;
  let currentElements = "";
  let morseBuffer = "";
  let textBuffer = "";
  let letterFlushed = true;

  function unitMs() {
    return parseInt(unitSlider.value, 10) || 80;
  }

  function thresholdDb() {
    return parseInt(threshSlider.value, 10) || -35;
  }

  function updateThresholdMark() {
    const db = thresholdDb();
    const pct = ((db - -60) / (-15 - -60)) * 100;
    thresholdMark.style.left = Math.max(0, Math.min(100, pct)) + "%";
    threshValue.textContent = String(db);
  }

  function rmsToDb(rms) {
    if (rms < 1e-8) return -100;
    return 20 * Math.log10(rms);
  }

  function setKeyedUI(on) {
    keyed = on;
    keyState.classList.toggle("on", on);
    keyLabel.textContent = on ? "ON" : "OFF";
  }

  function flushLetter() {
    if (!currentElements) return;
    const ch = REVERSE[currentElements];
    textBuffer += ch || "?";
    morseBuffer += (morseBuffer && !morseBuffer.endsWith(" ") ? " " : "") + currentElements;
    currentElements = "";
    letterFlushed = true;
    renderBuffers();
  }

  function flushWord() {
    flushLetter();
    if (textBuffer.length && !textBuffer.endsWith(" ")) {
      textBuffer += " ";
      morseBuffer += " / ";
      renderBuffers();
    }
  }

  function appendElement(el) {
    currentElements += el;
    letterFlushed = false;
    renderBuffers();
  }

  function renderBuffers() {
    const pending = currentElements
      ? (morseBuffer ? morseBuffer + " " : "") + currentElements + "…"
      : morseBuffer;
    morseLine.textContent = pending || "—";
    textLine.textContent = textBuffer || "—";
  }

  function onToneEnd(durationMs) {
    const u = unitMs();
    if (durationMs < 2 * u) {
      appendElement(".");
    } else {
      appendElement("-");
    }
  }

  function onSilenceTick(silenceMs) {
    const u = unitMs();
    if (!letterFlushed && silenceMs >= 3 * u) {
      flushLetter();
    }
    if (silenceMs >= 7 * u) {
      if (textBuffer.length && !textBuffer.endsWith(" ")) {
        flushWord();
      }
    }
  }

  function processFrame(now) {
    analyser.getFloatTimeDomainData(timeData);
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      sum += timeData[i] * timeData[i];
    }
    const rms = Math.sqrt(sum / timeData.length);
    const db = rmsToDb(rms);

    const levelPct = Math.max(0, Math.min(100, ((db - -60) / 60) * 100));
    levelFill.style.width = levelPct + "%";
    dbReadout.textContent = (db < -99 ? "—" : db.toFixed(1)) + " dB";

    const thresh = thresholdDb();
    const above = db >= thresh;

    if (above && !keyed) {
      setKeyedUI(true);
      toneStart = now;
      silenceStart = 0;
    } else if (!above && keyed) {
      setKeyedUI(false);
      const dur = now - toneStart;
      if (dur >= 15) {
        onToneEnd(dur);
      }
      silenceStart = now;
    } else if (!above && !keyed && silenceStart > 0) {
      onSilenceTick(now - silenceStart);
    }
  }

  function loop() {
    if (!isListening || !analyser) return;
    processFrame(performance.now());
    rafId = requestAnimationFrame(loop);
  }

  async function startMic() {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") await audioCtx.resume();

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      micSource = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      micSource.connect(analyser);

      isListening = true;
      micToggle.setAttribute("aria-pressed", "true");
      micToggle.querySelector(".btn-label").textContent = "マイク停止";
      statusEl.textContent = "音を出して打鍵…（しきい値を環境に合わせて調整）";
      silenceStart = performance.now();
      loop();
    } catch (err) {
      console.error(err);
      statusEl.textContent = "マイクへのアクセスが拒否されました";
      isListening = false;
    }
  }

  function stopMic() {
    isListening = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (micSource) {
      try { micSource.disconnect(); } catch (_) {}
      micSource = null;
    }
    analyser = null;
    if (keyed) setKeyedUI(false);
    flushLetter();
    micToggle.setAttribute("aria-pressed", "false");
    micToggle.querySelector(".btn-label").textContent = "マイク開始";
    statusEl.textContent = "マイクを開始してください";
    levelFill.style.width = "0%";
    dbReadout.textContent = "— dB";
  }

  micToggle.addEventListener("click", () => {
    if (isListening) stopMic();
    else startMic();
  });

  clearBtn.addEventListener("click", () => {
    currentElements = "";
    morseBuffer = "";
    textBuffer = "";
    letterFlushed = true;
    renderBuffers();
  });

  threshSlider.addEventListener("input", updateThresholdMark);
  unitSlider.addEventListener("input", () => {
    unitValue.textContent = unitSlider.value;
  });
  updateThresholdMark();
  unitValue.textContent = unitSlider.value;

  let playCtx = null;
  let playToken = 0;

  function ensurePlayCtx() {
    if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (playCtx.state === "suspended") playCtx.resume();
    return playCtx;
  }

  function sleep(ms, token) {
    return new Promise((r) => setTimeout(() => r(token === playToken), ms));
  }

  async function playTone(ms, token) {
    const ctx = ensurePlayCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = 600;
    osc.type = "sine";
    g.gain.value = 0;
    osc.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(0.2, t + 0.01);
    g.gain.setValueAtTime(0.2, t + ms / 1000 - 0.015);
    g.gain.linearRampToValueAtTime(0, t + ms / 1000);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
    await sleep(ms, token);
  }

  async function playCode(code) {
    playToken++;
    const token = playToken;
    const u = unitMs();
    for (const c of code) {
      if (token !== playToken) return;
      if (c === ".") {
        await playTone(u, token);
        await sleep(u, token);
      } else if (c === "-") {
        await playTone(3 * u, token);
        await sleep(u, token);
      }
    }
  }

  function buildRef() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    refGrid.innerHTML = "";
    chars.forEach((ch) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "ref-item";
      el.innerHTML =
        '<span class="ref-char">' + ch + '</span><span class="ref-code">' + MORSE[ch] + "</span>";
      el.addEventListener("click", () => playCode(MORSE[ch]));
      refGrid.appendChild(el);
    });
  }
  buildRef();

  window.addEventListener("pagehide", stopMic);
})();
