"use strict";

/**
 * Now-Playing detector for Catjang "Music Mode".
 *
 * Reports what the user is currently listening to — Spotify, YouTube in a
 * browser, or any other app that publishes media info to the OS — so the cat
 * can bob along and show the track title.
 *
 * Implementation notes:
 *  - On Windows we query the System Media Transport Controls (SMTC) through a
 *    small PowerShell snippet. This needs NO extra npm dependency and covers
 *    the Spotify desktop app, YouTube / YouTube Music in Edge/Chrome, Groove,
 *    media players, etc.
 *  - On macOS we use AppleScript to read the Spotify app if it is running.
 *  - Everything is wrapped in try/catch and degrades gracefully: if detection
 *    is unavailable, Music Mode still works as a manual visualizer (the cat
 *    dances to captured audio / a procedural beat).
 *
 * The detector emits a normalized object:
 *   { playing: boolean, title: string, artist: string, source: string }
 * "source" is a friendly label like "Spotify" or "YouTube / Browser".
 */

const { spawn } = require("child_process");

const POLL_INTERVAL_MS = 2500;

let pollTimer = null;
let running = false;
let listener = null;
let lastSnapshotKey = "";

function friendlySource(appId) {
  const id = String(appId || "").toLowerCase();
  if (!id) return "Music";
  if (id.includes("spotify")) return "Spotify";
  if (id.includes("chrome")) return "YouTube / Chrome";
  if (id.includes("msedge") || id.includes("edge")) return "YouTube / Edge";
  if (id.includes("firefox")) return "YouTube / Firefox";
  if (id.includes("brave")) return "YouTube / Brave";
  if (id.includes("zen")) return "YouTube / Browser";
  if (id.includes("vlc")) return "VLC";
  if (id.includes("music") || id.includes("itunes")) return "Apple Music";
  if (id.includes("groove") || id.includes("zune")) return "Groove";
  return "Music";
}

function normalize(raw) {
  if (!raw || typeof raw !== "object") {
    return { playing: false, title: "", artist: "", source: "" };
  }
  // SMTC PlaybackStatus enum: 4 === Playing.
  const playing = Number(raw.status) === 4;
  return {
    playing,
    title: String(raw.title || "").trim(),
    artist: String(raw.artist || "").trim(),
    source: friendlySource(raw.app),
  };
}

function snapshotKey(snap) {
  return [snap.playing ? "1" : "0", snap.title, snap.artist, snap.source].join("|");
}

function emit(snapshot) {
  const key = snapshotKey(snapshot);
  if (key === lastSnapshotKey) return;
  lastSnapshotKey = key;
  if (typeof listener === "function") {
    try { listener(snapshot); } catch {}
  }
}

// ── Windows: query SMTC through PowerShell ──
const WINDOWS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
function Await($op, $type) {
  $m = $asTaskGeneric.MakeGenericMethod($type)
  $t = $m.Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $mgr.GetCurrentSession()
if ($session) {
  $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $status = $session.GetPlaybackInfo().PlaybackStatus
  $out = [ordered]@{
    title  = $props.Title
    artist = $props.Artist
    app    = $session.SourceAppUserModelId
    status = [int]$status
  }
  $out | ConvertTo-Json -Compress
}
`;

function pollWindows() {
  let stdout = "";
  let child;
  try {
    child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_PS],
      { windowsHide: true }
    );
  } catch {
    return;
  }
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.on("error", () => {});
  child.on("close", () => {
    const text = stdout.trim();
    if (!text) { emit({ playing: false, title: "", artist: "", source: "" }); return; }
    try {
      emit(normalize(JSON.parse(text)));
    } catch {
      emit({ playing: false, title: "", artist: "", source: "" });
    }
  });
}

// ── macOS: read Spotify via AppleScript (best-effort) ──
const MAC_OSA = `
if application "Spotify" is running then
  tell application "Spotify"
    set st to player state as string
    if st is "playing" or st is "paused" then
      set t to name of current track
      set a to artist of current track
      return st & "||" & t & "||" & a
    end if
  end tell
end if
return ""
`;

function pollMac() {
  let stdout = "";
  let child;
  try {
    child = spawn("osascript", ["-e", MAC_OSA]);
  } catch {
    return;
  }
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.on("error", () => {});
  child.on("close", () => {
    const text = stdout.trim();
    if (!text) { emit({ playing: false, title: "", artist: "", source: "" }); return; }
    const [state, title, artist] = text.split("||");
    emit({
      playing: state === "playing",
      title: (title || "").trim(),
      artist: (artist || "").trim(),
      source: "Spotify",
    });
  });
}

function pollOnce() {
  if (process.platform === "win32") pollWindows();
  else if (process.platform === "darwin") pollMac();
  // Linux: no universal API here — Music Mode still works as a live visualizer.
}

function start(onUpdate) {
  listener = onUpdate;
  if (running) return;
  running = true;
  lastSnapshotKey = "";
  pollOnce();
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

function stop() {
  running = false;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  emit({ playing: false, title: "", artist: "", source: "" });
}

function isSupported() {
  return process.platform === "win32" || process.platform === "darwin";
}

module.exports = { start, stop, isSupported };
