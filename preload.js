'use strict';
// גשר מאובטח בין הממשק לתהליך הראשי — מאפשר לקרוא קבצי אודיו לפי נתיב
// כדי לשחזר את הספרייה מההפעלה הקודמת בלי לטעון מחדש ידנית.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pulseFS', {
  // הנתיב המלא בדיסק של קובץ (ב-Electron 32+ במקום File.path שהוסר)
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
  // מחזיר ArrayBuffer של קובץ לפי נתיב מלא בדיסק
  readFile: (filePath) => ipcRenderer.invoke('pulse-read-file', filePath),
  // בודק אם קובץ עדיין קיים (למקרה שהוזז/נמחק מאז)
  exists: (filePath) => ipcRenderer.invoke('pulse-file-exists', filePath),
  available: true
});
