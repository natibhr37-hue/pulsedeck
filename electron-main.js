'use strict';
// PulseDeck — תהליך ראשי של Electron: פותח את התוכנה בחלון משלה כמו כל אפליקציית שולחן עבודה
const { app, BrowserWindow, session, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// קריאת קבצי אודיו לפי נתיב — לשחזור הספרייה מההפעלה הקודמת
ipcMain.handle('pulse-read-file', async (e, filePath) => {
  const buf = await fs.promises.readFile(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});
ipcMain.handle('pulse-file-exists', async (e, filePath) => {
  try { await fs.promises.access(filePath); return true; } catch (err) { return false; }
});

/* ==================== עדכונים אוטומטיים ==================== */
// בכל פתיחת התוכנה: בדיקה מול GitHub אם יצאה גרסה חדשה, הורדה ברקע,
// והתקנה בסגירה — כך שכל מי שהתקין מקבל את העדכונים לבד.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function setupUpdates(win) {
  if (!app.isPackaged) return; // בפיתוח אין מה לבדוק

  autoUpdater.on('update-available', info => {
    win.webContents.send('update-status', { state: 'available', version: info.version });
  });
  autoUpdater.on('download-progress', p => {
    win.webContents.send('update-status', { state: 'downloading', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', info => {
    win.webContents.send('update-status', { state: 'ready', version: info.version });
    dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['התקן עכשיו והפעל מחדש', 'אחר כך'],
      defaultId: 0,
      cancelId: 1,
      title: 'עדכון זמין ל-PulseDeck',
      message: `גרסה ${info.version} הורדה ומוכנה להתקנה.`,
      detail: 'התוכנה תיסגר לרגע, תתעדכן, ותיפתח מחדש עם החדשות.'
    }).then(res => {
      if (res.response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.on('error', err => {
    // בלי לקטוע את המשתמש — עדכון שנכשל פשוט יקרה בפעם הבאה
    win.webContents.send('update-status', { state: 'error', message: String(err) });
  });

  // בדיקה ראשונה כמה שניות אחרי הפתיחה, ואז כל 6 שעות
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#05060c',
    autoHideMenuBar: true,       // בלי סרגל תפריטים — מסך נקי
    title: 'PulseDeck',          // אייקון החלון נלקח אוטומטית מה-exe (electron-builder הטמיע אותו)
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // אישור אוטומטי להרשאות MIDI / מיקרופון וכו' — קונטרולרים יעבדו בלי הודעות
  win.webContents.session.setPermissionRequestHandler((wc, permission, cb) => cb(true));

  win.maximize();        // פתיחה במסך מלא כמו תוכנה מקצועית
  win.loadFile('index.html');
  setupUpdates(win);
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // בלי תפריט עליון
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
