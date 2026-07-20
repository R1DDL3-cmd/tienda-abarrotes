# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Sistema Tienda de Abarrotes — a Windows desktop app (Electron) for running a small grocery store: POS, inventory, accounting, customers/credit ("fiado"), suppliers/purchases, and sales forecasting. Runs 100% locally (no cloud backend); a tablet on the same WiFi network can reach it as a browser client. Codebase and commit messages are in Spanish — match that when writing user-facing strings or comments.

## Commands

```bash
# Backend only (Express on :3000)
npm run dev:server

# Frontend only, hot-reload (Vite on :5173, proxies /api to :3000)
npm run dev:frontend

# Both at once (also: start-dev.bat opens them in separate windows on Windows)
npm run dev

# Build frontend into frontend/dist (server serves this as static files when present)
npm run build:frontend

# Full Electron build (installer via electron-builder, output in dist/)
npm run build

# Run the packaged Electron app
npm start
```

There is no test suite, linter, or type checker configured in this repo (no `test`/`lint` script in either `package.json`). Don't invent commands for these — verify changes by running the dev server and exercising the feature.

Frontend deps live in `frontend/node_modules` (separate from root `node_modules`); run `npm install` in both places after a fresh clone if needed.

## Architecture

**Three layers, one process in production:** `electron/main.js` boots a hidden Electron window, `require()`s `server/index.js` in-process (not as a subprocess) with `ELECTRON_RUN=true`, waits for it to report `ACTUAL_PORT`, then points the BrowserWindow at `http://localhost:<port>`. The server also serves `frontend/dist` as static files and falls back to `index.html` for any non-`/api` route (SPA routing via `HashRouter` on the frontend). In dev, the Vite dev server and `node server/index.js` run as separate processes instead (see `start-dev.bat`).

**Database (`server/db.js`) is sql.js, not `better-sqlite3`.** sql.js is a pure-WASM SQLite build with no native bindings — chosen for portability across Windows versions without rebuild issues. It's an in-memory database that's periodically flushed to disk:
- Writes debounce-save to disk 300ms after the last write (`debouncedSave`), except inside a `transaction()`, where saving is deferred until commit (`flushSave`) so a crash mid-transaction can't leave a half-written file.
- `DatabaseWrapper`/`Statement` in `db.js` shim a `better-sqlite3`-like API (`prepare().get()/.all()/.run()`, `.transaction()`) on top of sql.js so route code reads the same as it would with a native driver.
- DB file location: `%APPDATA%/TiendaAbarrotes/tienda.db` when `ELECTRON_RUN=true`, otherwise `data/tienda.db` in the repo (dev mode).
- **Schema migrations** are a manually numbered array (`SCHEMA_MIGRATIONS` in `db.js`), gated by `PRAGMA user_version` so each block runs exactly once ever. To change the schema: add a new entry to the end of `SCHEMA_MIGRATIONS`, never edit past entries or the `CREATE TABLE IF NOT EXISTS` block for existing installs (only new installs get the base schema fresh — everyone else migrates forward). SQLite can't drop/alter columns with constraints in place the way you'd expect, so migrations that change a CHECK constraint use `runRenameSequence` (rename table → recreate with new schema → copy rows → drop old) wrapped in an explicit transaction; plain `ADD COLUMN` migrations are intentionally left outside any transaction and rely on try/catch to no-op if already applied — read the comment above `runRenameSequence` in `db.js` before changing this pattern, it explains a real corruption incident.

**Auth:** JWT-based (`server/middleware/auth.js`), token in `Authorization: Bearer`. The JWT secret is generated once per install and persisted to `data/.secret` (`0600` perms) — never hardcode a secret, since the packaged `.asar` is trivially extractable. Roles: `admin`, `cashier`, `inventory` (no longer DB-constrained via CHECK, see migration v3). Route-level role gates are separate middlewares: `adminMiddleware`, `inventoryAdminMiddleware`, `purchasesMiddleware` (admin/cashier/inventory — cashiers are explicitly allowed to register supplier purchases). Frontend mirrors this with `allowedRoles` on `<ProtectedRoute>` in `App.jsx`.

**Route mounting order matters in `server/index.js`.** `suppliersRoutes` applies `router.use(authMiddleware)` unfiltered, so anything mounted at `/api/*` *after* it in the middleware stack gets intercepted and 401'd — that's why `/api/network-info` (a deliberately public endpoint) is registered before `app.use('/api', suppliersRoutes)`. If you add a new public `/api` route, it must go before that line too.

**Domain modules** (`server/routes/*.js` + matching `server/services/*.js` for heavier logic):
- `products` — catalog, categories, batches, multiple barcodes per product (`product_barcodes` table — `products.barcode` is still the primary code), kardex (stock movement history), individual/fractional sales (e.g. selling loose cigarettes from a pack: `sellable_individually`/`units_per_package`/`individual_price` on `products`; stock is always tracked in package units, `sale_items.stock_delta` records exactly how much stock a line actually consumed so cancellations reverse the right amount).
- `sales` — POS transactions, ticket printing, offline `client_id`/`client_created_at` dedup so a tablet retrying a sync after a dropped connection can't double-create a sale.
- `accounting` — cash register open/close, cash sessions (`cash_sessions`) and itemized cash movements (`cash_movements`), expenses, waste/returns-to-supplier, dashboard/reports, and demand predictions (delegates to `services/predictions.js`).
- `customers` — customer records and store credit (`fiado`): balances, credit limits, payments.
- `suppliers` / `purchases` — suppliers, purchase orders, receiving (`purchase_items.received_quantity`/`received_unit_price` can differ from what was ordered). `products.supplier_id` is the real FK to `suppliers`; `products.supplier` is a legacy free-text fallback kept for products that couldn't be auto-linked during migration v9.
- `events` (+ `services/events.js`) and `services/predictions.js` — sales forecasting engine: classifies each SKU's demand pattern (REGULAR/INTERMITTENT/ERRATIC/SEASONAL/NEW/INACTIVE) from sales history and picks a forecasting model (SMA/SES/etc.) accordingly, and factors in calendar events (holidays, local events, promotions) and cached weather data as demand modifiers. Pure JS, no ML dependencies — read the header comment in `predictions.js` for the reasoning (low-end Windows hardware, no external ML deps).
- `hardware` (+ `services/hardware.js`) — cash drawer control.
- `settings` — key/value store config (`settings` table).
- `backup` — manual/automatic `.db` backups and restore; auto-backup runs once at startup and then every 24h (`server/index.js`).

**Frontend** is a single Vite/React app, `HashRouter`-based (required because the server does simple SPA fallback, and the app is also opened via `file://`-like contexts on the tablet), routed in `frontend/src/App.jsx` by role. `frontend/src/api.js` is a thin fetch wrapper — one namespaced object per domain (`products`, `sales`, `accounting`, etc.), auth token from `localStorage`, auto-redirects to `#/login` on 401. It also implements a manual offline cache (`localStorage`, not a Service Worker — LAN access over plain HTTP to a tablet isn't a browser "secure context", so Service Workers aren't available there) for the product/customer catalogs: successful fetches snapshot the data, and failed fetches fall back to the last snapshot with client-side filtering. This only covers "WiFi drops mid-shift", not "open the app from scratch with no connection".

Global keyboard navigation (arrow keys move focus, Enter activates, configurable shortcuts) is wired once in `App.jsx` for the whole app — POS-specific shortcuts (search, checkout, customer/fiado, history) are handled separately inside `POS.jsx` since they only make sense there.

## Conventions worth knowing

- Comments in this codebase are used specifically to explain *why*, often documenting a past bug/incident and the reasoning for a non-obvious fix (see examples in `db.js`, `index.js`, `main.js`, `api.js`, `App.jsx`). Follow that pattern rather than narrating what the code does.
- Money/quantities are `REAL` in SQLite; stock is tracked in package units even for products sold individually — never assume 1 sale_item unit == 1 stock unit.
- `unit_type` on products is `unit` | `kg` | `l`; treat this as the source of truth for whether a product's quantity is fractional.
