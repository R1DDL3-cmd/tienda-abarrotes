# Manual de Usuario - Sistema Tienda de Abarrotes

## 1. Introduccion

El Sistema de Tienda de Abarrotes es una aplicacion de escritorio para Windows que permite gestionar las operaciones de una tienda de abarrotes: ventas (POS), inventario, contabilidad y clientes. El sistema funciona 100% local en la PC del dueno y puede ser accedido desde una tablet Android a traves de la red WiFi local.

### Requisitos del sistema
- **Sistema operativo:** Windows 7, 8, 8.1, 10 u 11
- **Memoria RAM:** 1 GB minimo
- **Disco duro:** 500 MB de espacio libre
- **Red:** Conexion WiFi local (para acceso desde tablet)

---

## 2. Instalacion

### 2.1 Instalacion en la PC

1. Ejecuta el archivo `Instalar.bat` que se encuentra en la carpeta `dist/`
2. Haz clic en "Si" cuando Windows solicite permisos de administrador
3. El instalador copiara los archivos a `C:\Program Files\TiendaAbarrotes`
4. Se crearan accesos directos en el escritorio y en el menu de inicio
5. Una vez terminado, presiona cualquier tecla para cerrar el instalador

### 2.2 Iniciar el sistema

1. Haz doble clic en el icono "Tienda Abarrotes" del escritorio
2. La aplicacion se abrira y mostrara la pantalla de inicio de sesion
3. En la parte superior de la pantalla de login, se muestra la direccion IP local y el puerto (ej: `http://192.168.1.5:3000`)

### 2.3 Conectar la tablet

1. Asegurate de que la tablet este conectada a la MISMA red WiFi que la PC
2. Abre el navegador de la tablet (Chrome, Firefox, etc.)
3. Escribe la direccion IP mostrada en la pantalla de login de la PC
   - Ejemplo: `http://192.168.1.5:3000`
4. Aparecera la pantalla de inicio de sesion en la tablet

---

## 3. Inicio de Sesion

### Credenciales por defecto
| Usuario | Contrasena | Rol |
|---------|-----------|-----|
| admin   | admin123  | Dueno (acceso completo) |
| cajero  | cajero123 | Cajero (solo ventas) |

**Recomendacion:** Cambia la contrasena del administrador despues del primer inicio de sesion.

---

## 4. Modulo de Ventas (POS)

El modulo de ventas es la pantalla principal del sistema.

### 4.1 Realizar una venta

1. **Escanear producto:** Usa el lector de codigo de barras (funciona como teclado). Al escanear, el producto se agrega automaticamente al carrito.
2. **Busqueda manual:** Si no tienes codigo de barras, haz clic en "Buscar" y escribe el nombre del producto.
3. **Ajustar cantidad:** Modifica la cantidad en la columna "Cant" del carrito.
4. **Aplicar descuento:** Ingresa el descuento por producto o el descuento total en el panel derecho.
5. **Seleccionar cliente (opcional):** Haz clic en "Seleccionar Cliente" para vender a credito (fiado).
6. **Cobrar:** Haz clic en "Cobrar" para abrir la pantalla de pago.

### 4.2 Metodos de pago

- **Efectivo:** El sistema calcula automaticamente el cambio
- **Tarjeta:** Registra el pago con tarjeta
- **Transferencia:** Registra transferencia bancaria
- **Fiado/Credito:** Para clientes de confianza, registra la venta a credito
- **Mixto:** Puedes combinar varios metodos de pago (ej: efectivo + tarjeta)

### 4.3 Ticket de venta

Al completar una venta, puedes:
- **Imprimir ticket:** Genera un ticket compatible con impresoras termicas de 58mm/80mm
- **Nueva venta:** Inicia otra venta

### 4.4 Cancelar una venta

1. Haz clic en "Historial" en la parte superior
2. Busca la venta que deseas cancelar
3. Haz clic en "Cancelar"
4. Ingresa el motivo de cancelacion (obligatorio)
5. Confirma la cancelacion - el inventario se ajustara automaticamente

---

## 5. Modulo de Inventario

### 5.1 Dar de alta un producto

1. En el modulo de Inventario, haz clic en "+ Nuevo Producto"
2. Completa los datos:
   - **Nombre:** Nombre del producto
   - **Codigo de barras:** Dejalo vacio para que se genere automaticamente
   - **Categoria:** Selecciona la categoria existente o crea una nueva
   - **Precio de compra:** Cuanto te costo el producto
   - **Precio de venta:** Precio al que lo vendes
   - **Stock:** Cantidad inicial en inventario
   - **Stock minimo:** Cantidad minima antes de alertar
   - **Proveedor:** Nombre del proveedor
   - **Fecha de caducidad:** Fecha de vencimiento (opcional)
3. Haz clic en "Crear"

### 5.2 Alta rapida desde la tablet

Desde la tablet, puedes escanear el codigo de barras directamente con la camara para buscar productos y dar de alta nuevos.

### 5.3 Alertas de stock bajo

Los productos con stock menor o igual al minimo aparecen resaltados en amarillo y se muestran en el panel de contabilidad.

### 5.4 Kardex (historial de movimientos)

Para ver el historial de entradas y salidas de un producto:
1. Busca el producto en la tabla
2. Haz clic en "Kardex"
3. Se mostrara el historial completo de movimientos

---

## 6. Modulo de Contabilidad

### 6.1 Panel de control

El panel muestra un resumen de:
- Ventas del dia, la semana y el mes
- Gastos del dia
- Productos mas vendidos
- Grafica de ventas diarias
- Alertas de stock bajo

### 6.2 Corte de caja diario

1. Ve a la pestana "Caja"
2. Si la caja esta abierta, haz clic en "Cerrar Caja"
3. Ingresa el monto de efectivo contado en caja
4. El sistema calcula automaticamente:
   - Efectivo esperado (monto inicial + ventas - gastos)
   - Diferencia con el efectivo contado
   - Cualquier diferencia se senala automaticamente

### 6.3 Registrar gastos

1. Ve a la pestana "Gastos"
2. Haz clic en "+ Nuevo Gasto"
3. Ingresa descripcion, monto, categoria y metodo de pago
4. Haz clic en "Guardar"

### 6.4 Reportes

1. Ve a la pestana "Reportes"
2. Selecciona el periodo (fecha inicio y fecha fin)
3. Haz clic en "Actualizar" para ver:
   - Ingresos, costos y utilidad
   - Productos mas vendidos
   - Ventas por periodo
4. Puedes exportar los datos a CSV

### 6.5 Respaldos

1. Ve a la pestana "Respaldos"
2. Haz clic en "Respaldar Ahora" para crear un respaldo manual
3. Los respaldos se guardan automaticamente cada noche en: `C:\Users\[tu-usuario]\TiendaAbarrotesBackups\`

---

## 7. Solucion de problemas

### 7.1 No puedo conectar desde la tablet

1. Verifica que ambos dispositivos esten en la MISMA red WiFi
2. En la PC, abre el simbolo del sistema (cmd) y escribe: `ipconfig`
3. Busca tu "Direccion IPv4" (ej: 192.168.1.5)
4. En la tablet, escribe: `http://[esa-direccion]:3000`
5. Si no funciona, revisa el Firewall de Windows (ver seccion de instalacion)

### 7.2 El escaner de codigo de barras no funciona

1. El escaner debe funcionar como teclado (HID)
2. Conecta el escaner via USB
3. Abre un bloc de notas y escanea un producto - si aparece el codigo, funciona
4. En el sistema, asegurate de que el cursor este en el campo de escaneo

### 7.3 Olvide mi contrasena

Si olvidas la contrasena, sigue estos pasos:
1. Abre la base de datos con un programa como DB Browser for SQLite
2. El archivo esta en: `C:\Users\[tu-usuario]\TiendaAbarrotes\tienda.db`
3. Busca la tabla "users" y cambia la contrasena (usando bcrypt)

---

## 8. Soporte

Para reportar problemas o sugerir mejoras, contacta al desarrollador.

---

© 2024 - Sistema Tienda de Abarrotes - Version 1.0
