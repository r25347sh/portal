(() => {
  "use strict";

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4_FREQ = 440;
  const A4_MIDI = 69;

  /* ---------- DOM ---------- */
  const micToggle = document.getElementById("mic-toggle");
  const micStatus = document.getElementById("mic-status");
  const noteNameEl = document.getElementById("note-name");
  const noteOctaveEl = document.getElementById("note-octave");
  const freqValueEl = document.getElementById("freq-value");
  const centsValueEl = document.getElementById("cents-value");
  const centsNeedle = document.getElementById("cents-needle");
  const centsMeter = document.getElementById("cents-meter");
  const levelFill = document.getElementById("level-fill");

  const soundbackBtn = document.getElementById("soundback-btn");
  const soundbackLabel = document.getElementById("soundback-label");
  const targetNoteEl = document.getElementById("target-note");
  const targetFreqEl = document.getElementById("target-freq");
  const volumeSlider = document.getElementById("volume-slider");
  const volumeValue = document.getElementById("volume-value");

  /* ---------- Audio ---------- */
  let audioCtx = null;

  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  /* ---------- Note math ---------- */
  function freqFromMidi(midi) {
    return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
  }

  function noteFromFreq(freq) {
    if (!freq || freq < 20 || freq > 5000) return null;
    const midi = Math.round(12 * Math.log2(freq / A4_FREQ) + A4_MIDI);
    const targetFreq = freqFromMidi(midi);
    const cents = Math.round(1200 * Math.log2(freq / targetFreq));
    const name = NOTE_NAMES[((midi % 12) + 12) % 12];
    const octave = Math.floor(midi / 12) - 1;
    return { name, octave, midi, cents, freq, targetFreq };
  }

  /* ========== Latest detected target (for Soundback) ========== */
  let latestTarget = null;

  function setTarget(info) {
    if (!info) {
      latestTarget = null;
      targetNoteEl.textContent = "—";
      targetFreqEl.textContent = "—";
      return;
    }
    latestTarget = {
      name: info.name,
      octave: info.octave,
      midi: info.midi,
      targetFreq: info.targetFreq,
    };
    targetNoteEl.textContent = info.name + info.octave;
    targetFreqEl.textContent = info.targetFreq.toFixed(2);
  }

  /* ========== Soundback oscillator (hold = play correct pitch) ========== */
  let osc = null;
  let gainNode = null;
  let isHolding = false;

  function getVolume() {
    return (parseInt(volumeSlider.value, 10) / 100) * 0.35;
  }

  function startSoundback() {
    if (!latestTarget) return;
    const ctx = ensureAudioCtx();
    const freq = latestTarget.targetFreq;

    if (osc) {
      osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.015);
      if (gainNode) {
        gainNode.gain.setTargetAtTime(getVolume(), ctx.currentTime, 0.02);
      }
      return;
    }

    osc = ctx.createOscillator();
    gainNode = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gainNode.gain.value = 0;
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();
    gainNode.gain.setTargetAtTime(getVolume(), ctx.currentTime, 0.03);
  }

  function stopSoundback() {
    if (!osc) return;
    const o = osc;
    const g = gainNode;
    osc = null;
    gainNode = null;
    if (g && audioCtx) {
      g.gain.setTargetAtTime(0, audioCtx.currentTime, 0.025);
      setTimeout(() => {
        try { o.stop(); } catch (_) {}
        try { o.disconnect(); g.disconnect(); } catch (_) {}
      }, 90);
    } else {
      try { o.stop(); o.disconnect(); } catch (_) {}
    }
  }

  function updateSoundbackFreq() {
    if (!isHolding || !osc || !latestTarget || !audioCtx) return;
    osc.frequency.setTargetAtTime(latestTarget.targetFreq, audioCtx.currentTime, 0.02);
  }

  function setHolding(on) {
    isHolding = on;
    soundbackBtn.classList.toggle("is-holding", on);
    soundbackBtn.setAttribute("aria-pressed", on ? "true" : "false");
    soundbackLabel.textContent = on ? "再生中…" : "押して基準音を再生";
    if (on) startSoundback();
    else stopSoundback();
  }

  function onPointerDown(e) {
    if (soundbackBtn.disabled) return;
    e.preventDefault();
    soundbackBtn.setPointerCapture?.(e.pointerId);
    setHolding(true);
  }

  function onPointerUp(e) {
    if (!isHolding) return;
    e.preventDefault();
    setHolding(false);
  }

  soundbackBtn.addEventListener("pointerdown", onPointerDown);
  soundbackBtn.addEventListener("pointerup", onPointerUp);
  soundbackBtn.addEventListener("pointercancel", onPointerUp);
  soundbackBtn.addEventListener("pointerleave", () => {
    if (isHolding) setHolding(false);
  });
  soundbackBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  volumeSlider.addEventListener("input", () => {
    volumeValue.textContent = volumeSlider.value + "%";
    if (gainNode && audioCtx && isHolding) {
      gainNode.gain.setTargetAtTime(getVolume(), audioCtx.currentTime, 0.02);
    }
  });

  /* ========== Pitch detection ========== */
  let mediaStream = null;
  let analyser = null;
  let micSource = null;
  let rafId = null;
  let isListening = false;
  let buflen = 2048;
  let buf = new Float32Array(buflen);

  function getRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  function autoCorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) {
      const val = buffer[i];
      rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;

    let r1 = 0;
    let r2 = SIZE - 1;
    const threshold = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
      if (Math.abs(buffer[i]) < threshold) {
        r1 = i;
        break;
      }
    }
    for (let i = 1; i < SIZE / 2; i++) {
      if (Math.abs(buffer[SIZE - i]) < threshold) {
        r2 = SIZE - i;
        break;
      }
    }

    const buf2 = buffer.slice(r1, r2);
    const n = buf2.length;
    const c = new Float32Array(n).fill(0);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        c[i] += buf2[j] * buf2[j + i];
      }
    }

    let d = 0;
    while (d < n - 1 && c[d] > c[d + 1]) d++;
    let maxVal = -1;
    let maxPos = -1;
    for (let i = d; i < n; i++) {
      if (c[i] > maxVal) {
        maxVal = c[i];
        maxPos = i;
      }
    }
    if (maxPos === -1 || maxVal < 0.01) return -1;

    let T0 = maxPos;
    if (maxPos > 0 && maxPos < n - 1) {
      const x1 = c[maxPos - 1];
      const x2 = c[maxPos];
      const x3 = c[maxPos + 1];
      const a = (x1 + x3 - 2 * x2) / 2;
      const b = (x3 - x1) / 2;
      if (a !== 0) T0 = maxPos - b / (2 * a);
    }

    return sampleRate / T0;
  }

  function updateUI(noteInfo, level) {
    levelFill.style.width = Math.min(100, level * 400) + "%";

    if (!noteInfo) {
      noteNameEl.textContent = "—";
      noteNameEl.classList.remove("in-tune");
      noteOctaveEl.textContent = "";
      freqValueEl.textContent = "—";
      centsValueEl.textContent = "— cents";
      centsNeedle.style.left = "50%";
      centsNeedle.className = "cents-needle";
      centsMeter.setAttribute("aria-valuenow", "0");
      setTarget(null);
      if (isHolding) stopSoundback();
      return;
    }

    noteNameEl.textContent = noteInfo.name;
    noteOctaveEl.textContent = noteInfo.octave;
    freqValueEl.textContent = noteInfo.freq.toFixed(1);
    const cents = noteInfo.cents;
    centsValueEl.textContent = (cents >= 0 ? "+" : "") + cents + " cents";

    const clamped = Math.max(-50, Math.min(50, cents));
    const pct = ((clamped + 50) / 100) * 100;
    centsNeedle.style.left = pct + "%";
    centsMeter.setAttribute("aria-valuenow", String(clamped));

    centsNeedle.classList.remove("in-tune", "sharp", "flat");
    noteNameEl.classList.remove("in-tune");
    if (Math.abs(cents) <= 5) {
      centsNeedle.classList.add("in-tune");
      noteNameEl.classList.add("in-tune");
    } else if (cents > 5) {
      centsNeedle.classList.add("sharp");
    } else {
      centsNeedle.classList.add("flat");
    }

    setTarget(noteInfo);
    updateSoundbackFreq();
  }

  function detectLoop() {
    if (!isListening || !analyser) return;
    analyser.getFloatTimeDomainData(buf);
    const rms = getRMS(buf);
    const freq = autoCorrelate(buf, audioCtx.sampleRate);
    const info = freq > 0 ? noteFromFreq(freq) : null;
    if (info) info.freq = freq;
    updateUI(info, rms);
    rafId = requestAnimationFrame(detectLoop);
  }

  async function startMic() {
    try {
      const ctx = ensureAudioCtx();
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      micSource = ctx.createMediaStreamSource(mediaStream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      buflen = analyser.fftSize;
      buf = new Float32Array(buflen);
      micSource.connect(analyser);

      isListening = true;
      micToggle.setAttribute("aria-pressed", "true");
      micToggle.querySelector(".btn-label").textContent = "マイク停止";
      micStatus.textContent = "検出中…";
      soundbackBtn.disabled = false;
      detectLoop();
    } catch (err) {
      console.error(err);
      micStatus.textContent = "マイクへのアクセスが拒否されました";
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
    micToggle.setAttribute("aria-pressed", "false");
    micToggle.querySelector(".btn-label").textContent = "マイク開始";
    micStatus.textContent = "マイクを開始して楽器や声を当ててください";
    soundbackBtn.disabled = true;
    if (isHolding) setHolding(false);
    updateUI(null, 0);
  }

  micToggle.addEventListener("click", () => {
    if (isListening) stopMic();
    else startMic();
  });

  window.addEventListener("pagehide", () => {
    stopMic();
    stopSoundback();
  });
})();
