'use strict';
/* ═══════════════ Lumen Calendar renderer ═══════════════ */

/* ---------- tiny DOM helper ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- date utils (floating local) ---------- */
const DAY_MS = 86400000;
function pLocal(iso) {                       // ISO string -> local Date
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), 0);
}
function fISO(d, withTime = true) {          // local Date -> ISO string
  const p = n => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${date}T${p(d.getHours())}:${p(d.getMinutes())}` : date;
}
const todayISO = () => fISO(new Date(), false);
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dowOrder() {                        // weekday indices by week-start setting
  const s = state.settings.weekStart ? 1 : 0;
  return [...Array(7)].map((_, i) => (s + i) % 7);
}
function fmtTime(iso) {
  const d = pLocal(iso);
  if (state.settings.hour24) return fISO(d).slice(11);
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}
function fmtDayLabel(isoDate) {
  const d = pLocal(isoDate);
  return `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS_S[d.getMonth()]}`;
}
function fmtDate(d) {
  const df = state.settings.dateFormat || 'DD/MM/YYYY';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  if (df === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`;
  if (df === 'DD Mon YYYY') return `${dd} ${MONTHS_S[d.getMonth()]} ${yyyy}`;
  return `${dd}/${mm}/${yyyy}`;
}

/* ---------- color utils ---------- */
function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 120, g: 130, b: 150 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}
function colorBg(hex, a = 0.13) { const { r, g, b } = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function colorText(hex) { const { r, g, b } = hexRgb(hex); const f = c => Math.round(c * 0.62); return `rgb(${f(r)},${f(g)},${f(b)})`; }

/* ---------- state ---------- */
const state = {
  view: 'month',
  cursor: new Date(),
  settings: { name: '', city: '', hour24: true, weekStart: 1, dateFormat: 'DD/MM/YYYY', accent: 'coral', remindersEnabled: true, darkMode: false },
  calendars: [],
  categories: [],
  events: [],        // expanded instances for current range (+margin)
  tasks: [],
  notes: [],
  rangeStart: null,
  rangeEnd: null,
  hiddenCalendars: new Set(JSON.parse(localStorage.getItem('lumen.hiddenCals') || '[]')),
  calColorMap: {},
  catColorMap: {}
};

function eventColor(ev) {
  if (ev.color) return ev.color;
  if (ev.categoryId && state.catColorMap[ev.categoryId]) return state.catColorMap[ev.categoryId];
  return state.calColorMap[ev.calendarId] || '#7C8698';
}
const visibleEvents = () => state.events.filter(e => !state.hiddenCalendars.has(e.calendarId));

/* ---------- data loading ---------- */
function viewRange() {
  const c = state.cursor;
  if (state.view === 'month') {
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const offset = (first.getDay() - (state.settings.weekStart ? 1 : 0) + 7) % 7;
    const gridStart = addDays(first, -offset);
    return { start: addDays(gridStart, -7), end: addDays(gridStart, 49) };   // grid + margin
  }
  if (state.view === 'week') {
    const offset = (c.getDay() - (state.settings.weekStart ? 1 : 0) + 7) % 7;
    const ws = startOfDay(addDays(c, -offset));
    return { start: addDays(ws, -7), end: addDays(ws, 14) };
  }
  return { start: addDays(startOfDay(c), -3), end: addDays(startOfDay(c), 4) };
}

async function loadData() {
  const { start, end } = viewRange();
  state.rangeStart = start; state.rangeEnd = end;
  const data = await window.api.getRange(fISO(start), fISO(end));
  state.events = data.events;
  state.tasks = data.tasks;
  state.notes = data.notes;
}

async function refresh() {
  await loadData();
  renderAll();
}

function renderAll() {
  renderTitle();
  renderSidebar();
  if (state.view === 'month') renderMonth();
  else if (state.view === 'week') renderWeek();
  else renderDay();
  showView(state.view);
}

function showView(v) {
  state.view = v;
  $('#monthView').classList.toggle('hidden', v !== 'month');
  $('#weekView').classList.toggle('hidden', v !== 'week');
  $('#dayView').classList.toggle('hidden', v !== 'day');
  $$('#viewSwitch button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
}

function renderTitle() {
  const c = state.cursor;
  let t;
  if (state.view === 'month') t = `${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
  else if (state.view === 'week') {
    const offset = (c.getDay() - (state.settings.weekStart ? 1 : 0) + 7) % 7;
    const ws = addDays(c, -offset), we = addDays(ws, 6);
    t = ws.getMonth() === we.getMonth()
      ? `${ws.getDate()} – ${we.getDate()} ${MONTHS[ws.getMonth()]} ${we.getFullYear()}`
      : `${ws.getDate()} ${MONTHS_S[ws.getMonth()]} – ${we.getDate()} ${MONTHS_S[we.getMonth()]} ${we.getFullYear()}`;
  } else t = `${DOW_FULL[c.getDay()]}, ${c.getDate()} ${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
  $('#viewTitle').textContent = t;
}

function navigate(dir) {
  const c = state.cursor;
  if (state.view === 'month') state.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
  else if (state.view === 'week') state.cursor = addDays(c, 7 * dir);
  else state.cursor = addDays(c, dir);
  refresh();
}
function goToday() { state.cursor = new Date(); refresh(); }
function goToDate(isoDate) { state.cursor = pLocal(isoDate); refresh(); }

/* ---------- ribbon: clock + profile ---------- */
function tickClock() {
  const n = new Date();
  const p = x => String(x).padStart(2, '0');
  $('#clockDate').textContent = `${DOW_FULL[n.getDay()]}, ${n.getDate()} ${MONTHS[n.getMonth()]} ${n.getFullYear()}`;
  $('#clockTime').textContent = state.settings.hour24
    ? `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`
    : `${((n.getHours() + 11) % 12) + 1}:${p(n.getMinutes())}:${p(n.getSeconds())} ${n.getHours() >= 12 ? 'PM' : 'AM'}`;
}
function renderProfile() {
  $('#userName').textContent = state.settings.name || 'Your name';
  $('#userCity').textContent = state.settings.city || 'Your city';
  $('#userName').style.opacity = state.settings.name ? 1 : .45;
  $('#userCity').style.opacity = state.settings.city ? 1 : .45;
  document.body.dataset.accent = state.settings.accent || 'coral';
  const theme = state.settings.darkMode ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  document.documentElement.lang = state.settings.weekStart ? 'en-GB' : 'en-US';
}

/* ---------- toasts ---------- */
function toast(msg, type = '') {
  const t = el('div', `toast ${type}`, msg);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2600);
}

/* ═══════════════ SIDEBAR ═══════════════ */
function renderSidebar() {
  renderMiniCal();
  renderCalList();
  renderSideTasks();
}

function renderMiniCal() {
  const host = $('#miniCal');
  host.innerHTML = '';
  const c = state.cursor;
  const head = el('div', 'mini-head');
  const prev = el('button', '', '‹'), next = el('button', '', '›');
  prev.onclick = () => { state.cursor = new Date(c.getFullYear(), c.getMonth() - 1, 1); refresh(); };
  next.onclick = () => { state.cursor = new Date(c.getFullYear(), c.getMonth() + 1, 1); refresh(); };
  head.append(prev, el('b', '', `${MONTHS_S[c.getMonth()]} ${c.getFullYear()}`), next);
  host.appendChild(head);

  const grid = el('div', 'mini-grid');
  for (const i of dowOrder()) grid.appendChild(el('div', 'dow', DOW[i][0]));
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const offset = (first.getDay() - (state.settings.weekStart ? 1 : 0) + 7) % 7;
  const start = addDays(first, -offset);
  const today = new Date();
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const cell = el('div', 'day' + (d.getMonth() !== c.getMonth() ? ' other' : '') +
      (sameDay(d, today) ? ' today' : '') + (sameDay(d, state.cursor) ? ' selected' : ''), d.getDate());
    cell.onclick = () => { state.cursor = d; if (state.view === 'month') renderAll(); else refresh(); };
    grid.appendChild(cell);
  }
  host.appendChild(grid);
}

function renderCalList() {
  const ul = $('#calList');
  ul.innerHTML = '';
  for (const cal of state.calendars) {
    const li = el('li', state.hiddenCalendars.has(cal.id) ? 'off' : '');
    const sw = el('span', 'sw'); sw.style.background = cal.color;
    const nm = el('span', 'nm', cal.name);
    const edit = el('button', 'del', '✎');
    edit.title = 'Edit calendar';
    edit.onclick = e => { e.stopPropagation(); openCalendarModal(cal); };
    const del = el('button', 'del', '✕');
    del.title = 'Delete calendar';
    del.onclick = async e => {
      e.stopPropagation();
      if (!confirm(`Delete calendar "${cal.name}"? Its events move to another calendar.`)) return;
      await window.api.deleteCalendar(cal.id);
      state.calendars = state.calendars.filter(c => c.id !== cal.id);
      rebuildColorMaps(); await refresh();
      toast('Calendar deleted');
    };
    li.append(sw, nm, edit, del);
    li.onclick = async () => {
      state.hiddenCalendars.has(cal.id) ? state.hiddenCalendars.delete(cal.id) : state.hiddenCalendars.add(cal.id);
      localStorage.setItem('lumen.hiddenCals', JSON.stringify([...state.hiddenCalendars]));
      renderAll();
    };
    ul.appendChild(li);
  }
}

function renderSideTasks() {
  const ul = $('#taskList');
  ul.innerHTML = '';
  const open = state.tasks.filter(t => !t.done)
    .sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1).slice(0, 12);
  const done = state.tasks.filter(t => t.done)
    .sort((a, b) => (b.updatedAt || '') < (a.updatedAt || '') ? -1 : 1).slice(0, 5);
  if (!open.length && !done.length) { ul.appendChild(el('li', 'empty-hint', 'No pending tasks 🎉')); return; }
  const prioColor = { high: '#F05252', medium: '#F9C74F', low: '#6BCB77' };
  for (const t of open) {
    const li = el('li');
    const prio = el('span', 'prio'); prio.style.background = prioColor[t.priority] || prioColor.low;
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = false;
    cb.onchange = async () => { await window.api.updateTask(t.id, { done: true }); await refresh(); };
    const wrap = el('div'); wrap.style.flex = 1;
    wrap.appendChild(el('div', 'tt', t.title));
    if (t.due) {
      const due = el('div', 'due' + (t.due < todayISO() ? ' overdue' : ''),
        (t.due < todayISO() ? '⚠ ' : '') + fmtDayLabel(t.due));
      wrap.appendChild(due);
    }
    li.append(prio, cb, wrap);
    li.querySelector('.tt').ondblclick = () => openTaskModal(t);
    ul.appendChild(li);
  }
  for (const t of done) {
    const li = el('li', 'done');
    const prio = el('span', 'prio'); prio.style.background = prioColor[t.priority] || prioColor.low;
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = true;
    cb.onchange = async () => { await window.api.updateTask(t.id, { done: false }); await refresh(); };
    const wrap = el('div'); wrap.style.flex = 1;
    wrap.appendChild(el('div', 'tt', t.title));
    if (t.due) wrap.appendChild(el('div', 'due', fmtDayLabel(t.due)));
    li.append(prio, cb, wrap);
    ul.appendChild(li);
  }
}

/* ═══════════════ shared: items per day ═══════════════ */
function eventsOnDay(isoDate) {
  const dayStart = isoDate, dayEnd = fISO(addDays(pLocal(isoDate), 1), false);
  return visibleEvents().filter(ev => {
    const s = ev.allDay ? ev.instanceStart : ev.instanceStart.slice(0, 10);
    const e = ev.allDay ? ev.instanceEnd : ev.instanceEnd.slice(0, 10);
    if (ev.allDay) return s < dayEnd && e > dayStart;
    return s === isoDate || (s < dayEnd && e > dayStart && ev.instanceStart.slice(0, 10) === isoDate);
  }).sort((a, b) => (a.allDay === b.allDay ? a.instanceStart < b.instanceStart ? -1 : 1 : a.allDay ? -1 : 1));
}
const tasksOnDay = iso => state.tasks.filter(t => t.due === iso);
const notesOnDay = iso => state.notes.filter(n => n.date === iso);

function styleChip(chip, color) {
  chip.style.background = colorBg(color, 0.14);
  chip.style.borderLeftColor = color;
  chip.style.color = colorText(color);
}

/* ═══════════════ MONTH VIEW ═══════════════ */
function renderMonth() {
  const host = $('#monthView');
  host.innerHTML = '';
  const c = state.cursor;
  const dowRow = el('div', 'dow-row');
  for (const i of dowOrder()) dowRow.appendChild(el('div', 'dow', DOW_FULL[i]));
  host.appendChild(dowRow);

  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const offset = (first.getDay() - (state.settings.weekStart ? 1 : 0) + 7) % 7;
  const start = addDays(first, -offset);
  const weeks = Math.ceil((offset + new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate()) / 7);

  const grid = el('div'); grid.id = 'monthGrid';
  grid.style.setProperty('--rows', weeks);
  const today = new Date();

  for (let w = 0; w < weeks; w++) {
    const row = el('div', 'mrow');
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      const iso = fISO(day, false);
      const cell = el('div', 'mcell' + (day.getMonth() !== c.getMonth() ? ' other' : '') + (sameDay(day, today) ? ' today' : ''));
      cell.appendChild(el('div', 'dnum', day.getDate()));

      const evs = eventsOnDay(iso);
      const maxChips = 3;
      evs.slice(0, maxChips).forEach(ev => {
        const chip = el('div', 'evt-chip',
          (ev.allDay ? '' : fmtTime(ev.instanceStart) + ' ') + ev.title + (ev.recurring ? ' ↻' : ''));
        styleChip(chip, eventColor(ev));
        chip.onclick = e => { e.stopPropagation(); openEventModal(ev); };
        cell.appendChild(chip);
      });
      if (evs.length > maxChips) {
        const more = el('button', 'more-link', `+${evs.length - maxChips} more`);
        more.onclick = e => { e.stopPropagation(); openDayPopover(iso, e.clientX, e.clientY); };
        cell.appendChild(more);
      }
      const tCount = tasksOnDay(iso).filter(t => !t.done).length;
      const nCount = notesOnDay(iso).length;
      if (tCount || nCount) {
        const badges = el('div', 'day-badges');
        if (tCount) badges.appendChild(el('span', 'badge-dot', `✓ ${tCount}`));
        if (nCount) badges.appendChild(el('span', 'badge-dot', `📝 ${nCount}`));
        cell.appendChild(badges);
      }

      cell.onclick = e => openDayPopover(iso, e.clientX, e.clientY);
      cell.ondblclick = () => openEventModal(null, iso);
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
  host.appendChild(grid);
}

/* ═══════════════ WEEK / DAY VIEW ═══════════════ */
const HOUR_H = 48;
const PX_MIN = HOUR_H / 60;   // 0.8 px per minute
function buildTimeGrid(days) {
  // returns {root, columns:[{iso, colEl}]}
  const scroll = el('div', 'wk-scroll');
  const body = el('div', 'wk-body');
  const hours = el('div', 'wk-hours');
  for (let h = 1; h < 24; h++) {
    const lbl = el('div', 'h', `${String(h).padStart(2, '0')}:00`);
    lbl.style.top = (h * HOUR_H) + 'px';
    hours.appendChild(lbl);
  }
  body.appendChild(hours);
  const cols = [];
  for (const day of days) {
    const col = el('div', 'wk-col');
    for (let h = 0; h < 24; h++) {
      col.appendChild(el('div', 'slot'));
      col.appendChild(el('div', 'slot half'));
    }
    col.ondblclick = e => {
      const rect = col.getBoundingClientRect();
      const mins = Math.floor((e.clientY - rect.top) / PX_MIN / 30) * 30;   // 30-min snap
      const start = new Date(pLocal(day.iso).getTime() + mins * 60000);
      openEventModal(null, day.iso, fISO(start).slice(11));
    };
    body.appendChild(col);
    cols.push({ iso: day.iso, colEl: col });
  }
  scroll.appendChild(body);
  return { scroll, body, cols };
}

function layoutTimedEvents(isoDate, colEl) {
  const evs = eventsOnDay(isoDate).filter(e => !e.allDay);
  const items = evs.map(ev => {
    let s = pLocal(ev.instanceStart), e = pLocal(ev.instanceEnd);
    const dayStart = pLocal(isoDate);
    if (s < dayStart) s = dayStart;
    const dayEnd = addDays(dayStart, 1);
    if (e > dayEnd) e = dayEnd;
    if (e - s < 20 * 60000) e = new Date(s.getTime() + 20 * 60000);  // min 20 min visible
    return { ev, s, e };
  }).sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));

  // simple column packing for overlaps
  const colEnds = [];
  for (const it of items) {
    let c = colEnds.findIndex(end => end <= it.s);
    if (c === -1) { colEnds.push(it.e); c = colEnds.length - 1; } else colEnds[c] = it.e;
    it.col = c;
  }
  const nCols = Math.max(colEnds.length, 1);

  for (const it of items) {
    const top = (it.s.getHours() * 60 + it.s.getMinutes()) * PX_MIN;
    const height = Math.max((it.e - it.s) / 60000 * PX_MIN, 22);
    const w = 100 / nCols;
    const block = el('div', 'wk-event');
    block.style.top = top + 'px';
    block.style.height = (height - 3) + 'px';
    block.style.left = `calc(${it.col * w}% + 2px)`;
    block.style.width = `calc(${w}% - 4px)`;
    const color = eventColor(it.ev);
    block.style.background = colorBg(color, 0.16);
    block.style.borderLeftColor = color;
    block.style.color = colorText(color);
    block.innerHTML = `<div>${esc(it.ev.title)}${it.ev.recurring ? ' ↻' : ''}</div>` +
      `<div class="tm">${fmtTime(it.ev.instanceStart)}–${fmtTime(it.ev.instanceEnd)}${it.ev.location ? ' · ' + esc(it.ev.location) : ''}</div>`;
    block.onclick = e => { e.stopPropagation(); openEventModal(it.ev); };
    colEl.appendChild(block);
  }
}

function nowIndicator(colEl, isoDate) {
  if (isoDate !== todayISO()) return;
  const n = new Date();
  const line = el('div', 'wk-now');
  line.style.top = (n.getHours() * 60 + n.getMinutes()) * PX_MIN + 'px';
  colEl.appendChild(line);
}

function renderWeek() {
  const host = $('#weekView');
  host.innerHTML = '';
  const c = state.cursor;
  const offset = (c.getDay() - (state.settings.weekStart ? 1 : 0) + 7) % 7;
  const ws = startOfDay(addDays(c, -offset));
  const days = [...Array(7)].map((_, i) => { const d = addDays(ws, i); return { d, iso: fISO(d, false) }; });
  const today = new Date();

  const head = el('div', 'wk-head');
  head.appendChild(el('div', 'wk-corner'));
  for (const { d, iso } of days) {
    const hd = el('div', 'wk-dayhead' + (sameDay(d, today) ? ' today' : ''));
    hd.appendChild(el('div', 'dn', DOW[d.getDay()]));
    const dd = el('div', 'dd', d.getDate());
    dd.style.cursor = 'pointer';
    dd.onclick = () => { state.cursor = d; state.view = 'day'; refresh(); };
    hd.appendChild(dd);
    head.appendChild(hd);
  }
  host.appendChild(head);

  const allDay = el('div', 'wk-allday');
  allDay.appendChild(el('div', 'lbl', 'all day'));
  for (const { iso } of days) {
    const col = el('div', 'col');
    for (const ev of eventsOnDay(iso).filter(e => e.allDay)) {
      const chip = el('div', 'evt-chip', ev.title + (ev.recurring ? ' ↻' : ''));
      styleChip(chip, eventColor(ev));
      chip.onclick = () => openEventModal(ev);
      col.appendChild(chip);
    }
    allDay.appendChild(col);
  }
  host.appendChild(allDay);

  const { scroll, cols } = buildTimeGrid(days);
  host.appendChild(scroll);
  for (const { iso, colEl } of days.length ? cols.map(c => ({ iso: c.iso, colEl: c.colEl })) : []) {
    layoutTimedEvents(iso, colEl);
    nowIndicator(colEl, iso);
  }
  requestAnimationFrame(() => { scroll.scrollTop = 7 * HOUR_H; });
}

function renderDay() {
  const host = $('#dayView');
  host.innerHTML = '';
  const c = startOfDay(state.cursor);
  const iso = fISO(c, false);

  const main = el('div', 'day-main');
  const head = el('div', 'wk-head');
  head.appendChild(el('div', 'wk-corner'));
  const hd = el('div', 'wk-dayhead' + (iso === todayISO() ? ' today' : ''));
  hd.appendChild(el('div', 'dn', DOW_FULL[c.getDay()]));
  hd.appendChild(el('div', 'dd', c.getDate()));
  head.appendChild(hd);
  main.appendChild(head);

  const allDay = el('div', 'wk-allday');
  allDay.appendChild(el('div', 'lbl', 'all day'));
  const adCol = el('div', 'col');
  for (const ev of eventsOnDay(iso).filter(e => e.allDay)) {
    const chip = el('div', 'evt-chip', ev.title + (ev.recurring ? ' ↻' : ''));
    styleChip(chip, eventColor(ev));
    chip.onclick = () => openEventModal(ev);
    adCol.appendChild(chip);
  }
  allDay.appendChild(adCol);
  main.appendChild(allDay);

  const { scroll, cols } = buildTimeGrid([{ d: c, iso }]);
  main.appendChild(scroll);
  layoutTimedEvents(iso, cols[0].colEl);
  nowIndicator(cols[0].colEl, iso);
  host.appendChild(main);

  // side panel: tasks + notes for this day
  const side = el('div', 'day-side');
  const tSec = el('div');
  tSec.appendChild(el('h3', '', 'Tasks'));
  const tList = el('div');
  const dayTasks = tasksOnDay(iso);
  if (!dayTasks.length) tList.appendChild(el('div', 'empty-hint', 'No tasks for this day'));
  for (const t of dayTasks) {
    const item = el('div', 'pop-item' + (t.done ? ' done' : ''));
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!t.done;
    cb.onchange = async () => { await window.api.updateTask(t.id, { done: cb.checked }); await refresh(); };
    item.append(cb, el('span', 'ti', t.title));
    item.onclick = e => { if (e.target !== cb) openTaskModal(t); };
    tList.appendChild(item);
  }
  tSec.appendChild(tList);
  const nSec = el('div');
  nSec.appendChild(el('h3', '', 'Notes'));
  const nList = el('div');
  const dayNotes = notesOnDay(iso);
  if (!dayNotes.length) nList.appendChild(el('div', 'empty-hint', 'No notes for this day'));
  for (const n of dayNotes) nList.appendChild(noteCard(n));
  nSec.appendChild(nList);
  side.append(tSec, nSec);
  host.appendChild(side);
  requestAnimationFrame(() => { scroll.scrollTop = 7 * HOUR_H; });
}

function noteCard(n) {
  const card = el('div', 'note-card');
  card.style.background = colorBg(n.color || '#F9C74F', 0.22);
  card.innerHTML = `<b>${esc(n.title || 'Note')}</b><div class="nx">${esc(n.text || '')}</div>`;
  card.onclick = () => openNoteModal(n);
  return card;
}

/* ═══════════════ DAY POPOVER ═══════════════ */
function openDayPopover(iso, x, y) {
  const pop = $('#popover');
  pop.innerHTML = '';
  pop.appendChild(el('div', 'pop-date', `📅 ${fmtDayLabel(iso)}`));

  const evs = eventsOnDay(iso);
  const tks = tasksOnDay(iso);
  const nts = notesOnDay(iso);

  if (evs.length) {
    pop.appendChild(el('div', 'pop-sec', 'Events'));
    for (const ev of evs) {
      const item = el('div', 'pop-item');
      const dot = el('span', 'dot'); dot.style.background = eventColor(ev);
      const tm = el('span', 'tm', ev.allDay ? 'all day' : `${fmtTime(ev.instanceStart)}–${fmtTime(ev.instanceEnd)}`);
      item.append(dot, tm, el('span', 'ti', ev.title + (ev.recurring ? ' ↻' : '')));
      item.onclick = () => { closePopover(); openEventModal(ev); };
      pop.appendChild(item);
    }
  }
  if (tks.length) {
    pop.appendChild(el('div', 'pop-sec', 'Tasks'));
    for (const t of tks) {
      const item = el('div', 'pop-item' + (t.done ? ' done' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!t.done;
      cb.onchange = async () => { await window.api.updateTask(t.id, { done: cb.checked }); closePopover(); await refresh(); };
      item.append(cb, el('span', 'ti', t.title));
      item.onclick = e => { if (e.target !== cb) { closePopover(); openTaskModal(t); } };
      pop.appendChild(item);
    }
  }
  if (nts.length) {
    pop.appendChild(el('div', 'pop-sec', 'Notes'));
    for (const n of nts) {
      const card = noteCard(n);
      card.onclick = () => { closePopover(); openNoteModal(n); };
      pop.appendChild(card);
    }
  }
  if (!evs.length && !tks.length && !nts.length)
    pop.appendChild(el('div', 'pop-empty', 'Nothing here yet — add something!'));

  const actions = el('div', 'pop-actions');
  const be = el('button', 'pe', '＋ Event'), bt = el('button', 'pt', '＋ Task'), bn = el('button', 'pn', '＋ Note');
  be.onclick = () => { closePopover(); openEventModal(null, iso); };
  bt.onclick = () => { closePopover(); openTaskModal(null, iso); };
  bn.onclick = () => { closePopover(); openNoteModal(null, iso); };
  actions.append(be, bt, bn);
  pop.appendChild(actions);

  pop.classList.remove('hidden');
  const pw = 300, ph = Math.min(pop.offsetHeight || 300, 380);
  pop.style.left = Math.min(Math.max(8, x - pw / 2), innerWidth - pw - 8) + 'px';
  pop.style.top = Math.min(Math.max(56, y + 6), innerHeight - ph - 12) + 'px';
}
function closePopover() { $('#popover').classList.add('hidden'); }
document.addEventListener('click', e => {
  if (!$('#popover').classList.contains('hidden') &&
      !$('#popover').contains(e.target) && !e.target.closest('.mcell'))
    closePopover();
});

/* ═══════════════ MODALS ═══════════════ */
function openModal(tplId, data) {
  const ov = $('#modalOverlay'), m = $('#modal');
  m.innerHTML = '';
  const tpl = document.getElementById(tplId);
  if (!tpl) return m;
  const clone = tpl.content.cloneNode(true);
  m.appendChild(clone);

  // fill values from data object
  if (data) {
    for (const [key, val] of Object.entries(data)) {
      const el = m.querySelector('#' + key);
      if (!el) continue;
      if (el.tagName === 'INPUT' && el.type === 'checkbox') el.checked = !!val;
      else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = val ?? '';
      else if (el.tagName === 'SELECT') {
        if (val != null) { el.value = val; }
      }
      else el.textContent = val;
    }
  }

  ov.classList.remove('hidden');
  return m;
}
function closeModal() { $('#modalOverlay').classList.add('hidden'); $('#modal').innerHTML = ''; }
$('#modalOverlay').addEventListener('mousedown', e => { if (e.target === e.currentTarget) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closePopover(); } });

function updateDateWeekday(inputId) {
  const input = document.getElementById(inputId);
  const valEl = document.getElementById(inputId + '_val');
  if (!input || !valEl) return;
  const set = () => {
    valEl.textContent = input.value ? fmtDate(pLocal(input.value)) : 'Select date';
  };
  set();
  input.addEventListener('change', set);
}

function initDatePickers(modal) {
  modal.querySelectorAll('.dt-val').forEach(valEl => {
    valEl.onclick = e => {
      e.stopPropagation();
      const inputId = valEl.id.replace('_val', '');
      const input = document.getElementById(inputId);
      if (!input) return;
      const existing = document.getElementById('dpPopup');
      if (existing) { existing.remove(); return; }
      const popup = el('div', 'dp-popup');
      popup.id = 'dpPopup';
      let cm = state.cursor
        ? new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      if (input.value) {
        const d = pLocal(input.value);
        cm = new Date(d.getFullYear(), d.getMonth(), 1);
      }
      const head = el('div', 'mini-head');
      const prev = el('button', '', '‹');
      const next = el('button', '', '›');
      const title = el('b', '', '');
      head.append(prev, title, next);
      const dow = el('div', 'mini-dow');
      for (const i of dowOrder()) dow.appendChild(el('span', '', DOW[i][0]));
      const grid = el('div', 'dp-grid');
      popup.append(head, dow, grid);

      function render() {
        title.textContent = `${MONTHS[cm.getMonth()]} ${cm.getFullYear()}`;
        grid.innerHTML = '';
        const first = new Date(cm.getFullYear(), cm.getMonth(), 1);
        const offset = (first.getDay() - (state.settings.weekStart ? 1 : 0) + 7) % 7;
        const start = addDays(first, -offset);
        const today = new Date();
        const selDate = input.value ? pLocal(input.value) : null;
        for (let i = 0; i < 42; i++) {
          const d = addDays(start, i);
          const cell = el('div', 'dp-cell' +
            (d.getMonth() !== cm.getMonth() ? ' other' : '') +
            (sameDay(d, today) ? ' today' : '') +
            (selDate && sameDay(d, selDate) ? ' sel' : ''));
          cell.textContent = d.getDate();
          cell.onclick = () => {
            const iso = fISO(d, false);
            input.value = iso;
            const v = document.getElementById(inputId + '_val');
            if (v) v.textContent = fmtDate(d);
            popup.remove();
          };
          grid.appendChild(cell);
        }
      }

      prev.onclick = () => { cm = new Date(cm.getFullYear(), cm.getMonth() - 1, 1); render(); };
      next.onclick = () => { cm = new Date(cm.getFullYear(), cm.getMonth() + 1, 1); render(); };
      render();

      const rect = valEl.getBoundingClientRect();
      popup.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 244)) + 'px';
      popup.style.top = (rect.bottom + 4) + 'px';
      document.body.appendChild(popup);

      const closer = e => {
        if (!popup.contains(e.target) && e.target !== valEl) {
          popup.remove();
          document.removeEventListener('click', closer);
        }
      };
      setTimeout(() => document.addEventListener('click', closer), 0);
    };
  });
}

function setSel(sel, value, options) {
  sel.innerHTML = options.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${l}</option>`).join('');
}
function setOpts(container, items, selVal, valKey) {
  container.innerHTML = items.map(item =>
    `<div class="copt ${item[valKey] === selVal ? 'sel' : ''}" data-v="${item[valKey]}" style="background:${item.color || item[valKey]}"></div>`
  ).join('');
}

const CAL_COLORS = ['#FF6B6B', '#4D96FF', '#2EC4B6', '#F9C74F', '#845EC2', '#6BCB77', '#EF476F', '#FF9671', '#3A86FF', '#8AC926'];
const NOTE_COLORS = ['#F9C74F', '#FF9671', '#90BE6D', '#4D96FF', '#845EC2', '#F3722C', '#FF6B6B', '#45B7D1', '#96CEB4', '#DDA0DD'];

/* ---------- Event modal ---------- */
function openEventModal(ev, presetDate, presetTime) {
  const isNew = !ev;
  const startD = ev ? pLocal(ev.start) : pLocal((presetDate || todayISO()) + 'T' + (presetTime || '09:00'));
  const endD = ev ? pLocal(ev.end) : new Date(startD.getTime() + 3600000);
  const allDay = ev ? !!ev.allDay : false;
  const shownEndD = allDay ? addDays(endD, -1) : endD;

  const m = openModal('tpl-event', {
    evTitle_h: isNew ? 'New event' : 'Edit event',
    evTitle: ev?.title || '',
    evStartD: fISO(startD, false),
    evStartT: fISO(startD).slice(11),
    evEndD: fISO(shownEndD, false),
    evEndT: fISO(endD).slice(11),
    evLoc: ev?.location || '',
    evDesc: ev?.description || '',
    evAllDay: allDay,
    evSave: isNew ? 'Add event' : 'Save changes',
  });

  setSel($('#evCal', m), ev?.calendarId || state.calendars[0]?.id,
    state.calendars.map(c => [c.id, esc(c.name)]));
  setSel($('#evCat', m), ev?.categoryId || 'cat-none',
    state.categories.map(c => [c.id, esc(c.name)]));

  let evColor = ev?.color || null;
  const ec = $('#evColors', m);
  ec.innerHTML = '<div class="copt copt-auto' + (!evColor ? ' sel' : '') + '" data-v="">Auto</div>';
  for (const c of CAL_COLORS) {
    const chip = el('div', 'copt' + (evColor === c ? ' sel' : ''));
    chip.dataset.v = c;
    chip.style.background = c;
    ec.appendChild(chip);
  }
  $$('#evColors .copt', m).forEach(o => o.onclick = () => {
    $$('#evColors .copt', m).forEach(x => x.classList.remove('sel'));
    o.classList.add('sel');
    evColor = o.dataset.v || null;
  });

  // custom rrule
  if (ev?.rrule && !['FREQ=DAILY','FREQ=WEEKLY','FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR','FREQ=MONTHLY','FREQ=YEARLY'].includes(ev.rrule)) {
    const sel = $('#evRrule', m);
    const opt = document.createElement('option');
    opt.value = ev.rrule; opt.selected = true; opt.textContent = 'Custom (' + ev.rrule + ')';
    sel.appendChild(opt);
  }
  if (ev?.rrule) $('#evRrule', m).value = ev.rrule;

  setSel($('#evRem', m), ev?.reminder ?? '',
    [[null, 'No reminder'], [0, 'At start'], [5, '5 min before'], [15, '15 min before'],
     [30, '30 min before'], [60, '1 hour before'], [1440, '1 day before']]
      .map(([v, l]) => [v === null ? '' : String(v), l]));

  const toggleTimes = () => $$('.trow', m).forEach(r => r.style.visibility = $('#evAllDay', m).checked ? 'hidden' : 'visible');
  $('#evAllDay', m).onchange = toggleTimes; toggleTimes();

  updateDateWeekday('evStartD');
  updateDateWeekday('evEndD');
  initDatePickers(m);

  // delete button
  if (!isNew) {
    const del = $('#evDelete', m); del.classList.remove('hidden');
    del.onclick = async () => {
      if (!confirm(`Delete "${ev.title}"?`)) return;
      await window.api.deleteEvent(ev.id); closeModal(); await refresh(); toast('Event deleted');
    };
  }

  $('#evCancel', m).onclick = closeModal;
  $('#evSave', m).onclick = async () => {
    const title = $('#evTitle', m).value.trim();
    if (!title) { toast('Please enter a title', 'error'); return; }
    const ad = $('#evAllDay', m).checked;
    let start, end;
    if (ad) {
      start = $('#evStartD', m).value;
      end = fISO(addDays(pLocal($('#evEndD', m).value), 1), false);
      if (end <= start) end = fISO(addDays(pLocal(start), 1), false);
    } else {
      start = $('#evStartD', m).value + 'T' + $('#evStartT', m).value;
      end = $('#evEndD', m).value + 'T' + $('#evEndT', m).value;
      if (end <= start) end = fISO(new Date(pLocal(start).getTime() + 3600000));
    }
    const payload = {
      title,
      calendarId: $('#evCal', m).value,
      categoryId: $('#evCat', m).value === 'cat-none' ? null : $('#evCat', m).value,
      color: evColor,
      start, end, allDay: ad,
      rrule: $('#evRrule', m).value || null,
      reminder: $('#evRem', m).value === '' ? null : +$('#evRem', m).value,
      location: $('#evLoc', m).value.trim(),
      description: $('#evDesc', m).value.trim()
    };
    if (isNew) { await window.api.addEvent(payload); toast('Event added', 'success'); }
    else { await window.api.updateEvent(ev.id, payload); toast('Event saved', 'success'); }
    closeModal(); await refresh();
  };
}

/* ---------- Task modal ---------- */
function openTaskModal(task, presetDate) {
  const isNew = !task;
  const m = openModal('tpl-task', {
    tkTitle_h: isNew ? 'New task' : 'Edit task',
    tkTitle: task?.title || '',
    tkDue: task?.due || presetDate || '',
    tkPrio: task?.priority || 'medium',
    tkNotes: task?.notes || '',
    tkSave: isNew ? 'Add task' : 'Save changes',
  });
  $('#tkPrio', m).value = task?.priority || 'medium';

  if (!isNew) {
    $('#tkDoneRow', m).classList.remove('hidden');
    if (task.done) $('#tkDone', m).checked = true;
    const del = $('#tkDelete', m); del.classList.remove('hidden');
    del.onclick = async () => {
      if (!confirm(`Delete task "${task.title}"?`)) return;
      await window.api.deleteTask(task.id); closeModal(); await refresh(); toast('Task deleted');
    };
  }

  updateDateWeekday('tkDue');
  initDatePickers(m);

  $('#tkCancel', m).onclick = closeModal;
  $('#tkSave', m).onclick = async () => {
    const title = $('#tkTitle', m).value.trim();
    if (!title) { toast('Please enter a title', 'error'); return; }
    const payload = {
      title,
      due: $('#tkDue', m).value || null,
      priority: $('#tkPrio', m).value,
      notes: $('#tkNotes', m).value.trim(),
      ...(isNew ? { done: false, createdAt: todayISO() } : { done: $('#tkDone', m).checked })
    };
    if (isNew) { await window.api.addTask(payload); toast('Task added', 'success'); }
    else { await window.api.updateTask(task.id, payload); toast('Task saved', 'success'); }
    closeModal(); await refresh();
  };
}

/* ---------- Note modal ---------- */
function openNoteModal(note, presetDate) {
  const isNew = !note;
  const selColor = note?.color || NOTE_COLORS[0];
  const m = openModal('tpl-note', {
    ntTitle_h: isNew ? 'New note' : 'Edit note',
    ntTitle: note?.title || '',
    ntDate: note?.date || presetDate || todayISO(),
    ntText: note?.text || '',
    ntSave: isNew ? 'Add note' : 'Save changes',
  });
  setOpts($('#ntColors', m), NOTE_COLORS.map(c => ({ color: c, id: c })), selColor, 'id', 'color');
  let color = selColor;
  $$('#ntColors .copt', m).forEach(o => o.onclick = () => {
    $$('#ntColors .copt', m).forEach(x => x.classList.remove('sel'));
    o.classList.add('sel'); color = o.dataset.v;
  });

  if (!isNew) {
    const del = $('#ntDelete', m); del.classList.remove('hidden');
    del.onclick = async () => {
      if (!confirm('Delete this note?')) return;
      await window.api.deleteNote(note.id); closeModal(); await refresh(); toast('Note deleted');
    };
  }

  updateDateWeekday('ntDate');
  initDatePickers(m);

  $('#ntCancel', m).onclick = closeModal;
  $('#ntSave', m).onclick = async () => {
    const title = $('#ntTitle', m).value.trim();
    const text = $('#ntText', m).value.trim();
    if (!title && !text) { toast('Write something first', 'error'); return; }
    const payload = { title: title || 'Note', text, date: $('#ntDate', m).value || todayISO(), color };
    if (isNew) { await window.api.addNote(payload); toast('Note added', 'success'); }
    else { await window.api.updateNote(note.id, payload); toast('Note saved', 'success'); }
    closeModal(); await refresh();
  };
}

/* ---------- New calendar modal ---------- */
function openCalendarModal(cal) {
  const isEdit = !!cal;
  const m = openModal('tpl-calendar');
  if (isEdit) {
    $('#ncName', m).value = cal.name;
    $('#ncSave', m).textContent = 'Save';
  } else {
    $('#ncSave', m).textContent = 'Create calendar';
  }
  let color = cal ? cal.color : CAL_COLORS[state.calendars.length % CAL_COLORS.length];
  setOpts($('#ncColors', m), CAL_COLORS.map(c => ({ color: c, id: c })), color, 'id', 'color');
  $$('#ncColors .copt', m).forEach(o => o.onclick = () => {
    $$('#ncColors .copt', m).forEach(x => x.classList.remove('sel'));
    o.classList.add('sel'); color = o.dataset.v;
  });
  $('#ncCancel', m).onclick = closeModal;
  $('#ncSave', m).onclick = async () => {
    const name = $('#ncName', m).value.trim();
    if (!name) { toast('Please enter a name', 'error'); return; }
    if (isEdit) {
      await window.api.updateCalendar(cal.id, { name, color });
      state.calendars = state.calendars.map(c => c.id === cal.id ? { ...c, name, color } : c);
    } else {
      const newCal = await window.api.addCalendar({ name, color });
      state.calendars.push(newCal);
    }
    rebuildColorMaps();
    closeModal(); await refresh(); toast(`Calendar "${name}" ${isEdit ? 'updated' : 'created'}`, 'success');
  };
}

/* ---------- Settings modal ---------- */
function openSettingsModal() {
  const s = state.settings;
  const m = openModal('tpl-settings', {
    stName: s.name,
    stCity: s.city,
    stRem: s.remindersEnabled,
    stMin: s.startMinimized,
    stBoot: s.startOnBoot,
    stDark: s.darkMode,
  });
  if (s.hour24) { $('#stHour .active', m).classList.remove('active'); $('#stHour button[data-v="1"]', m).classList.add('active'); }
  else { $('#stHour .active', m).classList.remove('active'); $('#stHour button[data-v="0"]', m).classList.add('active'); }
  if (s.weekStart) { $('#stWeek .active', m).classList.remove('active'); $('#stWeek button[data-v="1"]', m).classList.add('active'); }
  else { $('#stWeek .active', m).classList.remove('active'); $('#stWeek button[data-v="0"]', m).classList.add('active'); }
  const fmt = s.dateFormat || 'DD/MM/YYYY';
  $('#stDateFmt .active', m).classList.remove('active');
  $(`#stDateFmt button[data-v="${fmt}"]`, m).classList.add('active');

  const accents = [['coral', 'Coral', '#FF6B6B'], ['teal', 'Teal', '#14B8A6'], ['violet', 'Violet', '#845EC2'], ['amber', 'Amber', '#F59E0B'], ['blue', 'Sky', '#4D96FF']];
  setOpts($('#stAccents', m), accents.map(([k, l, c]) => ({ color: c, id: k })), s.accent, 'id', 'color');
  let accent = s.accent;
  $$('#stAccents .copt', m).forEach(o => o.onclick = () => {
    $$('#stAccents .copt', m).forEach(x => x.classList.remove('sel'));
    o.classList.add('sel'); accent = o.dataset.v;
    document.body.dataset.accent = accent;
  });

  const segWire = id => $$('#' + id + ' button', m).forEach(b => b.onclick = () => {
    $$('#' + id + ' button', m).forEach(x => x.classList.remove('active')); b.classList.add('active');
  });
  segWire('stHour'); segWire('stWeek'); segWire('stDateFmt');

  $('#stCancel', m).onclick = () => { document.body.dataset.accent = s.accent; closeModal(); };
  $('#stSave', m).onclick = async () => {
    const patch = {
      name: $('#stName', m).value.trim(),
      city: $('#stCity', m).value.trim(),
      accent,
      hour24: $('#stHour .active', m).dataset.v === '1',
      weekStart: +$('#stWeek .active', m).dataset.v,
      dateFormat: $('#stDateFmt .active', m).dataset.v,
      remindersEnabled: $('#stRem', m).checked,
      startMinimized: $('#stMin', m).checked,
      startOnBoot: $('#stBoot', m).checked,
      darkMode: $('#stDark', m).checked
    };
    state.settings = await window.api.updateSettings(patch);
    renderProfile(); closeModal(); await refresh(); toast('Settings saved', 'success');
  };
}

/* ---------- search ---------- */
let searchTimer = null;
async function wireSearch() {
  const input = $('#search'), box = $('#searchResults');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { box.classList.add('hidden'); return; }
    searchTimer = setTimeout(async () => {
      const hits = await window.api.searchEvents(q);
      box.innerHTML = '';
      if (!hits.length) box.appendChild(el('div', 'sr-empty', 'No matching events'));
      for (const ev of hits) {
        const item = el('div', 'sr-item');
        const dot = el('span', 'dot'); dot.style.background = eventColor(ev);
        item.append(dot, el('span', 't', ev.title),
          el('span', 'd', fmtDayLabel((ev.start || ev.instanceStart).slice(0, 10))));
        item.onclick = () => {
          box.classList.add('hidden'); input.value = '';
          state.cursor = pLocal((ev.start || ev.instanceStart).slice(0, 10));
          state.view = 'day'; refresh();
        };
        box.appendChild(item);
      }
      box.classList.remove('hidden');
    }, 220);
  });
  document.addEventListener('click', e => {
    if (!$('#searchWrap').contains(e.target)) box.classList.add('hidden');
  });
}

/* ---------- import / export ---------- */
async function doImport() {
  const res = await window.api.importFile();
  if (res.canceled) return;
  const boot = await window.api.getBootstrap();
  state.calendars = boot.calendars; rebuildColorMaps();
  await refresh();
  if (res.count > 0) toast(`Imported ${res.count} event${res.count === 1 ? '' : 's'} into "${res.calendar.name}" 🎉`, 'success');
  else toast('Nothing could be imported from that file', 'error');
  if (res.skipped && res.skipped.length) console.warn('Import skipped:', res.skipped);
}
function doImportUrl() {
  const m = $('#modal');
  m.innerHTML = `<h2>Import from URL</h2>
    <div class="f-row"><label>.ics URL</label><input type="url" id="iuUrl" placeholder="https://example.com/calendar.ics" autofocus></div>
    <div class="m-actions">
      <button class="neutral" id="iuCancel">Cancel</button>
      <button class="primary" id="iuImport">Import</button>
    </div>`;
  $('#modalOverlay').classList.remove('hidden');
  $('#iuCancel', m).onclick = closeModal;
  $('#iuImport', m).onclick = async () => {
    const url = $('#iuUrl', m).value.trim();
    if (!url) { toast('Please enter a URL', 'error'); return; }
    closeModal();
    const res = await window.api.importUrl(url);
    if (res.error) { toast(`Import failed: ${res.error}`, 'error'); return; }
    const boot = await window.api.getBootstrap();
    state.calendars = boot.calendars; rebuildColorMaps();
    await refresh();
    toast(`Imported ${res.count} events into "${res.calendar.name}" 🎉`, 'success');
    if (res.skipped && res.skipped.length) console.warn('Import skipped:', res.skipped);
  };
  setTimeout(() => $('#iuUrl', m).focus(), 0);
}
async function doExport() {
  const m = $('#modal');
  m.innerHTML = `<h2>Export calendar</h2>
    <div class="f-row" style="margin-bottom:8px"><label class="f-check"><input type="checkbox" id="exAll" checked> All calendars</label></div>
    <div id="exCalList">${state.calendars.map(c =>
      `<div class="f-row" style="margin:0 0 4px 18px"><label class="f-check"><input type="checkbox" class="exCal" data-id="${c.id}" checked> <span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${c.color}"></span> ${esc(c.name)}</label></div>`
    ).join('')}</div>
    <div class="m-actions">
      <button class="neutral" id="exCancel">Cancel</button>
      <button class="primary" id="exExport">Export</button>
    </div>`;
  $('#modalOverlay').classList.remove('hidden');
  const cbs = () => $$('.exCal', m);
  const all = $('#exAll', m);
  all.onchange = () => cbs().forEach(cb => cb.checked = all.checked);
  cbs().forEach(cb => cb.onchange = () => { all.checked = cbs().every(c => c.checked); });
  $('#exCancel', m).onclick = closeModal;
  $('#exExport', m).onclick = async () => {
    const ids = [...cbs()].filter(cb => cb.checked).map(cb => cb.dataset.id);
    if (!ids.length) { toast('Select at least one calendar', 'error'); return; }
    closeModal();
    const res = await window.api.exportFile(ids);
    if (res.canceled) return;
    toast(`Exported ${res.count} events to .ics 💾`, 'success');
  };
}

/* ---------- color maps (cached) ---------- */
let _calColorMapCache = null;
let _catColorMapCache = null;
function rebuildColorMaps() {
  const newCal = Object.fromEntries(state.calendars.map(c => [c.id, c.color]));
  const newCat = Object.fromEntries(state.categories.filter(c => c.color).map(c => [c.id, c.color]));
  const calChanged = JSON.stringify(newCal) !== JSON.stringify(_calColorMapCache);
  const catChanged = JSON.stringify(newCat) !== JSON.stringify(_catColorMapCache);
  if (calChanged) { _calColorMapCache = newCal; state.calColorMap = newCal; }
  if (catChanged) { _catColorMapCache = newCat; state.catColorMap = newCat; }
}

/* ---------- boot ---------- */
async function boot() {
  const boot = await window.api.getBootstrap();
  state.settings = boot.settings;
  state.calendars = boot.calendars;
  state.categories = boot.categories;
  rebuildColorMaps();
  renderProfile();

  const hv = location.hash.slice(1);
  if (['month', 'week', 'day'].includes(hv)) state.view = hv;

  // ribbon & window controls
  setInterval(tickClock, 1000); tickClock();
  $('#userArea').onclick = openSettingsModal;
  $('#winMin').onclick = () => window.api.winMinimize();
  $('#winMax').onclick = () => window.api.winMaximize();
  $('#winClose').onclick = () => window.api.winClose();

  // toolbar
  $('#navPrev').onclick = () => navigate(-1);
  $('#navNext').onclick = () => navigate(1);
  $('#navToday').onclick = goToday;
  $$('#viewSwitch button').forEach(b => b.onclick = () => { state.view = b.dataset.view; refresh(); });
  $('#btnNewEvent').onclick = () => openEventModal(null, fISO(state.cursor, false));
  $('#btnNewTask').onclick = () => openTaskModal(null, fISO(state.cursor, false));
  $('#btnNewNote').onclick = () => openNoteModal(null, fISO(state.cursor, false));
  $('#btnImport').onclick = doImport;
  $('#btnImportUrl').onclick = doImportUrl;
  $('#btnExport').onclick = doExport;
  $('#btnSettings').onclick = openSettingsModal;
  $('#addCalBtn').onclick = openCalendarModal;

  wireSearch();

  // tray quick-add + reminders from main
  window.api.onQuickAdd(type => {
    if (type === 'task') openTaskModal(null, todayISO());
    else openEventModal(null, todayISO());
  });
  window.api.onReminder(info => toast(`🔔 Reminder: ${info.title}`));

  // keyboard shortcuts
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return; // ignore when typing
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') {
        handleUndo();
        e.preventDefault();
      }
      return;
    }
  switch (e.key) {
    case 'n': case 'N': e.preventDefault(); navigate(1); break;
    case 'p': case 'P': e.preventDefault(); navigate(-1); break;
    case 't': case 'T': e.preventDefault(); goToday(); break;
    case '1': e.preventDefault(); state.view = 'month'; refresh(); break;
    case '2': e.preventDefault(); state.view = 'week'; refresh(); break;
    case '3': e.preventDefault(); state.view = 'day'; refresh(); break;
    case 'e': case 'E': e.preventDefault(); openEventModal(null, fISO(state.cursor, false)); break;
    case '/': e.preventDefault(); $('#search').focus(); break;
    case '?': e.preventDefault(); showShortcuts(); break;
  }
});

function showShortcuts() {
  const overlay = el('div', 'shortcuts-overlay');
  overlay.innerHTML = `<div class="shortcuts-box">
    <h2>Keyboard shortcuts</h2>
    <table>
      <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Navigate (n / p)</td></tr>
      <tr><td><kbd>T</kbd></td><td>Go to today</td></tr>
      <tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td><td>Month / Week / Day view</td></tr>
      <tr><td><kbd>E</kbd></td><td>New event</td></tr>
      <tr><td><kbd>/</kbd></td><td>Search</td></tr>
      <tr><td><kbd>?</kbd></td><td>This help</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Close modal / popover</td></tr>
      <tr><td><kbd>Ctrl+Z</kbd></td><td>Undo</td></tr>
    </table>
    <button class="neutral" id="skClose">Close</button>
  </div>`;
  document.body.appendChild(overlay);
  $('#skClose', overlay).onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

  // undo helper
  async function handleUndo() {
    const ok = await window.api.undo();
    if (ok) {
      const boot = await window.api.getBootstrap();
      state.settings = boot.settings;
      state.calendars = boot.calendars;
      state.categories = boot.categories;
      rebuildColorMaps();
      await refresh();
      toast('Undone');
    } else {
      toast('Nothing to undo', 'error');
    }
  }

  await refresh();
}
boot();
