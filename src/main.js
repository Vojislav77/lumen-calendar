'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, Notification, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { Store, parseLocal, fmtLocal } = require('./store');
const { importICS, exportICS, importCSV } = require('./importers');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'LumenCalendar/1.0' }, timeout: 15000 }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchUrl(res.headers.location));
        }
        resolve({ status: res.statusCode, statusText: res.statusMessage, body: data });
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Connection timed out')); });
  });
}

const isDev = !app.isPackaged;
let win = null;
let tray = null;
let store = null;
let quitting = false;

/* ---------------- window ---------------- */
function iconPath() {
  // user-provided icon lives in assets; fallback to bundled placeholder
  const candidates = [
    path.join(__dirname, '..', 'assets', 'icon.png'),
    path.join(__dirname, '..', 'assets', 'icons', '256x256.png')
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch (_) {} }
  return null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#F6F8FB',
    title: 'Lumen Calendar',
    icon: iconPath() || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'),
    process.env.LUMEN_VIEW ? { hash: process.env.LUMEN_VIEW } : {});

  win.once('ready-to-show', () => {
    if (!(store && store.data.settings.startMinimized)) win.show();
    if (process.env.LUMEN_SMOKE) {
      setTimeout(async () => {
        try {
          if (process.env.LUMEN_JS) {
            await win.webContents.executeJavaScript(process.env.LUMEN_JS);
            await new Promise(r => setTimeout(r, 900));
          }
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.LUMEN_SMOKE, img.toPNG());
        } catch (e) { console.error('smoke capture failed', e); }
        quitting = true; app.quit();
      }, 3500);
    }
  });

  win.on('close', e => {
    if (!quitting) { e.preventDefault(); win.hide(); }   // close-to-tray
  });
  win.on('closed', () => { win = null; });
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

/* ---------------- tray ---------------- */
function createTray() {
  const p = iconPath();
  let img = p ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
  if (!img.isEmpty() && img.getSize().width > 24) img = img.resize({ width: 22 });
  tray = new Tray(img);
  tray.setToolTip('Lumen Calendar');
  rebuildTrayMenu();
  tray.on('click', () => toggleWindow());
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: toggleWindow },
    { type: 'separator' },
    { label: 'Quick add event', click: () => { showWindow(); win.webContents.send('quick-add', 'event'); } },
    { label: 'Quick add task', click: () => { showWindow(); win.webContents.send('quick-add', 'task'); } },
    { type: 'separator' },
    { label: 'Quit Lumen Calendar', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function toggleWindow() {
  if (win && win.isVisible() && !win.isMinimized()) win.hide();
  else showWindow();
}

/* ---------------- reminders ---------------- */
function checkReminders() {
  if (!store || !store.data.settings.remindersEnabled) return;
  if (!Notification.isSupported()) return;
  const now = new Date();
  const nowISO = fmtLocal(new Date(Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())));
  // expand a window covering the longest possible reminder (1 day ahead)
  const ahead = new Date(parseLocal(nowISO).getTime() + 26 * 3600 * 1000);
  const instances = store.expandEvents(nowISO, fmtLocal(ahead));
  for (const ev of instances) {
    if (ev.reminder == null) continue;
    const startMs = parseLocal(ev.allDay ? ev.instanceStart + 'T09:00' : ev.instanceStart).getTime();
    const nowMs = parseLocal(nowISO).getTime();
    const diffMin = Math.round((startMs - nowMs) / 60000);
    if (diffMin < 0 || diffMin > ev.reminder) continue;
    const key = `${ev.id}|${ev.instanceStart}`;
    if (store.wasNotified(key)) continue;
    store.markNotified(key);
    const when = ev.allDay ? 'today (all day)' :
      `at ${ev.instanceStart.slice(11)}`;
    const n = new Notification({
      title: ev.title,
      body: `Starts ${when}${ev.location ? ' · ' + ev.location : ''}`,
      icon: iconPath() || undefined,
      silent: false
    });
    n.on('click', showWindow);
    n.show();
    if (win) win.webContents.send('reminder-fired', { title: ev.title, instanceStart: ev.instanceStart });
  }
}

/* ---------------- IPC ---------------- */
function registerIPC() {
  const S = () => store;

  ipcMain.handle('get-bootstrap', () => ({
    settings: store.data.settings,
    calendars: store.data.calendars,
    categories: store.data.categories,
    version: app.getVersion()
  }));

  ipcMain.handle('get-range', (e, { start, end }) => ({
    events: store.expandEvents(start, end),
    tasks: store.tasksInRange(start, end),
    notes: store.notesInRange(start, end)
  }));

  // events
  ipcMain.handle('add-event', (e, ev) => { ev.id = undefined; return store.add('events', ev); });
  ipcMain.handle('update-event', (e, { id, patch }) => store.update('events', id, patch));
  ipcMain.handle('delete-event', (e, id) => store.remove('events', id));

  // tasks
  ipcMain.handle('add-task', (e, t) => { t.id = undefined; return store.add('tasks', t); });
  ipcMain.handle('update-task', (e, { id, patch }) => store.update('tasks', id, patch));
  ipcMain.handle('delete-task', (e, id) => store.remove('tasks', id));

  // notes
  ipcMain.handle('add-note', (e, n) => { n.id = undefined; return store.add('notes', n); });
  ipcMain.handle('update-note', (e, { id, patch }) => store.update('notes', id, patch));
  ipcMain.handle('delete-note', (e, id) => store.remove('notes', id));

  // calendars & categories
  ipcMain.handle('add-calendar', (e, c) => store.add('calendars', c));
  ipcMain.handle('update-calendar', (e, { id, patch }) => store.update('calendars', id, patch));
  ipcMain.handle('delete-calendar', (e, id) => {
    if (store.data.calendars.length <= 1) return { error: 'At least one calendar is required' };
    const fallback = store.data.calendars.find(c => c.id !== id);
    for (const ev of store.data.events) if (ev.calendarId === id) ev.calendarId = fallback.id;
    store.save();
    return store.remove('calendars', id);
  });
  ipcMain.handle('add-category', (e, c) => store.add('categories', c));

  // settings
  ipcMain.handle('update-settings', (e, patch) => {
    Object.assign(store.data.settings, patch);
    store.save();
    if ('startOnBoot' in patch) app.setLoginItemSettings({ openAtLogin: patch.startOnBoot });
    return store.data.settings;
  });

  // window controls
  ipcMain.on('win-minimize', () => win && win.minimize());
  ipcMain.on('win-maximize', () => {
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('win-close', () => { quitting = false; win && win.close(); });
  ipcMain.handle('win-is-maximized', () => (win ? win.isMaximized() : false));

  // import
  ipcMain.handle('import-file', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Import calendar',
      filters: [
        { name: 'Calendar files', extensions: ['ics', 'csv'] },
        { name: 'iCalendar', extensions: ['ics'] },
        { name: 'CSV', extensions: ['csv'] }
      ],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const file = res.filePaths[0];
    const text = fs.readFileSync(file, 'utf8');
    const base = path.basename(file).replace(/\.(ics|csv)$/i, '');
    let cal = store.data.calendars.find(c => c.name.toLowerCase() === base.toLowerCase());
    if (!cal) {
      const palette = ['#FF6B6B', '#4D96FF', '#2EC4B6', '#F9C74F', '#845EC2', '#6BCB77', '#EF476F', '#FF9671', '#3A86FF', '#8AC926'];
      cal = store.add('calendars', { name: base, color: palette[store.data.calendars.length % palette.length] });
    }
    const parsed = file.toLowerCase().endsWith('.csv')
      ? importCSV(text, cal.id) : importICS(text, cal.id);
    for (const ev of parsed.events) store.data.events.push(ev);
    store.save();
    return { canceled: false, file: base, calendar: cal, count: parsed.count, skipped: parsed.skipped.slice(0, 10) };
  });

  ipcMain.handle('import-url', async (e, { url }) => {
    try {
      const httpUrl = url.replace(/^webcal:/i, 'https:');
      const resp = await fetchUrl(httpUrl);
      if (resp.status !== 200) return { error: `HTTP ${resp.status}` };
      if (!/BEGIN:VCALENDAR/i.test(resp.body)) return { error: 'Not a valid .ics file' };
      const name = new URL(url).pathname.split('/').pop().replace(/\.ics$/i, '') || 'Imported';
      const palette = ['#FF6B6B', '#4D96FF', '#2EC4B6', '#F9C74F', '#845EC2', '#6BCB77', '#EF476F', '#FF9671', '#3A86FF', '#8AC926'];
      let cal = store.data.calendars.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (!cal) cal = store.add('calendars', { name, color: palette[store.data.calendars.length % palette.length] });
      const parsed = importICS(resp.body, cal.id);
      for (const ev of parsed.events) store.data.events.push(ev);
      store.save();
      return { canceled: false, calendar: cal, count: parsed.count, skipped: parsed.skipped.slice(0, 10) };
    } catch (err) {
      return { error: err.message };
    }
  });

  // export
  ipcMain.handle('export-file', async (e, { calendarIds }) => {
    const res = await dialog.showSaveDialog(win, {
      title: 'Export calendar',
      defaultPath: 'lumen-calendar.ics',
      filters: [{ name: 'iCalendar', extensions: ['ics'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const events = calendarIds
      ? store.data.events.filter(ev => calendarIds.includes(ev.calendarId))
      : store.data.events;
    const ics = exportICS(events);
    fs.writeFileSync(res.filePath, ics, 'utf8');
    return { canceled: false, file: res.filePath, count: events.length };
  });

  ipcMain.handle('search-events', (e, query) => store.searchEvents(query));

  ipcMain.handle('undo', () => {
    const prev = store.undo();
    return !!prev;
  });

  ipcMain.handle('open-external', (e, url) => shell.openExternal(url));
}

/* ---------------- lifecycle ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    app.setAppUserModelId('com.lumen.calendar');
    store = new Store(path.join(app.getPath('userData'), 'lumen-data.json'));
    registerIPC();
    createWindow();
    createTray();
    checkReminders();
    setInterval(checkReminders, 30000);

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('before-quit', () => { quitting = true; if (store) store.save(true); });
  app.on('window-all-closed', () => { /* keep running in tray */ });
}
