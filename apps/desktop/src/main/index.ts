import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';

/**
 * Electron main process bootstrap.
 * Service wiring + IPC router live in ./bootstrap (created during integration);
 * this file only owns window lifecycle.
 */

const isDev = !!process.env.ELECTRON_RENDERER_URL;

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d16',
    title: 'StuddyBuddy',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // External links open in the OS browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL as string);
  } else {
    await win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  }
  return win;
}

app.whenReady().then(async () => {
  // Deferred import keeps startup resilient: a service-wiring failure still
  // produces a window with a readable error instead of a silent crash.
  const { bootstrap } = await import('./bootstrap');
  await bootstrap();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
