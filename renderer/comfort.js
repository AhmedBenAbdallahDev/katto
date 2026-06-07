"use strict";

/**
 * Katto — Comfort & Focus (Amazing Man build)
 *
 * A set of opt-in features aimed at sensory comfort and focus support
 * (helpful for ADHD / autistic users, and pleasant for everyone):
 *
 *   • Typewriter sounds  — a soft mechanical click on every keystroke,
 *     synthesized in the browser (no audio files needed).
 *   • Calm mode          — cuts motion and mutes the cat's sounds for a
 *     low-stimulation experience; also respects the OS "reduce motion" setting.
 *   • Focus check-ins     — a gentle, non-nagging note every so often so time
 *     doesn't disappear ("time blindness"), with a nudge to stretch/hydrate.
 *   • Second cat          — a recoloured companion cat beside the main one.
 *
 * Each feature is toggled from the right-click "Comfort & Focus" menu and the
 * state arrives here over IPC. Everything is self-contained and defensive.
 */

(() => {
  const body = document.body;
  const api = window.electronAPI || {};
  const toast = document.getElementById("comfort-toast");
  const cat2 = document.getElementById("cat2");

  const state = {
    typewriter: false, typeStyle: "mechanical",
    calm: false, checkins: false, secondCat: false,
    noiseType: "off", noiseTimerMin: 0, notesOpen: false,
  };

  // Shared flag the main renderer reads to silence meows/purrs in calm mode.
  window.__kattoCalm = false;

  // ── Typewriter click synth ─────────────────────────────
  let audioCtx = null;
  let lastClickAt = 0;
  let noiseBuffer = null;

  function ensureCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch { return null; }
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function getNoiseBuffer(ctx) {
    if (noiseBuffer) return noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 0.05);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function playTypeClick() {
    if (!state.typewriter || state.calm) return;
    const now = performance.now();
    if (now - lastClickAt < 28) return; // throttle rapid bursts
    lastClickAt = now;
    const ctx = ensureCtx();
    if (!ctx) return;
    const style = state.typeStyle || "mechanical";

    // Per-style voicing: bandpass centre, click gain, low "thock" amount.
    const cfg = {
      mechanical: { freq: 2400, q: 0.9, click: 0.5,  decay: 0.045, thock: 0.18, thockHz: 150 },
      typewriter: { freq: 3200, q: 1.4, click: 0.55, decay: 0.06,  thock: 0.22, thockHz: 120 },
      soft:       { freq: 1400, q: 0.6, click: 0.28, decay: 0.05,  thock: 0.10, thockHz: 180 },
      clicky:     { freq: 3600, q: 2.0, click: 0.6,  decay: 0.03,  thock: 0.12, thockHz: 220 },
    }[style] || { freq: 2400, q: 0.9, click: 0.5, decay: 0.045, thock: 0.18, thockHz: 150 };

    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = cfg.freq + (Math.random() * 700 - 350);
    bp.Q.value = cfg.q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(cfg.click, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + cfg.decay);
    src.connect(bp).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + cfg.decay + 0.02);

    if (cfg.thock > 0) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = cfg.thockHz;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(cfg.thock, t + 0.003);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      osc.connect(og).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
    }

    // Classic typewriter: occasional carriage-return "ding".
    if (style === "typewriter" && Math.random() < 0.03) {
      const ding = ctx.createOscillator();
      ding.type = "sine";
      ding.frequency.value = 1500;
      const dg = ctx.createGain();
      dg.gain.setValueAtTime(0.0001, t);
      dg.gain.exponentialRampToValueAtTime(0.12, t + 0.005);
      dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      ding.connect(dg).connect(ctx.destination);
      ding.start(t);
      ding.stop(t + 0.55);
    }
  }

  if (api.onKeyPressed) api.onKeyPressed(playTypeClick);

  // ── Calm mode ──────────────────────────────────────────
  function applyCalm() {
    body.toggleAttribute("data-calm", state.calm);
    window.__kattoCalm = state.calm;
  }

  // ── Second cat ─────────────────────────────────────────
  // The twin's colour/pattern is kept in sync by the main renderer
  // (it's registered into the same pipeline). Here we only show/hide it.
  function applySecondCat() {
    body.toggleAttribute("data-two-cats", state.secondCat);
  }

  // ── Focus check-ins ────────────────────────────────────
  let focusStartAt = 0;
  let checkinTimer = null;
  let lastCheckinMin = 0;
  let toastHideTimer = null;
  const CHECKIN_EVERY_MIN = 20;

  const CHECKINS = [
    (m) => `You've been focused for ${m} min 🐾 Maybe stretch or sip some water?`,
    (m) => `${m} minutes in — nice. A quick blink-and-breathe break is okay too.`,
    (m) => `Still going strong at ${m} min. Roll your shoulders? I'll wait. 🐱`,
    (m) => `${m} min of focus. Whatever you finish next is enough.`,
  ];

  function showToast(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => toast.classList.remove("show"), 7000);
  }

  function startCheckins() {
    if (checkinTimer) return;
    focusStartAt = Date.now();
    lastCheckinMin = 0;
    checkinTimer = setInterval(() => {
      const mins = Math.floor((Date.now() - focusStartAt) / 60000);
      if (mins > 0 && mins % CHECKIN_EVERY_MIN === 0 && mins !== lastCheckinMin) {
        lastCheckinMin = mins;
        const pick = CHECKINS[Math.floor(Math.random() * CHECKINS.length)];
        showToast(pick(mins));
      }
    }, 15000);
  }
  function stopCheckins() {
    if (checkinTimer) { clearInterval(checkinTimer); checkinTimer = null; }
    if (toast) toast.classList.remove("show");
  }
  function applyCheckins() {
    if (state.checkins) startCheckins();
    else stopCheckins();
  }

  // ── White noise generator ─────────────────────────────
  let noiseNode = null;
  let noiseGain = null;
  let noiseTimer = null;
  const noiseBuffers = {};

  function buildNoise(ctx, type) {
    const seconds = 3;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const out = buf.getChannelData(0);
    if (type === "white") {
      for (let i = 0; i < len; i++) out[i] = Math.random() * 2 - 1;
    } else if (type === "pink") {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else { // brown
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        out[i] = last * 3.5;
      }
    }
    return buf;
  }

  function stopNoise() {
    if (noiseTimer) { clearTimeout(noiseTimer); noiseTimer = null; }
    if (noiseNode) { try { noiseNode.stop(); } catch {} noiseNode.disconnect(); noiseNode = null; }
    if (noiseGain) { try { noiseGain.disconnect(); } catch {} noiseGain = null; }
  }

  function startNoise(type) {
    const ctx = ensureCtx();
    if (!ctx) return;
    stopNoise();
    if (!noiseBuffers[type]) noiseBuffers[type] = buildNoise(ctx, type);
    noiseNode = ctx.createBufferSource();
    noiseNode.buffer = noiseBuffers[type];
    noiseNode.loop = true;
    noiseGain = ctx.createGain();
    // gentle level; fade in to avoid a click
    noiseGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.6);
    noiseNode.connect(noiseGain).connect(ctx.destination);
    noiseNode.start();
    if (state.noiseTimerMin > 0) {
      noiseTimer = setTimeout(() => {
        stopNoise();
        if (api.comfortSet) api.comfortSet("noiseType", "off").catch(() => {});
      }, state.noiseTimerMin * 60000);
    }
  }

  let lastNoiseType = "off";
  let lastNoiseTimer = 0;
  function applyNoise() {
    const changed = state.noiseType !== lastNoiseType || state.noiseTimerMin !== lastNoiseTimer;
    if (!changed) return;
    lastNoiseType = state.noiseType;
    lastNoiseTimer = state.noiseTimerMin;
    if (state.noiseType === "off") stopNoise();
    else startNoise(state.noiseType);
  }

  // ── Cat notepad ────────────────────────────────────────
  const np = document.getElementById("cat-notepad");
  const npText = document.getElementById("cat-notepad-text");
  const npStatus = document.getElementById("cat-notepad-status");
  const npClose = document.getElementById("cat-notepad-close");
  let npLoaded = false;
  let npSaveTimer = null;

  function setInteractive(on) {
    try { if (api.setMouseEventsEnabled) api.setMouseEventsEnabled(on); } catch {}
  }

  async function loadNotes() {
    if (npLoaded || !npText || !api.notesGet) return;
    try { npText.value = (await api.notesGet()) || ""; } catch {}
    npLoaded = true;
  }
  function saveNotes() {
    if (!npText || !api.notesSet) return;
    if (npStatus) npStatus.textContent = "saving…";
    clearTimeout(npSaveTimer);
    npSaveTimer = setTimeout(async () => {
      try { await api.notesSet(npText.value); if (npStatus) npStatus.textContent = "purr-fectly saved"; }
      catch { if (npStatus) npStatus.textContent = "couldn't save"; }
    }, 500);
  }
  if (npText) {
    npText.addEventListener("input", saveNotes);
    npText.addEventListener("pointerenter", () => setInteractive(true));
    npText.addEventListener("focus", () => setInteractive(true));
  }
  if (np) {
    np.addEventListener("pointerenter", () => setInteractive(true));
  }
  if (npClose) {
    npClose.addEventListener("click", () => { if (api.comfortSet) api.comfortSet("notesOpen", false).catch(() => {}); });
  }
  function applyNotepad() {
    if (!np) return;
    if (state.notesOpen) { np.style.display = "flex"; loadNotes(); }
    else { np.style.display = "none"; }
  }


  function applyState(s) {
    if (!s || typeof s !== "object") return;
    if (typeof s.typewriter === "boolean") state.typewriter = s.typewriter;
    if (typeof s.typeStyle === "string") state.typeStyle = s.typeStyle;
    if (typeof s.calm === "boolean") state.calm = s.calm;
    if (typeof s.checkins === "boolean") state.checkins = s.checkins;
    if (typeof s.secondCat === "boolean") state.secondCat = s.secondCat;
    if (typeof s.noiseType === "string") state.noiseType = s.noiseType;
    if (typeof s.noiseTimerMin === "number") state.noiseTimerMin = s.noiseTimerMin;
    if (typeof s.notesOpen === "boolean") state.notesOpen = s.notesOpen;
    applyCalm();
    applySecondCat();
    applyCheckins();
    applyNoise();
    applyNotepad();
    if (state.typewriter || state.noiseType !== "off") ensureCtx();
  }

  if (api.onComfortState) api.onComfortState(applyState);
  if (api.comfortGetState) api.comfortGetState().then(applyState).catch(() => {});
})();
