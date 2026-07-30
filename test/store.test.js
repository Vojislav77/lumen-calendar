'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { Store, parseLocal, fmtLocal, addDaysISO } = require('../src/store');
const { importICS, exportICS, importCSV } = require('../src/importers');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));

describe('Store', () => {
  let store;
  const dbPath = path.join(TMP, 'test-data.json');

  before(() => { store = new Store(dbPath); });
  after(() => { try { fs.unlinkSync(dbPath); } catch (_) {} });

  it('has default calendars and categories', () => {
    assert.equal(store.data.calendars.length, 2);
    assert.equal(store.data.categories.length, 5);
  });

  it('has darkMode setting defaulting to false', () => {
    assert.equal(store.data.settings.darkMode, false);
  });

  it('adds an event', () => {
    const ev = store.add('events', { title: 'Test', start: '2026-07-30T10:00', end: '2026-07-30T11:00' });
    assert.ok(ev.id);
    assert.equal(ev.title, 'Test');
    assert.equal(store.data.events.length, 1);
  });

  it('updates an event', () => {
    const ev = store.data.events[0];
    store.update('events', ev.id, { title: 'Updated' });
    assert.equal(store.data.events[0].title, 'Updated');
  });

  it('removes an event', () => {
    const ev = store.data.events[0];
    store.remove('events', ev.id);
    assert.equal(store.data.events.length, 0);
  });

  it('undo an add', () => {
    const ev = store.add('events', { title: 'Undo me', start: '2026-08-01T09:00', end: '2026-08-01T10:00' });
    assert.equal(store.data.events.length, 1);
    const prev = store.undo();
    assert.ok(prev);
    assert.equal(store.data.events.length, 0);
  });

  it('undo an update', () => {
    store.add('events', { title: 'Original', start: '2026-08-01T09:00', end: '2026-08-01T10:00' });
    const ev = store.data.events[0];
    store.update('events', ev.id, { title: 'Changed' });
    assert.equal(store.data.events[0].title, 'Changed');
    store.undo();
    assert.equal(store.data.events[0].title, 'Original');
  });

  it('undo a delete', () => {
    const id = store.data.events[0].id;
    store.remove('events', id);
    assert.equal(store.data.events.length, 0);
    store.undo();
    assert.equal(store.data.events.length, 1);
  });

  it('searchEvents by title', () => {
    store.add('events', { title: 'Coffee with Ana', start: '2026-08-10T10:00', end: '2026-08-10T11:00', location: 'Cafe', description: 'Catch up' });
    store.add('events', { title: 'Gym', start: '2026-08-10T14:00', end: '2026-08-10T15:00' });
    const hits = store.searchEvents('coffee');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, 'Coffee with Ana');
  });

  it('searchEvents by location', () => {
    const hits = store.searchEvents('cafe');
    assert.equal(hits.length, 1);
  });

  it('searchEvents by description', () => {
    const hits = store.searchEvents('catch');
    assert.equal(hits.length, 1);
  });

  it('searchEvents returns empty for no match', () => {
    const hits = store.searchEvents('zzzzz');
    assert.equal(hits.length, 0);
  });
});

describe('Recurrence', () => {
  let store;
  const dbPath = path.join(TMP, 'test-rrule.json');

  before(() => { store = new Store(dbPath); });
  after(() => { try { fs.unlinkSync(dbPath); } catch (_) {} });

  it('expands daily event', () => {
    store.add('events', { title: 'Daily standup', start: '2026-07-01T09:00', end: '2026-07-01T09:30', rrule: 'FREQ=DAILY' });
    const instances = store.expandEvents('2026-07-01T00:00', '2026-07-05T00:00');
    assert.equal(instances.length, 4);
    assert.ok(instances.every(i => i.recurring));
  });

  it('handles non-recurring event', () => {
    const instances = store.expandEvents('2026-07-01T00:00', '2026-07-31T00:00');
    const nonRecurring = instances.filter(i => !i.recurring);
    assert.equal(nonRecurring.length, 0);
  });
});

describe('Import / Export', () => {
  it('exports and re-imports ICS', () => {
    const events = [
      { id: 'ev-1', title: 'Test event', start: '2026-08-15T14:00', end: '2026-08-15T15:00', calendarId: 'cal-1', allDay: false, rrule: null, exdates: null, reminder: null, location: 'Office', description: '' }
    ];
    const ics = exportICS(events);
    assert.ok(ics.includes('BEGIN:VCALENDAR'));
    assert.ok(ics.includes('SUMMARY:Test event'));
    assert.ok(ics.includes('LOCATION:Office'));

    const result = importICS(ics, 'cal-1');
    assert.equal(result.count, 1);
    assert.equal(result.events[0].title, 'Test event');
    assert.equal(result.events[0].location, 'Office');
  });

  it('imports CSV', () => {
    const csv = 'Subject,Start Date,Start Time\nMeeting,2026-09-01,10:00\n';
    const result = importCSV(csv, 'cal-1');
    assert.equal(result.count, 1);
    assert.equal(result.events[0].title, 'Meeting');
  });

  it('handles empty CSV', () => {
    const result = importCSV('', 'cal-1');
    assert.equal(result.count, 0);
  });

  it('handles CSV with various date formats', () => {
    const csv = 'Title,Start Date\nTest,01.02.2026\n';
    const result = importCSV(csv, 'cal-1');
    assert.equal(result.count, 1);
  });
});

describe('Date utils', () => {
  it('parseLocal and fmtLocal roundtrip', () => {
    const iso = '2026-12-25T10:30';
    const d = parseLocal(iso);
    assert.equal(fmtLocal(d), iso);
  });

  it('addDaysISO', () => {
    assert.equal(addDaysISO('2026-01-01', 1), '2026-01-02');
    assert.equal(addDaysISO('2026-01-01T10:00', 1), '2026-01-02T10:00');
  });
});

describe('Settings defaults', () => {
  it('new store has darkMode false', () => {
    const dbPath = path.join(TMP, 'test-settings.json');
    const s = new Store(dbPath);
    assert.equal(s.data.settings.darkMode, false);
    try { fs.unlinkSync(dbPath); } catch (_) {}
  });
});
