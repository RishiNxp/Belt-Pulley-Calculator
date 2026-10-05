const { app, BrowserWindow, dialog, Menu, net, protocol } = require('electron');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_URL = 'belt-pulley://app/index.html';
const buildDirectory = path.resolve(__dirname, '..', 'dist');
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
].join('; ');

app.setName('Belt Pulley Calculator');
const dataDirectory = path.join(app.getPath('appData'), 'BeltPulleyCalculator');
mkdirSync(dataDirectory, { recursive: true });
app.setPath('userData', dataDirectory);
app.setPath('sessionData', dataDirectory);
if (process.platform === 'win32') app.setAppUserModelId('BeltPulleyCalculator');

// A standard scheme gives autosave a stable origin even if the repo is moved.
protocol.registerSchemesAsPrivileged([{
  scheme: 'belt-pulley',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

async function serveLocalAsset(request) {
  const url = new URL(request.url);
  if (url.host !== 'app' || url.username || url.password
    || !['GET', 'HEAD'].includes(request.method)) {
    return new Response('Not found', { status: 404 });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Invalid asset path', { status: 400 });
  }
  const assetPath = path.resolve(buildDirectory, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relativePath = path.relative(buildDirectory, assetPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const response = await net.fetch(pathToFileURL(assetPath).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', contentSecurityPolicy);
    headers.set('Cache-Control', 'no-cache');
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return new Response('Local asset not found', { status: 404 });
  }
}

let calculatorWindow = null;

async function createWindow() {
  if (!existsSync(path.join(buildDirectory, 'index.html'))) {
    throw new Error('The local application build is missing. Run npm start from the repository folder.');
  }

  const window = new BrowserWindow({
    title: 'Belt Pulley Calculator',
    width: 1360,
    height: 900,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#080808',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  calculatorWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { calculatorWindow = null; });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== APP_URL) event.preventDefault();
  });
  await window.loadURL(APP_URL);
}

function showStartupError(error) {
  console.error('Calculator startup failed:', error);
  dialog.showErrorBox('Could not open Belt Pulley Calculator', error.message || String(error));
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!calculatorWindow) {
      if (app.isReady()) createWindow().catch(showStartupError);
      return;
    }
    if (calculatorWindow.isMinimized()) calculatorWindow.restore();
    calculatorWindow.show();
    calculatorWindow.focus();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(showStartupError);
  });

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]));
    } else {
      Menu.setApplicationMenu(null);
    }
    protocol.handle('belt-pulley', serveLocalAsset);
    await createWindow();
  }).catch(showStartupError);
}
