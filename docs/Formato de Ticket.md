# Formato de Ticket — documentación

Motor de impresión de tickets estilo POS comercial. Una sola fuente de datos
(la estructura `Ticket`) alimenta **dos renderizadores**: texto monoespaciado
y bytes ESC/POS. El layout nunca se escribe dos veces.

## Archivos

| Archivo | Qué hace |
|---|---|
| `server/services/ticket/columns.js` | Utilidad **única** de formato: `columna()`, `izqDer()`, `envolver()`, `marco()`, `money()`. Todo el layout se construye con estas funciones. |
| `server/services/ticket/renderText.js` | `Ticket` → renglones de texto. Es la fuente del layout. |
| `server/services/ticket/renderEscpos.js` | Esos mismos renglones → bytes ESC/POS. No calcula layout. |
| `server/services/ticket/buildTicket.js` | Venta de la base de datos → estructura `Ticket`. Único punto que sabe de SQL. |
| `server/services/ticket/testPrint.js` | Hoja de prueba de instalación (reglas de columnas + acentos). |
| `server/services/printer.js` | Transporte: RAW por spooler de Windows, puerto COM, o respaldo HTML. |
| `server/templates/ticket.json` | **Plantilla configurable**: anchos, bloques activos, leyendas. Se edita sin recompilar. |
| `docs/ticket-muestra.txt` | Ticket de muestra en 32, 48 y 64 columnas + copia + hoja de prueba. |

## La plantilla (`server/templates/ticket.json`)

Se puede editar en caliente. Al arrancar se **valida**: si los anchos de una
rejilla no suman el total de columnas, el sistema falla en vez de imprimir
tickets desalineados.

### Rejillas

| Ancho | Papel | Modo | Campos |
|---|---|---|---|
| **32** | 58 mm | Dos renglones por artículo | cant 4 · " x " 3 · precio 8 · total 17 |
| **48** | 80 mm Font A | Un renglón | cant 4 · sp 1 · sku 4 · sp 1 · desc 13 · regular 8 · promo 8 · total 9 |
| **64** | 80 mm Font B | Un renglón | cant 4 · sp 1 · sku 6 · sp 1 · desc 26 · regular 8 · promo 9 · total 9 |

Para cambiar un ancho basta editar los números; la suma debe dar exactamente
el ancho o el arranque falla con un mensaje claro.

### Bloques activables

```json
"bloques": {
  "logo": true, "sucursal": false, "fiscal": false,
  "identificacion": true, "impuestos": false,
  "autorizacion": true, "monedero": false, "facturacion": false
}
```

- `fiscal` y `sucursal` vienen **apagados**: la tienda no expide facturas y no
  existen esos campos en Configuración.
- `impuestos`: si se enciende, desglosa el **IVA contenido** en el precio (no
  lo suma encima), porque los precios de la tienda ya lo incluyen.
- `facturacion`: imprime QR + URL. Requiere `store.facturacion_url`.

### ESC/POS

```json
"escpos": {
  "codepage": 2,        // 2=CP850, 19=CP858, 16=Windows-1252, 0=CP437
  "translit": false,    // true: á→a, ñ→n (respaldo si nada funciona)
  "avance_lineas": 4,
  "corte": "parcial",
  "abrir_cajon_con_efectivo": true
}
```

## Configuración de la impresora (pantalla)

**Configuración → Impresora.** No hace falta saber el modelo:

1. Presionar **Imprimir hoja de prueba**.
2. En el papel salen tres reglas (`[32]`, `[48]`, `[64]`). La más ancha que
   salga en **una sola línea** es el ancho correcto.
3. Elegir ese ancho y guardar.
4. Si los acentos salen como símbolos raros, cambiar el juego de caracteres o
   activar "quitar los acentos".

### Modos de impresión

| Modo | Cuándo |
|---|---|
| **Por Windows (html)** | Predeterminado. Funciona siempre; es el comportamiento que ya tenía el sistema. |
| **Automático** | Busca sola una impresora que parezca ticketera y le manda ESC/POS. |
| **Impresora USB específica** | La más rápida: se elige por nombre y se manda RAW por el spooler. |
| **Puerto COM** | Impresoras seriales o adaptadores serie-USB. |

**Respaldo garantizado:** si el envío ESC/POS falla por cualquier motivo, el
servidor responde con el texto ya formado y el sistema imprime por Windows.
La tienda nunca se queda sin ticket por un problema de hardware.

## Endpoints

| Método | Ruta | Para qué |
|---|---|---|
| `GET` | `/api/hardware/printers` | Lista impresoras y puertos COM (admin) |
| `POST` | `/api/hardware/test-print` | Hoja de prueba de instalación (admin) |
| `GET` | `/api/hardware/ticket/:id/preview` | Texto del ticket (`?ancho=`, `?copia=1`) |
| `POST` | `/api/hardware/ticket/:id/print` | Imprime; responde `via: raw\|serial\|html` |

## Reglas de formato

- Importes con **2 decimales, punto, sin separador de miles**, `$` solo en el TOTAL.
- Negativos con el signo pegado (`-43.00`), nunca paréntesis.
- Columna de promoción **vacía** si se vendió a precio regular (ni `0.00` ni guiones).
- Descripción **truncada** por convención de supermercado; `wrapDescription: true`
  la parte en un segundo renglón.
- **Todo el dinero se maneja en centavos enteros.** Nunca punto flotante: el
  ticket debe cuadrar al centavo con el corte de caja.
- De la tarjeta solo se imprimen los **últimos 4 dígitos** (PCI-DSS).
- El cambio se imprime siempre, aunque sea `0.00`.
- Las reimpresiones salen marcadas `*** COPIA ***`.

## Pruebas

`server/tests/ticket.test.js` cubre los 8 criterios de aceptación: ancho exacto
renglón por renglón en los tres anchos, descripción de 60 caracteres, cantidad
`-99` y total `-9999.99`, total `123456.78`, 60 renglones paginados, misma
información en 48 y 64, cuadre entero en centavos, y previa idéntica a lo
impreso.

```bash
npm test
```
