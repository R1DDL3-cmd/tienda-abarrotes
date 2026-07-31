# Fase 2 — El teclado como canal principal en todo el sistema

Especificación aprobada por el dueño el 31 de julio de 2026, incluidos los dos
puntos que se marcaron como avisos: **F9 pasa a "cuentas"** (deja de ser alias de
Supr) y **F5 = "en lote"** con el Descuento del POS como única excepción declarada.

Base: capa de teclado de la v1.2.0 (`frontend/src/keyboard/`), que NO se reescribe.

## Estado de la implementación

| Etapa | Estado | Dónde |
|---|---|---|
| Registro con clases de estado, semánticas y excepción declarada | **Hecho** | `frontend/src/keyboard/registry.js` |
| Prueba de consistencia del mapa (criterio 5) | **Hecho** — 17 pruebas | `frontend/tests/consistencia.test.js` |
| Parser reutilizable + gramática de Compras | **Hecho** | `frontend/src/keyboard/parser.js` |
| Línea de comando reutilizable | **Hecho** | `frontend/src/components/CommandLine.jsx` |
| Lógica pura del pedido y de la recepción | **Hecho** | `frontend/src/purchaseOrder.js` |
| Compras completo por teclado | **Hecho** | `frontend/src/components/Purchases.jsx` |
| Criterios medibles 1, 2, 3 y 10 | **Hecho** — 21 pruebas | `frontend/tests/compras.test.js` |
| Inventario, Clientes, Contabilidad, Configuración y Proyector | **Hecho** | sus componentes |
| Teclas globales en cualquier pantalla y con recuadros abiertos | **Hecho** | `frontend/src/keyboard/GlobalKeys.jsx` |
| Configuración → Atajos migrada al registro (avisos + JSON) | **Hecho** — `shortcuts.js` eliminado | `frontend/src/components/Settings.jsx` |
| Menú "Más ▾" del POS generado del registro | **Hecho** | `frontend/src/components/POS.jsx` |
| Hoja de referencia imprimible y manual de usuario | Pendiente | — |
| Sonidos de retroalimentación | Pendiente | — |

### Índice activo sin desfase (hallazgo de la implementación)

Con el teclado, varias pulsaciones pueden llegar dentro del mismo fotograma
(autorrepetición de ↓, o alguien rápido). React agrupa los cambios de estado y
no vuelve a renderizar entre una tecla y la siguiente, así que un manejador que
lea el índice del render anterior actúa sobre la fila equivocada: "↓ ↓ Espacio"
marcaba el producto de antes, y "→ →" avanzaba una sola pestaña.

Se corrige con `frontend/src/keyboard/useActiveIndex.js` (el índice vive también
en un ref, que sí cambia al instante) y con actualizaciones funcionales en las
pestañas. Vale para todas las listas navegables del sistema.

Decisiones ya tomadas por el dueño:
- Compras: el pedido pasa a ser espacio de trabajo a pantalla completa; el resto del layout no se rediseña (la tablet táctil no pierde nada).
- Cajero: puede pedir y recibir; **no** puede abrir Por Pagar ni abonar a proveedores.
- Escaneo de producto ajeno al proveedor: se agrega igual + aviso + tecla para vincular.

---

## 0. La regla que hace posible la consistencia: clases de estado

"Misma tecla = mismo significado" no puede compararse contra todo a la vez, porque el POS
ya tiene (y debe conservar) F1 = Ayuda en captura y F1 = Efectivo en cobro. Eso no es una
incoherencia: son **dos contextos distintos**. Se formaliza así:

| Clase | Qué es | Estados |
|---|---|---|
| `captura` | Hay una línea de comando o un campo de captura activo | POS CAPTURA · COMPRAS PROVEEDOR · COMPRAS PEDIDO · INVENTARIO · CLIENTES · CONTABILIDAD · CONFIGURACIÓN · PROYECTOR |
| `pago` | Se está definiendo cómo se mueve el dinero | POS COBRO · COMPRAS ABONO · COMPRAS CONFIRMAR |
| `rejilla` | Tabla editable celda por celda | COMPRAS RECEPCIÓN · INVENTARIO EDICIÓN MASIVA |
| `lista` | Selección entre renglones, sin edición | POS BÚSQUEDA · COMPRAS PENDIENTES · COMPRAS POR PAGAR · listas de todas las secciones |
| `confirmacion` | Pantalla de resultado | POS CAMBIO |
| `modal` | Cualquier otro recuadro | todos |

**Invariante que verifica la prueba automática (criterio 5):**
dentro de una misma clase, una tecla no puede tener dos significados distintos en dos
secciones distintas, salvo que la acción declare `keyException` con su motivo por escrito.

Cada acción del registro gana dos campos nuevos: `semantic` (el significado) y `stateClass`
(vía el estado). La prueba recorre el registro, agrupa por `(clase, tecla)` y exige un solo
`semantic` por grupo.

---

## 1. Mapa de teclas final por sección

### 1.1 Vocabulario universal (clase `captura`)

| Tecla | `semantic` | Significado en TODA la app | Origen |
|---|---|---|---|
| F1 | `ayuda` | Ayuda contextual de la sección | heredado POS · estándar CUA/Windows |
| F2 | `buscar` | Buscar en la sección actual | heredado POS |
| F3 | `entidad` | Entidad relacionada (cliente en POS/Clientes, proveedor en Compras/Inventario) | heredado POS |
| F4 (alias F12) | `principal` | Acción principal de la sección | heredado POS |
| F5 | `lote` | Hacer de golpe lo que se haría uno por uno | **nuevo** (excepción POS abajo) |
| F6 | `suspender` | Suspender el trabajo en curso | heredado POS |
| F7 | `retomar` | Retomar trabajo suspendido | heredado POS |
| F8 | `historial` | Historial de la entidad o sección activa | heredado POS |
| F9 | `cuentas` | Saldos: por pagar / por cobrar / crédito | **nuevo** (ver aviso 1) |
| F10 (alias Ctrl+K) | `paleta` | Paleta de comandos = quick switcher | heredado POS |
| Ins | `alta` | Alta rápida de un registro nuevo en la sección | **nuevo** |
| Supr | `quitar` | Quitar o anular el renglón activo | heredado POS |
| Espacio | `marcar` | Marcar/desmarcar el renglón activo (solo con la línea vacía) | **nuevo** |
| Ctrl+Z | `deshacer` | Deshacer | heredado POS |
| Ctrl+P | `imprimir` | Imprimir lo que está en pantalla | **nuevo**, solo escritorio |
| ↑ ↓ | `mover` | Moverse en la lista activa | heredado POS |
| ← → | `mover-h` | Cambiar de pestaña (o de columna en rejilla) | **nuevo** |
| Re Pág / Av Pág | `periodo` | Periodo anterior / siguiente | **nuevo** |
| Enter / Esc | — | Avanza / retrocede | heredado, no configurable |
| Ctrl+1..5 (alias Alt+1..5) | `navegar` | Ir a sección, desde cualquier lugar | heredado + alias nuevo |

### 1.2 Clase `pago` (POS COBRO · COMPRAS ABONO · COMPRAS CONFIRMAR)

| Tecla | `semantic` | Significado |
|---|---|---|
| F1 | `pago-efectivo` | Efectivo |
| F2 | `pago-tarjeta` | Tarjeta |
| F3 | `pago-transferencia` | Transferencia |
| F4 | `pago-mixto` | Agregar otra forma de pago |
| F5..F9 | `denominacion` | +$20 · +$50 · +$100 · +$200 · +$500 (solo donde se recibe efectivo) |
| F9 | `cuentas` | En CONFIRMAR: marcar la compra **a crédito** (se va a Por Pagar) |
| Enter | — | Confirma el movimiento (ya es así en el POS hoy) |

`F4 = principal` de §6 del encargo aplica a las clases `captura` y `rejilla`. En la clase
`pago` el que confirma es **Enter**, porque así quedó el POS en v1.2.0 y es la memoria
muscular real del cajero. Queda anotado como contrato de la clase, no como excepción.

### 1.3 Compras (prioridad 1)

| Estado | Tecla | Acción | Rol |
|---|---|---|---|
| **PROVEEDOR** | F2 | Buscar proveedor | todos |
| | ↑ ↓ | Moverse en la lista de proveedores | todos |
| | Enter · F4 | Nuevo pedido del proveedor activo | todos |
| | F3 | Selector de proveedor (superpuesto) | todos |
| | Ins | Alta de proveedor | todos |
| | F7 | Retomar pedido suspendido | todos |
| | F8 | Pedidos y compras del proveedor activo | todos |
| | F9 | Cuentas por pagar | **solo admin** |
| | → | Pasar a la lista de pedidos del proveedor | todos |
| | Esc | Limpia la búsqueda (nunca abandona la sección) | todos |
| **PEDIDO** | *línea de comando* | Ver §3 | todos |
| | F2 | Buscar producto **de ese proveedor** | todos |
| | F3 | Cambiar de proveedor sin salir del pedido | todos |
| | F4 · F12 | Guardar pedido → CONFIRMAR | todos |
| | F5 | Sugerir reposición (llena el pedido de golpe) | todos |
| | F6 / F7 | Suspender / retomar el pedido | todos |
| | F8 | Historial del proveedor | todos |
| | F9 | Cuentas por pagar de ese proveedor | **solo admin** |
| | Ins | Alta rápida de producto ligado al proveedor | admin, inventory |
| | ↑ ↓ | Moverse entre renglones | todos |
| | + / − | Cantidad del renglón activo ±1 | todos |
| | Supr | Quitar el renglón activo | todos |
| | Ctrl+Z | Deshacer | todos |
| | Ctrl+P | Imprimir el pedido | todos |
| | Esc | Volver a PROVEEDOR **conservando** el pedido | todos |
| **CONFIRMAR** | F1/F2/F3 | Forma de pago del contado | todos |
| | F9 | A crédito (se va a Por Pagar) | todos |
| | ← → | Pedido pendiente ⇄ Compra directa (inventaría ya) | todos |
| | Enter · F4 | Confirmar | todos |
| | Esc | Volver a PEDIDO | todos |
| **PENDIENTES** | ↑ ↓ | Moverse entre pedidos | todos |
| | Enter · F4 | Recibir el pedido activo | todos |
| | Ctrl+P | Imprimir | todos |
| | Esc | Volver a PROVEEDOR | todos |
| **RECEPCIÓN** | ↑ ↓ | Renglón anterior / siguiente | todos |
| | Tab · → / ← | Cantidad recibida ⇄ Precio recibido | todos |
| | *escribir* | Sobrescribe la celda activa | todos |
| | Enter | Confirma la celda y baja al renglón siguiente | todos |
| | F5 | **Todo llegó igual a lo pedido** | todos |
| | Supr | Este no llegó (cantidad 0, sin borrar el renglón) | todos |
| | Ctrl+Z | Deshacer el último ajuste | todos |
| | F4 | Confirmar la recepción completa | todos |
| | Esc | Cancelar (avisa si hay ajustes sin guardar) | todos |
| **POR PAGAR** | ↑ ↓ | Moverse entre compras con saldo | **solo admin** |
| | Enter · F4 | Abonar a la compra seleccionada | **solo admin** |
| | Esc | Cerrar | **solo admin** |
| **ABONO** | *monto* | Llega preseleccionado con el saldo total | **solo admin** |
| | Enter | Registrar (pago completo si no se tocó el monto) | **solo admin** |
| | F1/F2/F3 | Efectivo / Tarjeta / Transferencia | **solo admin** |
| | Esc | Cancelar | **solo admin** |

Abono en 4 pulsaciones desde el estado base de Compras (criterio 3):
`F9` → `↓`(hasta la compra) → `Enter` → `Enter`. Con la compra ya visible: 3.

### 1.4 Resto de secciones

| Sección | Tecla | Acción |
|---|---|---|
| **Inventario** | F2 · ↑↓ · Enter | Buscar · moverse · abrir el producto activo |
| | F4 | Editar el producto activo (en el formulario: guardar) |
| | Ins | Alta rápida |
| | Espacio | Marcar/desmarcar para edición masiva |
| | F5 | Abrir edición masiva de los marcados |
| | F3 | Filtrar por proveedor |
| | F8 | Kardex (historial del producto) |
| | Ctrl+P | Imprimir etiquetas de los marcados |
| | Supr | Dar de baja el producto activo |
| **Clientes** | F2 · ↑↓ | Buscar · moverse |
| | Enter · F4 | Abonar al cliente activo |
| | F8 | Historial del cliente |
| | F9 | Cuentas por cobrar (saldos) |
| | Ins | Alta rápida |
| **Contabilidad** | ← → | Cambiar de pestaña |
| | Re Pág / Av Pág | Periodo anterior / siguiente |
| | F2 | Buscar en la tabla activa |
| | F4 | Exportar (acción principal de la sección) |
| **Configuración** | ← → | Cambiar de pestaña |
| | F4 | Guardar |
| | F2 | Buscar ajuste |
| | *pantalla Atajos* | Migrada al registro: avisos de teclas reservadas, importar/exportar JSON |
| **Proyector** | F2 · ↑↓ | Buscar producto · moverse por resultados |
| | ← → | Columna de orden (repetir alterna ascendente/descendente) |
| | Enter | Abrir el detalle del producto activo |

---

## 2. Avisos: dónde tu encargo choca con algo (y qué propongo)

**Aviso 1 — F9 deja de quitar líneas en el POS.**
Hoy `pos_remove_line` tiene `keys: ['Delete','F9']`. F9 no aparece en tu lista de memoria
muscular ganada (ahí solo está Supr), y es la **única** tecla de función libre para el
concepto "cuentas y saldos", que Compras y Clientes necesitan. Propuesta: Supr se queda
como está y F9 pasa a `cuentas`. Si prefieres conservar F9 = quitar línea, la alternativa
es dejar Por Pagar sin tecla propia y alcanzarla solo por `/pagar` y la paleta.

**Aviso 2 — F5 es la única excepción declarada.**
F5 = `lote` en todo el sistema (sugerir pedido, todo llegó igual, edición masiva). En el POS
F5 ya significa Descuento desde la v1.2.0 y no se toca. Queda anotado en el registro como
`keyException: 'F5 en POS = descuento (heredado v1.2.0, solo admin, solo POS)'` y la prueba
de consistencia lo acepta por estar declarado. Es la única excepción de todo el mapa.

**Aviso 3 — Ctrl+1..5 no sirve en la tablet.**
En el navegador Ctrl+1..8 cambia de pestaña y no es interceptable. Se conservan como están
(en Electron mandan) y se agrega **Alt+1..5** como alias: Alt+dígito no está asignado en
Chrome, Edge ni Firefox sobre Windows. Aditivo, no rompe nada.

**Aviso 4 — hay un capturador de flechas que pelea con el principio 6.**
`App.jsx:60-83` intercepta TODAS las flechas para mover el foco entre botones y convierte
Enter en clic. Con eso, "toda lista es navegable con ↑↓" es imposible: las flechas nunca
llegan a la lista. Propuesta: la capa del registro lo sustituye, y el salto de foco entre
botones queda solo como respaldo cuando ningún estado declara lista activa. Es un cambio
obligado, no opcional.

**Aviso 5 — Ctrl+P se reclasifica.**
Está marcado como reservado, pero el `Menu.setApplicationMenu(null)` de `electron/main.js:309`
lo deja completamente libre en la app de escritorio. Pasa de `RESERVED_KEYS` a
`DESKTOP_ONLY_KEYS`, igual que F12 y Ctrl+K.

### Revisión de conflictos SO/navegador (todas las teclas del mapa)

| Tecla | Navegador (tablet) | Electron (caja) | Veredicto |
|---|---|---|---|
| F1 | Chrome/Edge abren ayuda | libre | se intercepta con preventDefault |
| F2, F4, F8, F9 | libres | libres | sin problema |
| F3 | "buscar siguiente" | libre | se intercepta |
| F5 | recarga la página | libre | se intercepta; ya probado con F10 desde v1.2.0 |
| F6, F7 | foco a la barra / caret browsing | libres | se interceptan |
| F10 | abre el menú del navegador | libre | se intercepta (ya en uso sin quejas) |
| **F11** | pantalla completa, no interceptable | libre | **prohibida**, ya marcada |
| **F12** | DevTools, no interceptable | libre | solo alias de escritorio |
| **Ctrl+K** | barra de direcciones | libre | solo alias; F10 cubre |
| **Ctrl+1..5** | cambia pestaña | libre | + alias Alt+1..5 |
| **Ctrl+P** | imprime | **libre** | desktop-only |
| Ctrl+Z | deshacer del campo | igual | solo con la línea vacía |
| Ins, Supr, F1-F10 sueltas | libres | libres | sin problema |
| Espacio, Re Pág, Av Pág | hacen scroll | igual | preventDefault |
| Tab | mueve el foco | igual | se intercepta **solo dentro de la rejilla** |
| ← → | libres | libres | sin problema (Alt+← es "atrás", no se usa) |

---

## 3. Diagrama de estados de Compras

```
                        ┌──────────────────────────────────────────┐
                        │  Globales en TODOS los estados, incluso  │
                        │  con recuadros abiertos:                 │
                        │  F10/Ctrl+K paleta · Ctrl|Alt+1..5 ir a  │
                        │  F1 ayuda · Esc retrocede · Enter avanza │
                        └──────────────────────────────────────────┘

   F7 retomar
  ┌──────────┐
  │          v
  │   ┌─────────────┐   Enter · F4    ┌─────────────┐   F4 · F12   ┌──────────────┐
  └───│ PROVEEDOR   │────────────────>│   PEDIDO    │─────────────>│  CONFIRMAR   │
      │  (base)     │<────────────────│             │<─────────────│              │
      │             │   Esc (conserva │  línea de   │     Esc      │ F1/F2/F3 pago│
      │ F2 buscar   │    el pedido)   │  comando    │              │ F9 a crédito │
      │ ↑↓ mover    │                 │             │              │ ←→ pedido /  │
      │ Ins alta    │<────────────────│ F6 suspende │              │    compra ya │
      │ F3 selector │   F6 (limpio)   └─────────────┘              └──────────────┘
      └─────────────┘                        │                            │
        │        │                           │ F3 cambia proveedor        │ Enter
        │        │                           └────────────────────────────┘   ↓
        │ →      │ F9 (admin)                                    PROVEEDOR (limpio)
        v        v
 ┌─────────────┐  ┌──────────────┐  Enter · F4   ┌──────────────┐
 │ PENDIENTES  │  │  POR PAGAR   │──────────────>│    ABONO     │
 │  (lista)    │  │   (lista)    │<──────────────│  (clase pago)│
 │ ↑↓ mover    │  │ ↑↓ mover     │      Esc      │ monto = saldo│
 └─────────────┘  └──────────────┘               │ Enter registra│
        │ Enter · F4                             └──────────────┘
        v
 ┌────────────────────────────────────────────┐
 │              RECEPCIÓN (rejilla)           │
 │  ↑↓ renglón · Tab/←→ columna               │
 │  escribir sobrescribe · Enter confirma+baja│
 │  F5 todo llegó igual · Supr no llegó (0)   │
 │  Ctrl+Z deshacer · F4 confirmar · Esc sale │
 └────────────────────────────────────────────┘
```

Reglas de estado:
1. **Nunca se pierde trabajo.** El pedido en curso sobrevive a Esc, a un cambio de sección y
   al cierre del programa (mismo mecanismo de `suspendedSales.js`, generalizado).
2. **El foco siempre vuelve a la línea de comando** de PEDIDO, o al campo activo de la rejilla
   en RECEPCIÓN, incluso después de un error.
3. **Sin confirmaciones.** Guardar un pedido pendiente no toca dinero ni inventario: se avisa
   con folio y se puede cancelar. Recibir e inventariar sí mueve stock: se confirma con F4,
   que es un acto deliberado, y queda el flujo de cancelación existente.

---

## 4. Especificación del parser de Compras

Mismo motor que el POS. `parser.js` pasa a exportar `makeParser(spec)`; `parseCommand`
(POS) se conserva idéntico para no tocar las 25 pruebas existentes, y nace
`parsePurchase`.

### 4.1 Tabla de entrada → salida

| Entrada | Salida | Efecto |
|---|---|---|
| `7501055300201` | `{type:'product', code:'7501055300201', qty:1, amount:null}` | Agrega 1 al pedido |
| `3*7501` · `3x7501` · `3 7501` | `{type:'product', code:'7501', qty:3, amount:null}` | Agrega 3 |
| `2,5*7501` | `{type:'product', code:'7501', qty:2.5}` | Decimales para kg/L (acepta coma) |
| `$500*7501` | `{type:'product', code:'7501', amount:500, qty:null}` | Cantidad = importe ÷ costo |
| `?jab` | `{type:'search', query:'jab'}` | Busca **solo** productos del proveedor activo |
| `*12` | `{type:'set_qty', qty:12}` | Cantidad del renglón activo → 12 |
| `=18.50` | `{type:'set_cost', value:18.5}` | Costo unitario del renglón activo |
| `#bimbo` | `{type:'supplier', query:'bimbo'}` | Cambia de proveedor sin salir del pedido |
| `-7501` | `{type:'remove', code:'7501'}` | Quita ese renglón |
| `/sugerir` | `{type:'command', command:'sugerir'}` | Llena con lo que se está acabando |
| `/recibir` | `{type:'command', command:'recibir'}` | Abre la recepción del pedido pendiente |
| `/pagar` | `{type:'command', command:'pagar'}` | Abre el abono a ese proveedor (admin) |
| `/vincular` | `{type:'command', command:'vincular'}` | Liga el producto del renglón activo al proveedor |
| `%10` | `{type:'invalid', reason:'En compras el descuento va en el costo: usa =precio'}` | No adivina |
| `*0` · `=-3` | `{type:'invalid', ...}` | Cantidad/costo inválidos |
| `` (vacío) | `{type:'empty'}` | No hace nada |

### 4.2 Diferencias deliberadas con el parser del POS

| Prefijo | POS | Compras | Por qué |
|---|---|---|---|
| `=` | precio de **venta** | costo de **compra** | Mismo concepto: "el precio de este renglón" |
| `#` | cliente | proveedor | Mismo concepto: la entidad relacionada (F3) |
| `?` | busca en todo el catálogo | busca **en el proveedor activo** | Es lo que pediste; `??texto` fuerza catálogo completo |
| `%` | descuento | inválido con explicación | En una compra el descuento ya viene en el costo |

### 4.3 Comandos y ambigüedad de prefijos

Alias de Compras: `sugerir/sugerencia` · `recibir` · `pagar/abonar` · `vincular` ·
`nuevo/alta` · `suspender/pausar` · `reanudar/recuperar` · `guardar` · `cancelar` ·
`historial` · `ayuda/teclas` · `proveedor`.

`/re` es ambiguo (recibir vs reanudar) y devuelve `null` en vez de adivinar, igual que hace
hoy el POS con `/ret`. Se documenta `/rec` y `/rea` en la hoja de referencia.

**Comandos globales** (nuevos, válidos desde cualquier sección, incluido el POS):
`/compras` · `/pedido` (abre Compras con un pedido nuevo listo) · `/inventario` ·
`/clientes` · `/contabilidad` · `/proyector` · `/config` · `/pos`.
Se resuelven contra el registro: navegan primero y ejecutan después.

### 4.4 Lector de código de barras

Sin cambios: la ráfaga entra por la misma línea de comando y el mismo `input.js`
(<30 ms entre teclas, Enter final cierra la lectura). En PEDIDO, si el código escaneado no
pertenece al proveedor activo, **se agrega igual**, se avisa sin bloquear y `/vincular`
(o la tecla de la acción) lo liga al proveedor. La ráfaga nunca se interrumpe.

---

## 5. Cómo se van a medir los criterios de aceptación

| Criterio | Cómo se prueba |
|---|---|
| 1. Pedido de 15 renglones < 40 s | Máquina de estados pura + prueba que cuenta pulsaciones; presupuesto de 150 ms/pulsación humana |
| 2. Recepción con 3 ajustes < 25 s | Igual, sobre la rejilla |
| 3. Abono en ≤4 pulsaciones | Conteo exacto sobre el reductor |
| 5. Ninguna tecla con dos significados | Prueba contra el registro por `(clase, tecla) → semantic` |
| 6. Nada solo en menú | Prueba: todo `onClick` de menú debe tener `id` en el registro |
| 7. El foco vuelve siempre | Prueba de los caminos de error del reductor |
| 10. Lector 20 veces en Compras | Simulación de ráfaga sobre `parsePurchase` + detector |
| 9. `npm test` verde | Las 107 pruebas actuales no se tocan |
