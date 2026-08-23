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

  const toneToggle = document.getElementById("tone-toggle");
  const noteSelect = document.getElementById("note-select");
  const octaveSelect = document.getElementById("octave-select");
  const volumeSlider = document.getElementById("volume-slider");
  const volumeValue = document.getElementById("volume-value");
  const refFreqEl = document.getElementById("ref-freq");
  const refNoteLabel = document.getElementById("ref-note-label");

  /* ---------- Audio context (shared, lazy) ---------- */
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

  /* ---------- Frequency helpers ---------- */
  function freqFromNote(noteName, octave) {
    const idx = NOTE_NAMES.indexOf(noteName);
    if (idx < 0) return A4_FREQ;
    const midi = (octave + 1) * 12 + idx;
    return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
  }

  function noteFromFreq(freq) {
    if (!freq || freq < 20 || freq > 5000) return null;
    const midi = Math.round(12 * Math.log2(freq / A4_FREQ) + A4_MIDI);
    const cents = Math.round(1200 * Math.log2(freq / (A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12))));
    const name = NOTE_NAMES[((midi % 12) + 12) % 12];
    const octave = Math.floor(midi / 12) - 1;
    return { name, octave, midi, cents, freq };
  }

  /* ========== Soundback (reference oscillator) ========== */
  let osc = null;
  let gainNode = null;
  let isTonePlaying = false;

  function updateRefPreview() {
    const note = noteSelect.value;
    const oct = parseInt(octaveSelect.value, 10);
    const f = freqFromNote(note, oct);
    refFreqEl.textContent = f.toFixed(2);
    refNoteLabel.textContent = note + oct;
    if (isTonePlaying && osc) {
      osc.frequency.setTargetAtTime(f, audioCtx.currentTime, 0.01);
    }
  }

  function startTone() {
    const ctx = ensureAudioCtx();
    const note = noteSelect.value;
    const oct = parseInt(octaveSelect.value, 10);
    const freq = freqFromNote(note, oct);
    const vol = parseInt(volumeSlider.value, 10) / 100;

    stopTone(true);

    osc = ctx.createOscillator();
    gainNode = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gainNode.gain.value = 0;
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();
    gainNode.gain.setTargetAtTime(vol * 0.35, ctx.currentTime, 0.03);
    isTonePlaying = true;
    toneToggle.setAttribute("aria-pressed", "true");
    toneToggle.querySelector(".btn-label").textContent = "停止";
  }

  function stopTone(silent) {
    if (osc) {
      try {
        if (gainNode && audioCtx) {
          gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
          const o = osc;
          const g = gainNode;
          setTimeout(() => {
            try { o.stop(); } catch (_) {}
            try { o.disconnect(); g.disconnect(); } catch (_) {}
          }, 80);
        } else {
          osc.stop();
          osc.disconnect();
        }
      } catch (_) {}
      osc = null;
      gainNode = null;
    }
    isTonePlaying = false;
    if (!silent) {
      toneToggle.setAttribute("aria-pressed", "false");
      toneToggle.querySelector(".btn-label").textContent = "再生";
    }
  }

  toneToggle.addEventListener("click", () => {
    if (isTonePlaying) stopTone();
    else startTone();
  });

  noteSelect.addEventListener("change", updateRefPreview);
  octaveSelect.addEventListener("change", updateRefPreview);
  volumeSlider.addEventListener("input", () => {
    volumeValue.textContent = volumeSlider.value + "%";
    if (gainNode && audioCtx) {
      const vol = parseInt(volumeSlider.value, 10) / 100;
      gainNode.gain.setTargetAtTime(vol * 0.35, audioCtx.currentTime, 0.02);
    }
  });

  updateRefPreview();
  toneToggle.disabled = false;

  /* ========== Pitch detection (autocorrelation) ========== */
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

  /**
   * Autocorrelation pitch detection (inspired by cwilso/PitchDetect).
   * Returns fundamental frequency or -1 if unclear.
   */
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
    while (c[d] > c[d + 1]) d++;
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
    updateUI(null, 0);
  }

  micToggle.addEventListener("click", () => {
    if (isListening) stopMic();
    else startMic();
  });

  window.addEventListener("pagehide", () => {
    stopMic();
    stopTone(true);
  });
})();
