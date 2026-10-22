# Lumen Calendar

A clean, fast, offline-first desktop calendar for Linux, macOS, and Windows. Built with Electron.

<img width="1339" height="877" alt="lc-1" src="https://github.com/user-attachments/assets/2198aab0-2cac-43f7-8a8a-0d94dacb4d48" />
<img width="1333" height="872" alt="lc-2" src="https://github.com/user-attachments/assets/24bd46d0-af04-4d2d-824d-0cb44cf2266c" />

## Features

- **Month / Week / Day views** — switch between them with `1` `2` `3`
- **Events, Tasks, Notes** — full CRUD with inline editing
- **Recurring events** — daily, weekly, weekday, monthly, yearly with undo support
- **ICS import / export** — drag-and-drop from other calendars, including from URL (`webcal://` → `https://`)
- **Per-event color override** — override calendar color on individual events
- **Calendar management** — create, rename, recolor, hide, and delete calendars (deleting a calendar removes its events too)
- **Dark mode** — system-following or manual toggle
- **12 / 24-hour time** and **date format** (`DD/MM/YYYY`, `MM/DD/YYYY`, `DD Mon YYYY`)
- **Week start** — Monday or Sunday
- **Reminders** — desktop notifications with a configurable default lead time (at start, 5 min, 15 min, 30 min, 1 h, 2 h, 1 day), per-event overrides, and a test-notification button
- **Search** — search all events by title, location, or description
- **Keyboard shortcuts** — press `?` anywhere to see the full list
- **System tray** — minimize to tray with optional start-on-boot
- **Tray icon style** — full-colour app icon, KDE-style symbolic monochrome light/dark (22 px glyph at 1×, 44 px at 2×), or auto (follows the system theme)
- **Minimal & responsive UI** — built with vanilla JS, no framework overhead

## Quick start

```bash
npm install
npm run dist
```

The AppImage (Linux), `.dmg` (macOS), or installer (Windows) will be in `dist/`.

For development:

```bash
npm start
```

## Project structure

```
src/
  main.js          Electron main process
  preload.js       Context bridge
  store.js         Data store with undo
  importers.js     ICS / CSV parser and exporter
  renderer/
    app.js         UI logic
    index.html     Templates
    styles.css     All styles
test/              Unit tests (node --test)
assets/            App icons
```

## Tests

```bash
npm test
```

## Tech

- Electron 41
- Vanilla JS (no frameworks)
- ICS / iCalendar standard (RFC 5545)
- `node --test` for unit tests

## License

MIT

---

© 2026 Vojislav Korać · Built with [OpenCode](https://opencode.ai)
