const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDatabase, getDB } = require('./db');
const { seedDatabase } = require('./seed');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const salesRoutes = require('./routes/sales');
const customerRoutes = require('./routes/customers');
const accountingRoutes = require('./routes/accounting');
const { router: backupRoutes, getBackupDir } = require('./routes/backup');
const hardwareRoutes = require('./routes/hardware');
const eventsRoutes = require('./routes/events');
const suppliersRoutes = require('./routes/suppliers');

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

async function start() {
  await initDatabase();
  seedDatabase();

  const { syncPreloadedEvents } = require('./services/events');
  const currentYear = new Date().getFullYear();
  syncPreloadedEvents(currentYear);
  syncPreloadedEvents(currentYear + 1);

  function autoBackup() {
    try {
      const backupDir = getBackupDir();
      const today = new Date().toISOString().split('T')[0];
      const backupFile = path.join(backupDir, `tienda_auto_${today}.db`);
      if (!fs.existsSync(backupFile)) {
        const db = getDB();
        db.backup(backupFile);
        console.log(`Auto-backup created: ${backupFile}`);
      }
    } catch (e) {
      console.error('Auto-backup error:', e.message);
    }
  }
  autoBackup();
  setInterval(autoBackup, 24 * 60 * 60 * 1000);

  app.use('/api/auth', authRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/accounting', accountingRoutes);
  app.use('/api/backup', backupRoutes);
  app.use('/api/hardware', hardwareRoutes);
  app.use('/api/events', eventsRoutes);

  // Debe registrarse ANTES de montar suppliersRoutes en '/api': ese router
  // aplica router.use(authMiddleware) sin filtro de ruta, así que intercepta
  // (con 401) cualquier request /api/* que llegue después de él en la pila de
  // middleware, incluyendo este endpoint público. Antes esto dejaba
  // /api/network-info inalcanzable — por eso electron/main.js inyectaba la IP
  // local directamente en el DOM como workaround en vez de usar la API.
  app.get('/api/network-info', (req, res) => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let localIP = '127.0.0.1';
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIP = iface.address;
          break;
        }
      }
    }
    res.json({ ip: localIP, port: PORT });
  });

  app.use('/api', suppliersRoutes);

  const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
  if (fs.existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(frontendPath, 'index.html'));
      }
    });
  }

  app.use((err, req, res, next) => {
    console.error('Server error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error interno del servidor: ' + (err.message || 'desconocido') });
    }
  });

  tryPort(PORT);

  function tryPort(port) {
    const server = app.listen(port, '0.0.0.0', () => {
      process.env.ACTUAL_PORT = port;
      const os = require('os');
      const interfaces = os.networkInterfaces();
      let localIP = '127.0.0.1';
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            localIP = iface.address;
            break;
          }
        }
      }
      console.log(`Servidor corriendo en:`);
      console.log(`  Local: http://localhost:${port}`);
      console.log(`  Red:   http://${localIP}:${port}`);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < PORT + 10) {
        console.log(`Puerto ${port} ocupado, intentando ${port + 1}...`);
        tryPort(port + 1);
      } else {
        console.error('Error al iniciar servidor:', err);
      }
    });
  }
}

start().catch(err => {
  console.error('Error starting server:', err);
  if (!process.env.ELECTRON_RUN) process.exit(1);
});
