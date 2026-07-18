# Manual de Usuario — Sistema Tienda de Abarrotes

Versión del sistema: 1.0.4

---

## Índice

1. Introducción
2. Instalación y primer arranque
3. Actualizaciones automáticas
4. Inicio de sesión y roles de usuario
5. Punto de Venta (POS)
6. Inventario
7. Compras a Proveedores
8. Contabilidad
9. Clientes
10. Configuración
11. Atajos de teclado
12. Acceso desde tablet (multi-dispositivo) y modo offline
13. Solución de problemas

---

## 1. Introducción

El Sistema de Tienda de Abarrotes es una aplicación de escritorio para Windows que gestiona las operaciones diarias de una tienda: ventas (POS), inventario, compras a proveedores, contabilidad y clientes. Corre 100% de forma local en la computadora principal de la tienda — no depende de internet para funcionar — y puede ser accedido desde una tablet u otro dispositivo por la red WiFi local, para tener una segunda caja o una consulta rápida de inventario.

### Requisitos del sistema
- Windows 7, 8, 8.1, 10 u 11 (32 o 64 bits)
- 1 GB de RAM mínimo
- 500 MB de espacio libre en disco
- Red WiFi local, solo si se quiere usar el acceso desde tablet

---

## 2. Instalación y primer arranque

1. Ejecuta el instalador (`Sistema Tienda de Abarrotes Setup x.x.x.exe`). El mismo archivo instala tanto en equipos de 32 como de 64 bits — detecta automáticamente cuál necesita tu equipo.
2. Sigue el asistente: puedes elegir la carpeta de instalación y si se crea acceso directo en el escritorio.
3. Al terminar, abre "Sistema Tienda de Abarrotes" desde el acceso directo o el menú de inicio.
4. La primera vez que abre, el sistema crea su base de datos vacía con dos usuarios de ejemplo (ver sección 4) y queda escuchando en un puerto local (normalmente el 3000).
5. La ventana principal muestra la pantalla de inicio de sesión, con la dirección de red de la tienda arriba (útil para conectar la tablet, ver sección 12).

**Importante:** el programa sigue corriendo en segundo plano (ícono en la bandeja del sistema, junto al reloj de Windows) aunque cierres la ventana con la "X" — así la tablet no pierde la conexión. Para apagarlo del todo, haz clic derecho en el ícono de la bandeja y elige "Cerrar servidor".

![Pantalla de inicio de sesión](manual_screenshots/01_login.png)

---

## 3. Actualizaciones automáticas

El sistema revisa solo si hay una versión nueva disponible al arrancar y cada 4 horas mientras está abierto. Cuando encuentra y descarga una actualización:

- Aparece una notificación de Windows avisando.
- Se abre una ventana mostrando qué cambió respecto a la versión que tenías instalada.
- La actualización se instala sola la próxima vez que cierres el programa por completo, o puedes forzar el reinicio de inmediato desde el ícono de la bandeja del sistema ("Reiniciar para actualizar").

No es necesario descargar ni instalar nada manualmente salvo la primera vez.

---

## 4. Inicio de sesión y roles de usuario

### Usuarios por defecto

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| admin   | admin123  | Dueño (acceso completo) |
| cajero  | cajero123 | Cajero (solo ventas y compras) |

**Recomendación:** cambia ambas contraseñas desde Configuración > Contraseña en cuanto instales el sistema.

### Roles

- **Dueño (admin):** acceso a todo — POS, Inventario, Compras, Contabilidad, Clientes y Configuración.
- **Cajero:** acceso a POS y Compras únicamente. No ve Contabilidad, Clientes ni Configuración.
- **Inventario:** acceso únicamente a la pantalla de Inventario, pensado para quien solo surte anaquel y cuenta existencias, sin ver ventas ni dinero.

Se pueden crear más usuarios desde Configuración > Usuarios (sección 10).

---

## 5. Punto de Venta (POS)

Es la pantalla principal donde se hacen las ventas del día a día.

![POS con productos en el carrito](manual_screenshots/02_pos_principal.png)

### 5.1 Iniciar turno

Antes de poder vender, cada cajero debe iniciar su turno con el botón **"Iniciar Día"** (o "Iniciar Turno" si ya hay caja abierta), ingresando el efectivo con el que arranca la caja. Esta ventana es obligatoria — no se puede cerrar con ESC ni sin ingresar un monto, para asegurar que el corte de caja del día siempre parta de un número real.

### 5.2 Agregar productos al carrito

- **Escanear código de barras:** el lector funciona como teclado — al escanear, el producto se agrega solo al carrito. El cuadro de escaneo está siempre listo para recibir el siguiente código.
- **Búsqueda manual (F2 o botón "Buscar"):** escribe el nombre o parte del código de barras.
- **Productos vendidos por kg o litro:** el sistema pide la cantidad en la unidad correspondiente en vez de piezas.
- **Productos con venta individual** (ej. cigarros sueltos de una cajetilla): al escanear o buscar uno de estos productos, aparece una ventana para elegir si se vende el paquete completo o piezas individuales.
- **Código no registrado en el inventario:** si escaneas un código que no existe, el sistema pide un código de seguridad antes de continuar (configurable en Configuración > Seguridad) — esto evita que se vendan productos no dados de alta por error o de forma indebida. Esta ventana tampoco se puede saltar con ESC.

### 5.3 Descuentos y cliente

- Se puede aplicar un descuento total a la venta desde el panel de la derecha.
- **"Seleccionar Cliente (Fiado)" (F6):** para vender a crédito a un cliente registrado. Solo el Dueño (o quien tenga el permiso) puede dejar saldo pendiente — el cajero puede seleccionar cliente para historial, pero el fiado como método de pago está restringido según el rol.

### 5.4 Cobrar

Al hacer clic en **"Cobrar" (F4)** se abre la ventana de pago:

![Modal de cobro](manual_screenshots/03_pos_cobrar.png)

- Puedes combinar varios métodos de pago en una misma venta (ej. una parte en efectivo y otra con tarjeta) con el botón "+ Agregar otro pago".
- Si pagan en efectivo, el sistema calcula el cambio automáticamente.
- "Completar Venta" se habilita solo cuando el total pagado cubre el total de la venta.

### 5.5 Ticket

Al terminar la venta se puede imprimir el ticket (formato térmico de 58mm). El ticket incluye el logo de la tienda si se configuró uno (sección 10.1), los datos de la tienda, el desglose de productos, el total y el mensaje de pie configurado.

![Ticket impreso](manual_screenshots/04_pos_ticket.png)

### 5.6 Historial y cancelaciones

Desde **"Historial" (F8)** se ven las ventas del día. Solo el Dueño puede cancelar una venta ya completada; se pide un motivo obligatorio y el inventario se ajusta automáticamente al cancelar.

### 5.7 Retiros de efectivo

Durante el turno se puede registrar un retiro de efectivo de la caja (ej. para dar cambio a otra caja, o un gasto menor inmediato) desde el botón "Retiro" — queda registrado con motivo y aparece en el historial de movimientos de caja.

### 5.8 Cerrar el día

Al terminar el turno, "Cerrar Día" pide el efectivo contado físicamente en caja; el sistema calcula el efectivo esperado (apertura + ventas - gastos - retiros) y la diferencia. Esta ventana, igual que "Iniciar Día" y el código de seguridad, es obligatoria y no se puede saltar con ESC — solo se cierra ingresando el monto.

---

## 6. Inventario

![Lista de productos en Inventario](manual_screenshots/05_inventario_lista.png)

### 6.1 Dar de alta un producto

Con **"+ Nuevo Producto"**:

![Modal Nuevo Producto](manual_screenshots/06_inventario_nuevo_producto.png)

- **Código de barras:** si se deja vacío, el sistema genera uno automáticamente.
- **Categoría, precio de compra y venta, stock y stock mínimo, proveedor.**
- **Tipo de venta:** por pieza, por peso (kg) o por volumen (litro).
- **Venta individual:** si el producto se vende también suelto (ej. cigarros), se activa la casilla y se indica cuántas piezas trae el paquete y el precio por pieza suelta.

### 6.2 Códigos de barras adicionales

Un mismo producto puede tener más de un código de barras (por ejemplo, presentaciones distintas o el código que genera una báscula). Desde "Códigos" en cada producto se agregan códigos extra que apuntan al mismo artículo.

### 6.3 Lotes y kardex

- **"Lotes":** para llevar el control de entradas por lote con fecha de caducidad.
- **"Kardex":** historial completo de entradas, salidas y ajustes de stock de ese producto, con fecha, tipo de movimiento y quién lo hizo.

### 6.4 Categorías

Desde el botón "Categorías" se crean, editan o eliminan las categorías del catálogo.

### 6.5 Mermas y devoluciones

El Dueño puede registrar mermas (producto dañado, caducado, robo) o devoluciones a proveedor desde el botón "Mermas" — se descuenta el stock y queda un registro con el motivo y la pérdida en dinero.

### 6.6 Inventario obsoleto

"Inventario Obsoleto" muestra productos activos que no se han vuelto a surtir en el periodo configurado (90 días por defecto) — útil para detectar mercancía que el proveedor ya dejó de traer o que conviene descontinuar. Se puede desactivar en lote los seleccionados.

### 6.7 Importar y exportar el catálogo en Excel

![Botones de Exportar/Importar Excel](manual_screenshots/07_inventario_excel.png)

- **"Exportar Excel":** descarga el catálogo completo en un archivo `.xlsx` con encabezados claros (Código de Barras, Nombre, Categoría, Precio Compra, Precio Venta, Stock, Stock Mínimo, Proveedor, Tipo Unidad, Activo).
- **"Importar Excel":** carga un archivo de inventario. Reconoce tanto el formato propio (el mismo que genera "Exportar Excel") como el formato de sistemas de punto de venta anteriores más comunes en abarrotes (hoja "Articulos" con columnas ARTÍCULO, DESCRIPCIÓN, LINEA, etc.).
  - Los productos que coincidan por código de barras se **actualizan**.
  - Los que no existan se **crean**.
  - Cualquier producto activo que **no aparezca** en el archivo importado se **desactiva** (no se borra) — pensado para cuando el Excel es el catálogo completo y actualizado de la tienda.
  - Si el sistema no reconoce ni una sola fila del archivo (formato desconocido), no cambia nada y avisa del error, en vez de desactivar el catálogo por error.

---

## 7. Compras a Proveedores

![Compras con un proveedor seleccionado](manual_screenshots/08_compras_proveedores.png)

### 7.1 Proveedores

Se dan de alta desde "Nuevo Proveedor" (nombre, contacto, teléfono, dirección). Los proveedores que ya existían como texto libre en productos antiguos se sincronizan automáticamente a esta lista.

### 7.2 Crear un pedido o compra

Selecciona un proveedor y haz clic en "Nuevo Pedido":

![Modal Nuevo Pedido con buscador de productos](manual_screenshots/09_compras_nuevo_pedido.png)

- El buscador de productos muestra **solo los productos vinculados a ese proveedor** — escribe parte del nombre o código para agregarlos a la lista.
- **"Sugerir productos a reponer":** llena automáticamente la lista con los productos de ese proveedor cuyo stock está bajo, según el histórico de ventas.
- **Tipo de compra:**
  - **Pedido (pendiente):** se registra pero no afecta el inventario todavía — para cuando se hace el pedido pero la mercancía aún no llega.
  - **Compra directa:** se inventaría de inmediato.
- El sistema calcula subtotal, IVA (16%) y total automáticamente.

### 7.3 Recibir un pedido pendiente

Cuando llega la mercancía de un pedido pendiente, se recibe desde "Recibir" — se puede ajustar la cantidad y el precio realmente recibidos si difieren de lo pedido (el inventario y el costo del producto se actualizan con lo realmente recibido, no con lo pedido).

### 7.4 Gasto automático en Contabilidad

Al confirmar una compra directa, o al recibir un pedido pendiente, el importe total se registra **automáticamente como gasto en Contabilidad** (categoría "Compra a proveedor"), sin necesidad de capturarlo dos veces. Si la compra se cancela, el gasto se revierte también.

### 7.5 Cancelar una compra

Cancela una compra o pedido desde la lista; si ya había sido inventariada, el stock correspondiente se revierte.

---

## 8. Contabilidad

*(Disponible solo para el Dueño)*

### 8.1 Resumen

![Contabilidad - Resumen](manual_screenshots/10_contabilidad_resumen.png)

Panel de control con ventas del día/semana/mes, gastos, productos más vendidos, alertas de stock bajo y una gráfica de ventas.

### 8.2 Caja

![Contabilidad - Caja](manual_screenshots/11_contabilidad_caja.png)

Muestra el estado de la caja del día: monto de apertura, ventas, gastos y el corte cuando se cierra. Aquí también se ve el historial de retiros de efectivo del día.

### 8.3 Gastos

![Contabilidad - Gastos](manual_screenshots/12_contabilidad_gastos.png)

- **"+ Nuevo Gasto":** descripción, monto, categoría, método de pago y notas.
- Los gastos generados automáticamente por compras a proveedores (sección 7.4) también aparecen aquí, marcados con la categoría "Compra a proveedor".
- Solo el Dueño puede eliminar un gasto.

### 8.4 Reportes

![Contabilidad - Reportes](manual_screenshots/13_contabilidad_reportes.png)

Selecciona un rango de fechas para ver ingresos, costos, utilidad y los productos más vendidos en ese periodo. Los datos se pueden exportar a CSV para llevarlos a Excel.

### 8.5 Predicciones

Estimación de cuánto se espera vender de cada producto o categoría en los próximos días, basada en el historial de ventas, calendario (fines de semana, quincenas) y eventos registrados (ver 8.6) — pensada para ayudar a decidir cuánto reabastecer sin usar matemática compleja de por medio.

### 8.6 Eventos

Registro de fechas especiales (días festivos, eventos locales, promociones) que afectan las ventas, para que las predicciones los tomen en cuenta.

### 8.7 Movimientos de caja

Bitácora completa de todo lo que entra y sale de la caja: ventas, gastos, retiros, aperturas y cierres, con fecha, monto y quién lo realizó.

---

## 9. Clientes

![Lista de clientes](manual_screenshots/14_clientes_lista.png)

*(Disponible solo para el Dueño)*

- Alta de clientes con nombre, teléfono, dirección y límite de crédito.
- Cada cliente lleva su saldo pendiente (fiado) y su historial de compras.
- **"Registrar Pago":** abona al saldo pendiente del cliente, con método de pago y notas.

---

## 10. Configuración

*(Disponible solo para el Dueño)*

### 10.1 Tienda

![Configuración - Tienda](manual_screenshots/15_config_tienda.png)

- Nombre, dirección, teléfono y mensaje de pie de página — aparecen en todos los tickets impresos.
- **Logo de la tienda:** al subir una imagen, se redimensiona automáticamente y se usa en dos lugares:
  - Como marca de agua grande y pálida de fondo en toda la aplicación (no estorba la lectura).
  - En el encabezado de los tickets impresos (ventas y pedidos a proveedor).

### 10.2 Apariencia

![Configuración - Apariencia](manual_screenshots/16_config_apariencia.png)

- **Tema claro/oscuro:** se guarda por dispositivo (cada PC o tablet puede tener el suyo).
- **Colores de marca:** primario, éxito, peligro y advertencia — se aplican en toda la aplicación para todos los usuarios y dispositivos. "Restablecer" regresa a los colores originales.

### 10.3 Atajos de teclado

![Configuración - Atajos](manual_screenshots/17_config_atajos.png)

Permite reasignar las teclas de acceso rápido del sistema (ver sección 11).

### 10.4 Hora

Corrección manual de la hora mostrada en el sistema, por si el reloj de Windows está mal configurado en algún equipo.

### 10.5 Usuarios

![Configuración - Usuarios](manual_screenshots/18_config_usuarios.png)

Alta, edición y baja de usuarios del sistema, con su rol (Dueño, Cajero o Inventario).

### 10.6 Contraseña

Cambio de la contraseña del usuario que tiene la sesión iniciada.

### 10.7 Seguridad

Código de seguridad que se pide al escanear un producto no registrado en el inventario (ver 5.2).

### 10.8 Respaldos

![Configuración - Respaldos](manual_screenshots/19_config_respaldos.png)

- El sistema hace un respaldo automático de la base de datos una vez al día.
- **"Respaldar Ahora":** crea un respaldo manual en el momento.
- **"Extraer DB" / "Importar DB":** exporta o reemplaza la base de datos completa (por ejemplo, para mover la información a otro equipo). Importar reinicia la aplicación.
- **"Restaurar":** regresa la base de datos a un respaldo anterior de la lista.
- Los respaldos automáticos se guardan en `C:\Users\[tu usuario]\TiendaAbarrotesBackups\`.

---

## 11. Atajos de teclado

| Tecla | Acción |
|---|---|
| F2 | Buscar producto (en POS) |
| F4 | Cobrar (en POS) |
| F6 | Seleccionar cliente / Fiado (en POS) |
| F8 | Historial de ventas del día (en POS) |
| Ctrl + / Ctrl - | Acercar / alejar el tamaño de la ventana |
| Ctrl + 0 | Restablecer el tamaño de la ventana |
| Flechas / teclado numérico | Mover el foco entre botones y campos |

Estos atajos se pueden reasignar desde Configuración > Atajos (sección 10.3).

### Comportamiento de ESC y Enter

- **ESC** cierra cualquier ventana emergente abierta (formularios, confirmaciones, listas), como un botón de "atrás".
- **Enter** confirma la acción principal de la ventana abierta (equivalente a hacer clic en el botón resaltado).
- Excepciones — estas ventanas **no se pueden cerrar con ESC**, porque piden información obligatoria para que la caja y el inventario cuadren:
  - Ingresar el efectivo inicial al iniciar turno.
  - Ingresar el efectivo final al cerrar el día o el turno.
  - Ingresar el código de seguridad al escanear un producto no registrado.

---

## 12. Acceso desde tablet (multi-dispositivo) y modo offline

1. Conecta la tablet a la **misma red WiFi** que la computadora principal.
2. En el navegador de la tablet, escribe la dirección que se muestra en la pantalla de inicio de sesión de la PC (ejemplo: `http://192.168.1.5:3000`).
3. Inicia sesión normalmente — la tablet ve la misma información en tiempo real que la PC principal.

**Modo offline (checkpoint 1):** si la tablet pierde la señal WiFi a medio turno, el catálogo de productos y clientes consultado más recientemente queda disponible para buscar (de solo lectura) hasta que vuelva la conexión. Esto no cubre abrir la aplicación desde cero sin haber tenido conexión antes.

---

## 13. Solución de problemas

### No puedo conectar desde la tablet
1. Verifica que ambos dispositivos estén en la misma red WiFi.
2. En la PC, revisa la dirección mostrada en la pantalla de inicio de sesión.
3. Si no conecta, revisa que el Firewall de Windows no esté bloqueando el puerto.

### El lector de código de barras no funciona
1. El lector debe funcionar como teclado (USB, tipo HID) — pruébalo escaneando dentro de un Bloc de notas; si aparece el código como texto, funciona.
2. Asegúrate de que el cursor esté en el cuadro de escaneo del POS.

### El programa se abre varias veces / hay varios íconos en la bandeja
A partir de la versión 1.0.4, el sistema evita esto automáticamente: si ya hay una instancia corriendo, al abrir el programa de nuevo simplemente se enfoca la ventana existente en vez de abrir una nueva.

### Olvidé mi contraseña
Si ningún usuario Dueño puede iniciar sesión, contacta a soporte técnico — cambiar la contraseña directamente en la base de datos requiere herramientas especializadas y no se recomienda hacerlo sin ayuda.

---

© 2026 — Sistema Tienda de Abarrotes — Versión 1.0.4
