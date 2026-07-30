'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getBootstrap: () => ipcRenderer.invoke('get-bootstrap'),
  getRange: (start, end) => ipcRenderer.invoke('get-range', { start, end }),

  addEvent: ev => ipcRenderer.invoke('add-event', ev),
  updateEvent: (id, patch) => ipcRenderer.invoke('update-event', { id, patch }),
  deleteEvent: id => ipcRenderer.invoke('delete-event', id),

  addTask: t => ipcRenderer.invoke('add-task', t),
  updateTask: (id, patch) => ipcRenderer.invoke('update-task', { id, patch }),
  deleteTask: id => ipcRenderer.invoke('delete-task', id),

  addNote: n => ipcRenderer.invoke('add-note', n),
  updateNote: (id, patch) => ipcRenderer.invoke('update-note', { id, patch }),
  deleteNote: id => ipcRenderer.invoke('delete-note', id),

  addCalendar: c => ipcRenderer.invoke('add-calendar', c),
  updateCalendar: (id, patch) => ipcRenderer.invoke('update-calendar', { id, patch }),
  deleteCalendar: id => ipcRenderer.invoke('delete-calendar', id),
  addCategory: c => ipcRenderer.invoke('add-category', c),

  updateSettings: patch => ipcRenderer.invoke('update-settings', patch),

  searchEvents: query => ipcRenderer.invoke('search-events', query),
  undo: () => ipcRenderer.invoke('undo'),
  importFile: () => ipcRenderer.invoke('import-file'),
  importUrl: url => ipcRenderer.invoke('import-url', { url }),
  exportFile: calendarIds => ipcRenderer.invoke('export-file', { calendarIds }),

  winMinimize: () => ipcRenderer.send('win-minimize'),
  winMaximize: () => ipcRenderer.send('win-maximize'),
  winClose: () => ipcRenderer.send('win-close'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),

  onQuickAdd: cb => ipcRenderer.on('quick-add', (e, type) => cb(type)),
  onReminder: cb => ipcRenderer.on('reminder-fired', (e, info) => cb(info))
});
