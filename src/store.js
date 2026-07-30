'use strict';
/**
 * store.js — persistence layer + recurrence expansion for Lumen Calendar.
 *
 * All datetimes are stored as "floating local" ISO strings:
 *   timed:   "YYYY-MM-DDTHH:MM"
 *   all-day: start "YYYY-MM-DD", end "YYYY-MM-DD" (end EXCLUSIVE, iCal style)
 * Internally we treat these as UTC fields to stay timezone-agnostic.
 */
const fs = require('fs');
const path = require('path');
const { rrulestr } = require('rrule');

const DEFAULT_DATA = () => ({
  settings: {
    name: '',
    city: '',
    hour24: true,
    weekStart: 1,            // 0 = Sunday, 1 = Monday
    accent: 'coral',
    remindersEnabled: true,
    startMinimized: false,
    darkMode: false,
    startOnBoot: false
  },
  calendars: [
    { id: 'cal-personal', name: 'Personal', color: '#FF6B6B' },
    { id: 'cal-work', name: 'Work', color: '#4D96FF' }
  ],
  categories: [
    { id: 'cat-none', name: 'None', color: '' },
    { id: 'cat-meeting', name: 'Meeting', color: '#4D96FF' },
    { id: 'cat-family', name: 'Family', color: '#6BCB77' },
    { id: 'cat-health', name: 'Health', color: '#FF6B6B' },
    { id: 'cat-fun', name: 'Fun', color: '#845EC2' }
  ],
  events: [],
  tasks: [],
  notes: [],
  notified: {}   // key `${eventId}|${instanceStart}` -> true
});

/* ---------- floating-local date helpers ---------- */
function parseLocal(iso) {
  // "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" -> Date with UTC fields
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), 0));
}
function fmtLocal(d, withTime = true) {
  const p = n => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return withTime ? `${date}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date;
}
function addDaysISO(dateISO, days) {
  const d = parseLocal(dateISO.length === 10 ? dateISO + 'T00:00' : dateISO);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtLocal(d, dateISO.length > 10);
}
function durationMs(ev) {
  const s = parseLocal(ev.allDay ? ev.start + 'T00:00' : ev.start);
  const e = parseLocal(ev.allDay ? ev.end + 'T00:00' : ev.end);
  return Math.max(e - s, 0);
}

let uidCounter = 0;
function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${(++uidCounter).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = DEFAULT_DATA();
    this._saveTimer = null;
    this._undoStack = [];
    this._maxUndo = 30;
    this.load();
  }

  _snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  _pushUndo() {
    this._undoStack.push(this._snapshot());
    if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
  }

  undo() {
    if (!this._undoStack.length) return null;
    const current = this._snapshot();
    this.data = this._undoStack.pop();
    this.save(true);
    return current;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        const def = DEFAULT_DATA();
        this.data = {
          ...def, ...raw,
          settings: { ...def.settings, ...(raw.settings || {}) }
        };
      }
    } catch (e) {
      console.error('Store load failed, starting fresh:', e.message);
      this.data = DEFAULT_DATA();
    }
  }

  save(immediate = false) {
    clearTimeout(this._saveTimer);
    const write = () => {
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
      } catch (e) { console.error('Store save failed:', e.message); }
    };
    if (immediate) return write();
    this._saveTimer = setTimeout(write, 400);
  }

  /* ---------- generic CRUD ---------- */
  _collection(name) { return this.data[name]; }

  add(name, item) {
    this._pushUndo();
    item.id = item.id || uid(name.slice(0, 3));
    this._collection(name).push(item);
    this.save();
    return item;
  }
  update(name, id, patch) {
    this._pushUndo();
    const it = this._collection(name).find(x => x.id === id);
    if (it) { Object.assign(it, patch); this.save(); }
    return it;
  }
  remove(name, id) {
    this._pushUndo();
    const arr = this._collection(name);
    const i = arr.findIndex(x => x.id === id);
    if (i >= 0) { arr.splice(i, 1); this.save(); return true; }
    return false;
  }

  /* ---------- recurrence expansion ---------- */
  /**
   * Returns event instances overlapping [rangeStartISO, rangeEndISO).
   * Each instance: original event fields + instanceStart/instanceEnd (ISO).
   */
  expandEvents(rangeStartISO, rangeEndISO) {
    const out = [];
    const rs = parseLocal(rangeStartISO.length === 10 ? rangeStartISO + 'T00:00' : rangeStartISO);
    const re = parseLocal(rangeEndISO.length === 10 ? rangeEndISO + 'T00:00' : rangeEndISO);

    for (const ev of this.data.events) {
      const dur = durationMs(ev);
      if (!ev.rrule) {
        const s = parseLocal(ev.allDay ? ev.start + 'T00:00' : ev.start);
        const e = parseLocal(ev.allDay ? ev.end + 'T00:00' : ev.end);
        if (s < re && e > rs) {
          out.push({ ...ev, instanceStart: ev.start, instanceEnd: ev.end, recurring: false });
        }
        continue;
      }
      try {
        const dtstart = parseLocal(ev.allDay ? ev.start + 'T00:00' : ev.start);
        const rule = rrulestr(ev.rrule, { forceset: false, dtstart });
        // look back one duration so long events starting before range are caught
        const windowStart = new Date(rs.getTime() - dur);
        const occs = rule.between(windowStart, re, true);
        for (const occ of occs) {
          const occEnd = new Date(occ.getTime() + dur);
          if (occ >= re || occEnd <= rs) continue;
          const iStart = fmtLocal(occ, !ev.allDay);
          const iEnd = fmtLocal(occEnd, !ev.allDay);
          if (ev.exdates && ev.exdates.includes(iStart)) continue;
          out.push({ ...ev, instanceStart: iStart, instanceEnd: iEnd, recurring: true });
        }
      } catch (e) {
        console.error('RRULE expand failed for', ev.title, e.message);
        const s = parseLocal(ev.allDay ? ev.start + 'T00:00' : ev.start);
        if (s < re && s >= rs) out.push({ ...ev, instanceStart: ev.start, instanceEnd: ev.end, recurring: false });
      }
    }
    return out;
  }

  tasksInRange(rangeStartISO, rangeEndISO) {
    return this.data.tasks.filter(t =>
      t.due && t.due >= rangeStartISO.slice(0, 10) && t.due < rangeEndISO.slice(0, 10));
  }
  notesInRange(rangeStartISO, rangeEndISO) {
    return this.data.notes.filter(n =>
      n.date >= rangeStartISO.slice(0, 10) && n.date < rangeEndISO.slice(0, 10));
  }

  searchEvents(query) {
    const q = query.toLowerCase();
    return this.data.events.filter(e =>
      e.title.toLowerCase().includes(q) ||
      (e.location || '').toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q)
    ).slice(0, 20);
  }

  markNotified(key) { this.data.notified[key] = true; this.save(); }
  wasNotified(key) { return !!this.data.notified[key]; }
}

module.exports = { Store, parseLocal, fmtLocal, addDaysISO, uid, DEFAULT_DATA };
