# Sistema Tienda de Abarrotes

Sistema de escritorio para Windows (empaquetado en .exe) para gestionar una tienda de abarrotes:
POS, inventario, contabilidad y clientes. Funciona 100% local, accesible desde tablet via WiFi.

## Estructura del proyecto

```
grocerystore/
├── electron/          # Electron main process
│   ├── main.js        # Entry point, server startup, tray icon
│   └── preload.js     # Context bridge
├── server/            # Backend (Express + SQLite)
│   ├── index.js       # Express server
│   ├── db.js          # SQLite database (sql.js)
│   ├── seed.js        # Default data seed
│   ├── middleware/
│   │   └── auth.js    # JWT auth middleware
│   └── routes/
│       ├── auth.js       # Authentication
│       ├── products.js   # Products + inventory
│       ├── sales.js      # POS/Sales
│       ├── customers.js  # Customers (fiado)
│       ├── accounting.js # Cash register, expenses, reports
│       └── backup.js     # Database backup
├── frontend/          # React (Vite)
│   ├── src/
│   │   ├── App.jsx       # Main app with routing
│   │   ├── api.js        # API client
│   │   ├── components/
│   │   │   ├── Login.jsx
│   │   │   ├── POS.jsx           # Point of Sale
│   │   │   ├── Inventory.jsx     # Product management
│   │   │   ├── Accounting.jsx    # Dashboard, cash, reports
│   │   │   ├── AdminLayout.jsx
│   │   │   └── ProtectedRoute.jsx
│   │   └── styles/
│   │       └── app.css   # Flat design, touch-friendly
│   └── dist/            # Built frontend
├── dist/               # Electron build output
│   ├── win-unpacked/   # Portable app (ready to run)
│   └── Instalar.bat    # Installation script
├── docs/               # Documentation
│   ├── Manual de Usuario.md
│   └── Instrucciones de Instalacion.md
└── package.json
```

## Tecnologias

- **Backend:** Node.js + Express + SQLite (sql.js)
- **Frontend:** React 18 + Vite (sin librerias pesadas)
- **Desktop:** Electron 22 (compatible Windows 7+)
- **Autenticacion:** JWT + bcryptjs

## Requisitos

- Node.js 18+ (para desarrollo)
- Windows 7, 8, 8.1, 10 u 11 (para ejecucion)
- 1 GB RAM minimo

## Comandos de desarrollo

```bash
# Iniciar backend solo
npm run dev

# Iniciar frontend en modo desarrollo
npm run dev:frontend

# Construir frontend
npm run build:frontend

# Construir app portable (unpacked)
npm run build:win

# Iniciar app Electron completa
npm start
```

## Caracteristicas

- **POS:** Captura por codigo de barras, busqueda manual, carrito con descuentos, metodos de pago mixtos, ticket imprimible
- **Inventario:** Alta de productos, codigo de barras automatico, categorias, kardex, alertas de stock bajo
- **Contabilidad:** Corte de caja diario, reportes de ingresos/costos/utilidad, gastos, exportacion a CSV
- **Clientes:** Gestion de clientes, ventas a credito (fiado), seguimiento de saldos
- **Respaldos:** Manuales y automaticos diarios
- **Multi-dispositivo:** Acceso desde tablet via navegador web en la red local

## Usuarios por defecto

| Usuario | Contrasena | Rol |
|---------|-----------|-----|
| admin   | admin123  | Dueno |
| cajero  | cajero123 | Cajero |

Al iniciar sesion por primera vez con estas contrasenas de fabrica, el sistema
obliga a cambiarlas antes de entrar.

## Instalacion en PC destino

1. Ejecutar `dist/Instalar.bat` como administrador
2. El instalador copia los archivos a `C:\Program Files\TiendaAbarrotes`
3. Crea accesos directos en escritorio y menu inicio
4. Iniciar desde el acceso directo "Tienda Abarrotes"
