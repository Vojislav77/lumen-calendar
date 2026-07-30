'use strict';
/**
 * importers.js — .ics import/export and .csv import for Lumen Calendar.
 * ICS parsing via ical.js, CSV via papaparse.
 * All datetimes converted to floating-local ISO ("YYYY-MM-DDTHH:MM" / "YYYY-MM-DD").
 */
const ICAL = require('ical.js');
const Papa = require('papaparse');
const { parseLocal, fmtLocal, addDaysISO, uid } = require('./store');

/* ================= ICS IMPORT ================= */
function icalTimeToLocalISO(t) {
  // Use the raw components (floating) — good enough for personal calendars.
  const p = n => String(n).padStart(2, '0');
  const date = `${t.year}-${p(t.month)}-${p(t.day)}`;
  if (t.isDate) return date;
  return `${date}T${p(t.hour)}:${p(t.minute)}`;
}

function importICS(text, calendarId) {
  const jcal = ICAL.parse(text);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents('vevent');
  const events = [];
  const skipped = [];

  for (const ve of vevents) {
    try {
      const ev = new ICAL.Event(ve);
      const dtstartProp = ve.getFirstProperty('dtstart');
      const dtstart = dtstartProp.getFirstValue();
      const allDay = dtstart.isDate === true;
      const start = icalTimeToLocalISO(dtstart);

      let end;
      const dtendProp = ve.getFirstProperty('dtend');
      if (dtendProp) {
        end = icalTimeToLocalISO(dtendProp.getFirstValue());
      } else {
        end = allDay ? addDaysISO(start, 1) : addMinutes(start, 60);
      }
      if (allDay && end <= start) end = addDaysISO(start, 1);
      if (!allDay && end <= start) end = addMinutes(start, 60);

      let rrule = null;
      const rruleProp = ve.getFirstProperty('rrule');
      if (rruleProp) rrule = rruleProp.getFirstValue().toString();

      const exdates = [];
      for (const exProp of ve.getAllProperties('exdate')) {
        for (const v of exProp.getValues()) exdates.push(icalTimeToLocalISO(v));
      }

      let reminder = null;
      for (const alarm of ve.getAllSubcomponents('valarm')) {
        const trig = alarm.getFirstPropertyValue('trigger');
        if (trig) {
          const mins = Math.round(Math.abs(trig.toSeconds()) / 60);
          if (trig.toSeconds() <= 0) { reminder = mins; break; }
        }
      }

      const categories = ve.getFirstPropertyValue('categories');

      events.push({
        id: uid('ev'),
        title: ev.summary || '(no title)',
        calendarId,
        categoryId: null,
        importedCategory: categories ? String(categories) : null,
        start, end, allDay,
        rrule, exdates: exdates.length ? exdates : null,
        reminder,
        location: ev.location || '',
        description: ev.description || ''
      });
    } catch (e) {
      skipped.push(e.message);
    }
  }
  return { events, skipped, count: events.length };
}

function addMinutes(iso, mins) {
  const d = parseLocal(iso.length === 10 ? iso + 'T00:00' : iso);
  d.setUTCMinutes(d.getUTCMinutes() + mins);
  return fmtLocal(d, iso.length > 10);
}

/* ================= ICS EXPORT ================= */
function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsDate(iso, allDay, isEnd = false) {
  if (allDay) return iso.replace(/-/g, '').slice(0, 8);
  const d = parseLocal(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}

function exportICS(events, calName = 'Lumen Calendar') {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lumen Calendar//EN',
    `X-WR-CALNAME:${icsEscape(calName)}`, 'CALSCALE:GREGORIAN'
  ];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@lumen-calendar`);
    lines.push(`DTSTAMP:${icsDate(fmtLocal(new Date()), false)}`);
    lines.push(`DTSTART${ev.allDay ? ';VALUE=DATE' : ''}:${icsDate(ev.start, ev.allDay)}`);
    lines.push(`DTEND${ev.allDay ? ';VALUE=DATE' : ''}:${icsDate(ev.end, ev.allDay, true)}`);
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
    if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
    if (ev.exdates) for (const ex of ev.exdates) {
      lines.push(`EXDATE${ev.allDay ? ';VALUE=DATE' : ''}:${icsDate(ex, ev.allDay)}`);
    }
    if (ev.reminder != null) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY',
        `TRIGGER:-PT${ev.reminder}M`, `DESCRIPTION:${icsEscape(ev.title)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/* ================= CSV IMPORT ================= */
// Supports a generic template and Microsoft Outlook CSV exports.
function norm(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }

const COL_ALIASES = {
  title: ['title', 'subject', 'summary', 'event', 'name', 'naziv', 'naslov'],
  startDate: ['startdate', 'start', 'date', 'begindate', 'from', 'datum', 'pocetak'],
  startTime: ['starttime', 'time', 'fromtime', 'vreme', 'vrijeme'],
  endDate: ['enddate', 'end', 'until', 'to', 'zavrsetak', 'kraj'],
  endTime: ['endtime', 'totime', 'untiltime'],
  allDay: ['allday', 'alldayevent', 'celodnevni'],
  location: ['location', 'place', 'lokacija', 'mesto', 'mjesto'],
  description: ['description', 'notes', 'details', 'opis', 'body'],
  category: ['category', 'categories', 'kategorija']
};

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (aliases.includes(n) && map[field] === undefined) map[field] = i;
    }
  });
  return map;
}

function parseCSVDate(raw) {
  // Accepts YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/.exec(s);
  if (m) {
    let a = +m[1], b = +m[2];
    // Heuristic: if first number > 12 it's a day; if both <= 12 prefer DD/MM (most common outside US)
    const day = a > 12 ? a : b > 12 ? b : a;
    const month = a > 12 ? b : b > 12 ? a : b;
    return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}
function parseCSVTime(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(s);
  if (!m) return null;
  let h = +m[1];
  if (m[3]) {
    if (/pm/i.test(m[3]) && h < 12) h += 12;
    if (/am/i.test(m[3]) && h === 12) h = 0;
  }
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
function truthy(v) {
  return /^(true|yes|da|1)$/i.test(String(v || '').trim());
}

function importCSV(text, calendarId) {
  const res = Papa.parse(text, { skipEmptyLines: true });
  const rows = res.data;
  if (!rows.length) return { events: [], skipped: ['empty file'], count: 0, categoriesFound: [] };

  const map = mapHeaders(rows[0]);
  if (map.title === undefined || map.startDate === undefined) {
    return { events: [], skipped: ['Could not find title/subject and start date columns'], count: 0, categoriesFound: [] };
  }

  const events = [];
  const skipped = [];
  const categoriesFound = new Set();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    try {
      const title = String(r[map.title] || '').trim();
      const startDate = parseCSVDate(r[map.startDate]);
      if (!title || !startDate) { skipped.push(`row ${i + 1}: missing title or start date`); continue; }

      const allDay = map.allDay !== undefined ? truthy(r[map.allDay])
        : map.startTime === undefined || !parseCSVTime(r[map.startTime]);

      let start, end;
      if (allDay) {
        start = startDate;
        const endDate = map.endDate !== undefined ? parseCSVDate(r[map.endDate]) : null;
        // CSV end dates are inclusive (Outlook style); store exclusive (iCal style)
        end = endDate && endDate >= startDate ? addDaysISO(endDate, 1) : addDaysISO(startDate, 1);
      } else {
        const st = parseCSVTime(r[map.startTime]) || '09:00';
        start = `${startDate}T${st}`;
        const endDate = (map.endDate !== undefined && parseCSVDate(r[map.endDate])) || startDate;
        const et = (map.endTime !== undefined && parseCSVTime(r[map.endTime])) || null;
        end = et ? `${endDate}T${et}` : addMinutes(start, 60);
        if (end <= start) end = addMinutes(start, 60);
      }

      let importedCategory = null;
      if (map.category !== undefined) {
        importedCategory = String(r[map.category] || '').trim() || null;
        if (importedCategory) categoriesFound.add(importedCategory);
      }

      events.push({
        id: uid('ev'),
        title,
        calendarId,
        categoryId: null,
        importedCategory,
        start, end, allDay,
        rrule: null, exdates: null, reminder: null,
        location: map.location !== undefined ? String(r[map.location] || '').trim() : '',
        description: map.description !== undefined ? String(r[map.description] || '').trim() : ''
      });
    } catch (e) { skipped.push(`row ${i + 1}: ${e.message}`); }
  }
  return { events, skipped, count: events.length, categoriesFound: [...categoriesFound] };
}

module.exports = { importICS, exportICS, importCSV };
