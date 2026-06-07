# Katto — Amazing Man build

A small companion cat that lives on your desktop while you work — pomodoro timer,
reminders, AI-agent awareness, a pattern editor, and a **Music Mode** that makes
the cat listen and dance to whatever you're playing on Spotify or YouTube.

> **Made by Amazing Man.** Released under CC BY-NC 4.0 — free to use and modify for
> non-commercial purposes. See [`License.md`](./License.md).

## What's new in this build

- **🎵 Music Mode** — the cat bobs to the beat with a live equalizer.
  - A *now-playing* chip shows the current track and source. On Windows this is
    read straight from the OS media controls, so it picks up the **Spotify app**
    *and* **YouTube / YouTube Music** playing in Edge, Chrome, Firefox, etc.
  - **"Tune in to my audio"** captures your system sound and drives the bars from
    a real FFT — the louder the music, the bigger the bounce. Works for any audio
    source on your machine.
  - If you don't tune in, the bars pulse on their own whenever music is detected.
  - No extra dependencies — detection uses built-in OS tools (PowerShell media
    controls on Windows, AppleScript/Spotify on macOS).
  - **macOS note:** macOS has no system-wide "now playing" API and blocks system-audio
    loopback, so on Mac the track chip only shows the **Spotify app**, and *Tune in*
    listens through the **microphone** instead — the cat reacts to music coming out of
    your speakers (this also covers YouTube). Grant mic permission when asked. On
    Windows you get full system-audio capture and YouTube/Spotify detection.
- **⌨️ Comfort & Focus menu** — opt-in, sensory-friendly extras (good for ADHD /
  autistic users, and nice for everyone):
  - **Typewriter sounds** — a soft synthesized click on each keystroke (no audio files),
    with selectable styles: Mechanical, Classic typewriter (with the occasional
    carriage-return ding), Soft/membrane, and Clicky.
  - **White noise** — built-in White / Pink / Brown noise generated live in the app,
    with an optional auto-stop timer (15 / 30 / 60 min). There's also a one-click
    option to play a white-noise track on Spotify instead.
  - **Cat notepad** — a whimsical little cat-eared notes panel that auto-saves your
    jottings between sessions.
  - **Calm mode** — cuts motion and mutes the cat's sounds for low stimulation;
    also respects your OS "reduce motion" setting.
  - **Gentle focus check-ins** — an unobtrusive note every ~20 min so time doesn't
    slip away, with a soft nudge to stretch or hydrate.
  - **Second cat** — a brown mackerel tabby companion beside the main black cat
    (uses the built-in tabby pattern; cat #1 stays black and unchanged).
- **🔔 Reminder templates** — one-click gentle **water** reminders and **cat feeding**
  reminders (added straight into your reminders list, fully editable afterwards).
- **No activation step** — the old prototype license window has been removed; the
  app boots straight to the cat.

## Original features (still here)

- **Desktop pet** that follows your cursor, reacts to typing (typing heat, purr,
  head shake), and stretches on a schedule.
- **Pomodoro** with focus / break timers and a quick context-menu picker.
- **Reminders** with one-off / weekday / weekend / custom repeat rules.
- **AI-agent awareness** — hooks for Claude Code, Antigravity (Gemini), and Cursor.
- **Pattern editor** for painting the cat and saving / exporting presets.
- **Share video** capture (mp4) of a screen crop with the pet in frame.
- **Multi-language** UI: English, 한국어, 日本語.

## Quick start (run from source)

```bash
cd katto
npm install
npm start
```

The app opens directly to the cat. Right-click it for the menu, then
**Music Mode → Enable Music Mode**, and optionally **Tune in to my audio** for the
live, sound-reactive equalizer.

## Build a Windows app (.exe installer)

On a Windows machine with Node.js + npm installed:

```bash
npm install
npm run dist:win
```

The NSIS installer (`Katto Setup <version>.exe`) lands in `dist/`. Other targets:

| Script | Output |
| --- | --- |
| `npm start` | Run in dev mode |
| `npm run pack` | Unpacked app in `dist/` (no installer) |
| `npm run dist:win` | Windows `.exe` installer (NSIS) |
| `npm run dist:mac` | macOS `.dmg` |
| `npm run dist:linux` | Linux `AppImage` |

> **Tip:** Music Mode's *now-playing* detection needs Windows 10/11 (it uses the
> system media transport controls). The live audio equalizer works wherever
> system-audio capture is allowed. If capture is blocked, the cat still dances and
> the bars animate procedurally.

## Project layout

```
main.js                # Electron main process (windows, IPC, menu, music watcher)
preload.js             # contextBridge surface
music/
  now-playing.js       # OS "now playing" detector (Windows SMTC / macOS Spotify)
renderer/
  renderer.js          # pet window logic
  music-mode.js        # equalizer + audio capture + dancing cat
  index.html / styles.css
editor/                # pattern editor window
hooks/  agents/        # AI-agent integration
presets/  svg/  workspace/  assets/
```

## Music Mode — how it works

1. **Detection (main process, `music/now-playing.js`)** polls the OS for the
   active media session every ~2.5s and reports `{ playing, title, artist, source }`
   to the pet window. No third-party API keys, no OAuth.
2. **Visualizer (renderer, `music-mode.js`)** sets `data-*` flags on the page to
   show the equalizer, the now-playing chip, floating notes, and the `catBob`
   animation. When you "tune in", it captures desktop audio via the same
   `desktopCapturer` path the share-video feature already uses, runs an
   `AnalyserNode` FFT, and maps frequency bands to bar heights + bounce strength.

## License & credit

Katto is created by **Amazing Man** and is licensed **CC BY-NC 4.0**
(free to use and modify, non-commercial, with attribution). Keep the credit to the
original author, and don't sell this or any derivative. Full terms in
[`License.md`](./License.md).
