const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let tray;
let serverReady = false;

const isDev = !app.isPackaged;
const PORT = 3000;

// En dev, resources/ es una carpeta real junto a electron/. En un build
// empaquetado con asar, __dirname vive DENTRO del .asar, así que
// '../resources/icon.ico' apuntaría a una ruta que no existe ahí — hay que
// usar process.resourcesPath (fuera del asar) y que electron-builder copie
// resources/icon.ico ahí vía "extraResources" (ver package.json).
const ICON_PATH = isDev
  ? path.join(__dirname, '..', 'resources', 'icon.ico')
  : path.join(process.resourcesPath, 'icon.ico');

function startServer() {
  return new Promise((resolve) => {
    process.env.PORT = PORT.toString();
    process.env.ELECTRON_RUN = 'true';
    require(path.join(__dirname, '..', 'server', 'index.js'));
    const check = setInterval(() => {
      if (process.env.ACTUAL_PORT) {
        clearInterval(check);
        serverReady = true;
        resolve();
      }
    }, 200);
    setTimeout(() => { clearInterval(check); serverReady = true; resolve(); }, 5000);
  });
}

function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false,
    title: 'Sistema Tienda de Abarrotes'
  });

  const localIP = getLocalIP();
  const port = process.env.ACTUAL_PORT || PORT;
  const url = `http://localhost:${port}`;

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        document.title = 'Sistema Tienda de Abarrotes';
        var ipDiv = document.createElement('div');
        ipDiv.id = 'local-ip-info';
        ipDiv.style.display = 'none';
        ipDiv.textContent = '${localIP}:${port}';
        document.body.appendChild(ipDiv);
      `);
    }
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Antes se creaba un buffer RGBA vacío (todo en ceros) como ícono de la
  // bandeja del sistema: técnicamente válido pero completamente invisible.
  const trayIcon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip('Sistema Tienda de Abarrotes');

  const localIP = getLocalIP();

  const trayPort = process.env.ACTUAL_PORT || PORT;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Abierto en: http://${localIP}:${trayPort}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Abr ventana',
      click: () => {
        if (mainWindow) mainWindow.show();
        else createWindow();
      }
    },
    {
      label: 'Cerrar servidor',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) mainWindow.show();
  });
}

ipcMain.on('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (e) {
    console.error('Error starting server:', e);
  }

  createWindow();
  createTray();

  const localIP = getLocalIP();
  const outPort = process.env.ACTUAL_PORT || PORT;
  console.log(`\n========================================`);
  console.log(` Tienda de Abarrotes - Sistema Local`);
  console.log(`========================================`);
  console.log(` Conctate desde la tablet a:`);
  console.log(` http://${localIP}:${outPort}`);
  console.log(`========================================\n`);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit - keep running in tray
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});
