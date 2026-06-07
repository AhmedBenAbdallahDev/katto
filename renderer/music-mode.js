"use strict";

/**
 * Katto — Music Mode (Amazing Man build)
 *
 * Makes the cat listen and dance to whatever you're playing (Spotify, YouTube,
 * any app). Two layers work together:
 *
 *   1. Now-playing info (track / artist / source) comes from the main process
 *      and shows up in a little chip above the cat.
 *   2. A live equalizer + head-bob. "Tune in to my audio" captures system
 *      sound and drives the bars from a real FFT. If you don't tune in, the
 *      bars pulse procedurally whenever something is detected as playing.
 *
 * All of this runs after renderer.js, fully self-contained — it only touches
 * its own DOM nodes plus a few `data-*` flags on <body>.
 */

(() => {
  const body = document.body;
  const eq = document.getElementById("music-equalizer");
  const bars = eq ? Array.from(eq.querySelectorAll(".eq-bar")) : [];
  const chip = document.getElementById("music-now-playing");
  const chipSource = document.getElementById("music-now-playing-source");
  const chipTitle = document.getElementById("music-now-playing-title");

  const api = window.electronAPI || {};

  const BAR_COUNT = bars.length || 7;

  const state = {
    enabled: false,
    detectedPlaying: false, // from OS now-playing
    title: "",
    artist: "",
    source: "",
    listening: false,       // live audio capture active
    audioLevel: 0,          // smoothed overall level 0..1
    gain: 1.0,              // input gain (mic input is boosted)
  };

  // ── Web Audio plumbing ──
  let audioCtx = null;
  let analyser = null;
  let mediaStream = null;
  let freqData = null;
  let rafId = null;
  const smoothed = new Array(BAR_COUNT).fill(0.12);

  function isPlaying() {
    // Visually "playing" if the OS says so, or live audio is loud enough.
    return state.enabled && (state.detectedPlaying || (state.listening && state.audioLevel > 0.04));
  }

  function refreshFlags() {
    const playing = isPlaying();
    body.toggleAttribute("data-music-playing", playing);
    body.toggleAttribute("data-music-dancing", playing);
    // Procedural bars only when playing but NOT driving them from real audio.
    body.toggleAttribute("data-music-procedural", playing && !state.listening);
    const hasTrack = state.enabled && !!state.title;
    body.toggleAttribute("data-music-nowplaying", hasTrack);
    if (!playing) {
      document.documentElement.style.setProperty("--bob-strength", "0");
    }
  }

  function renderChip() {
    if (!chip) return;
    if (chipSource) chipSource.textContent = state.source || "Now playing";
    if (chipTitle) {
      const t = state.artist ? `${state.title} — ${state.artist}` : state.title;
      chipTitle.textContent = t;
    }
  }

  // ── Live audio analysis ──
  function computeBands() {
    if (!analyser || !freqData) return;
    analyser.getByteFrequencyData(freqData);

    const n = freqData.length;
    let total = 0;
    // Group the lower ~70% of the spectrum (where music energy lives) into bands.
    const usable = Math.floor(n * 0.7);
    const per = Math.max(1, Math.floor(usable / BAR_COUNT));

    for (let b = 0; b < BAR_COUNT; b++) {
      let sum = 0;
      const start = b * per;
      const end = Math.min(usable, start + per);
      for (let i = start; i < end; i++) sum += freqData[i];
      const avg = sum / Math.max(1, end - start) / 255 * state.gain; // 0..1, gain-adjusted
      total += avg;
      // Boost a touch + clamp, then ease toward target for smooth motion.
      const target = Math.min(1, Math.max(0.06, avg * 1.35 + 0.05));
      smoothed[b] += (target - smoothed[b]) * 0.35;
      if (bars[b]) bars[b].style.setProperty("--bar-scale", smoothed[b].toFixed(3));
    }

    state.audioLevel += ((total / BAR_COUNT) - state.audioLevel) * 0.2;
    // Feed the bob animation: louder music => bigger bounce.
    const strength = Math.min(1, state.audioLevel * 2.4);
    document.documentElement.style.setProperty("--bob-strength", strength.toFixed(3));

    refreshFlags();
    rafId = requestAnimationFrame(computeBands);
  }

  async function getDesktopAudioStream() {
    // Windows: capture system/loopback audio. Chromium needs a tiny video
    // desktop track requested alongside it; we keep only the audio.
    if (!api.musicCaptureSource) throw new Error("no capture api");
    const src = await api.musicCaptureSource();
    const sourceId = src && src.sourceId;
    if (!sourceId) throw new Error("no capture source");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "desktop" } },
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          maxWidth: 2,
          maxHeight: 2,
          maxFrameRate: 1,
        },
      },
    });
    for (const track of stream.getVideoTracks()) track.stop();
    if (stream.getAudioTracks().length === 0) throw new Error("no system audio");
    return { stream, viaMic: false };
  }

  async function getMicStream() {
    // Cross-platform fallback (and the default on macOS, where system-audio
    // loopback isn't available): listen through the microphone, so the cat
    // reacts to music playing on the speakers.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    return { stream, viaMic: true };
  }

  async function startListening() {
    if (state.listening) return;
    let result = null;
    const isMac = navigator.platform.toLowerCase().includes("mac");
    try {
      // macOS can't do loopback — go straight to the mic. Elsewhere, try
      // system audio first, then fall back to the mic if it's blocked/empty.
      result = isMac ? await getMicStream() : await getDesktopAudioStream();
    } catch (err) {
      try { result = await getMicStream(); } catch (err2) { result = null; }
    }
    if (!result) { stopListening(); return; }

    try {
      mediaStream = result.stream;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser); // analyser is a sink only — audio is NOT routed to output.

      state.listening = true;
      // Mic input is quieter, so give the level a boost.
      state.gain = result.viaMic ? 2.2 : 1.0;
      refreshFlags();
      if (rafId) cancelAnimationFrame(rafId);
      computeBands();
    } catch (err) {
      stopListening();
    }
  }

  function stopListening() {
    state.listening = false;
    state.audioLevel = 0;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) { try { track.stop(); } catch {} }
      mediaStream = null;
    }
    if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
    analyser = null;
    freqData = null;
    for (const bar of bars) bar.style.removeProperty("--bar-scale");
    document.documentElement.style.setProperty("--bob-strength", "0");
    refreshFlags();
  }

  // ── Incoming state from main ──
  function applyState(s) {
    if (!s || typeof s !== "object") return;
    const wasEnabled = state.enabled;
    if (typeof s.enabled === "boolean") state.enabled = s.enabled;
    if (typeof s.playing === "boolean") state.detectedPlaying = s.playing;
    if (typeof s.title === "string") state.title = s.title;
    if (typeof s.artist === "string") state.artist = s.artist;
    if (typeof s.source === "string") state.source = s.source;

    if (wasEnabled && !state.enabled) stopListening();
    renderChip();
    refreshFlags();
  }

  if (api.onMusicState) api.onMusicState(applyState);
  if (api.onMusicTuneIn) api.onMusicTuneIn(() => { if (state.enabled) startListening(); });
  if (api.onMusicStopListen) api.onMusicStopListen(() => stopListening());

  // Pull initial state in case Music Mode was already on before this loaded.
  if (api.musicGetState) {
    api.musicGetState().then(applyState).catch(() => {});
  }
})();
