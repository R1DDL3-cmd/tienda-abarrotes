// Transporte hacia la impresora de tickets.
//
// Tres caminos, en orden de preferencia:
//   1. RAW por el spooler de Windows (impresora USB instalada con driver).
//      Es el caso normal: los bytes ESC/POS se mandan tal cual, sin que el
//      driver los interprete como texto de Windows.
//   2. Puerto COM serial (impresoras viejas o adaptadores serie-USB). Es el
//      mismo camino que ya usa el cajón de dinero.
//   3. HTML por window.print() — el comportamiento actual del sistema. Queda
//      como RESPALDO: si no se detecta impresora ESC/POS, la tienda sigue
//      imprimiendo como hoy y nadie se queda sin ticket.
const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function getPS() {
  if (process.platform === 'win32') {
    const sys32 = path.join(process.env.WINDIR || 'C:\\Windows', 'System32');
    const ps = path.join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(ps)) return ps;
  }
  return 'powershell.exe';
}

function runPS(script, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    // El script va por archivo temporal: pasarlo inline se rompe con las
    // comillas del C# incrustado.
    const tmp = path.join(os.tmpdir(), `tienda-print-${Date.now()}.ps1`);
    try {
      fs.writeFileSync(tmp, script, 'utf8');
    } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    exec(`"${getPS()}" -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, { timeout }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch (_) {}
      if (err) return resolve({ ok: false, error: (stderr || err.message || '').trim(), stdout: String(stdout || '') });
      resolve({ ok: true, stdout: String(stdout || '').trim() });
    });
  });
}

// ------------------------------------------------------------------
// Descubrimiento
// ------------------------------------------------------------------
async function listarImpresoras() {
  if (process.platform !== 'win32') return [];
  const r = await runPS(`
    $ErrorActionPreference = 'SilentlyContinue'
    Get-CimInstance Win32_Printer | ForEach-Object {
      "$($_.Name)|$($_.PortName)|$($_.Default)"
    }
  `, { timeout: 10000 });
  if (!r.ok) return [];
  return r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const [nombre, puerto, predeterminada] = l.split('|');
    return {
      nombre,
      puerto: puerto || '',
      predeterminada: String(predeterminada).toLowerCase() === 'true',
      // Heurística: los nombres/puertos típicos de térmicas de tickets.
      probableTicketera: /pos|thermal|termic|receipt|ticket|58|80|xprinter|epson tm|bixolon|star tsp/i.test(nombre + ' ' + puerto),
    };
  });
}

function listarPuertosSerie() {
  if (process.platform !== 'win32') return [];
  try {
    const out = execSync(`"${getPS()}" -NoProfile -Command "[System.IO.Ports.SerialPort]::getportnames()"`,
      { timeout: 5000, encoding: 'utf8' });
    return out.split(/\r?\n/).map(s => s.trim()).filter(s => /^COM\d+$/i.test(s));
  } catch (e) {
    return [];
  }
}

// ------------------------------------------------------------------
// Envío RAW por el spooler (USB). Sin dependencias nativas: se llama a
// winspool.drv desde PowerShell con P/Invoke. Out-Printer NO sirve aquí
// porque pasa por GDI y convertiría los comandos ESC/POS en texto impreso.
// ------------------------------------------------------------------
function scriptRaw(nombreImpresora, rutaBytes) {
  return `
$ErrorActionPreference = 'Stop'
$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static string Send(string printerName, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printerName, out h, IntPtr.Zero)) return "ERR_OPEN";
    DOCINFO di = new DOCINFO();
    di.pDocName = "Ticket";
    di.pDataType = "RAW";
    if (!StartDocPrinter(h, 1, di)) { ClosePrinter(h); return "ERR_DOC"; }
    if (!StartPagePrinter(h)) { EndDocPrinter(h); ClosePrinter(h); return "ERR_PAGE"; }
    IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, p, bytes.Length);
    int written = 0;
    bool ok = WritePrinter(h, p, bytes.Length, out written);
    Marshal.FreeCoTaskMem(p);
    EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h);
    return ok ? "OK" : "ERR_WRITE";
  }
}
"@
Add-Type -TypeDefinition $code -Language CSharp | Out-Null
$bytes = [System.IO.File]::ReadAllBytes(${JSON.stringify(rutaBytes)})
$res = [RawPrinter]::Send(${JSON.stringify(nombreImpresora)}, $bytes)
Write-Output $res
`;
}

async function enviarRaw(nombreImpresora, buffer) {
  if (process.platform !== 'win32') return { ok: false, error: 'La impresión RAW solo está implementada en Windows' };
  const tmp = path.join(os.tmpdir(), `ticket-${Date.now()}.bin`);
  try {
    fs.writeFileSync(tmp, buffer);
    const r = await runPS(scriptRaw(nombreImpresora, tmp));
    try { fs.unlinkSync(tmp); } catch (_) {}
    if (!r.ok) return { ok: false, error: r.error || 'No se pudo ejecutar la impresión' };
    const salida = (r.stdout || '').trim();
    if (salida === 'OK') return { ok: true, via: 'raw', impresora: nombreImpresora };
    const motivos = {
      ERR_OPEN: 'No se pudo abrir la impresora (revisa el nombre y que esté encendida)',
      ERR_DOC: 'La impresora rechazó el trabajo',
      ERR_PAGE: 'La impresora rechazó la página',
      ERR_WRITE: 'No se pudieron enviar los datos',
    };
    return { ok: false, error: motivos[salida] || `Respuesta inesperada: ${salida}` };
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    return { ok: false, error: e.message };
  }
}

// ------------------------------------------------------------------
// Envío por puerto COM
// ------------------------------------------------------------------
async function enviarSerial(puerto, buffer, baud = 9600) {
  const tmp = path.join(os.tmpdir(), `ticket-${Date.now()}.bin`);
  try { fs.writeFileSync(tmp, buffer); } catch (e) { return { ok: false, error: e.message }; }
  const r = await runPS(`
$ErrorActionPreference = 'Stop'
try {
  $bytes = [System.IO.File]::ReadAllBytes(${JSON.stringify(tmp)})
  $port = New-Object System.IO.Ports.SerialPort ${JSON.stringify(puerto)},${baud},None,8,One
  $port.Open()
  $port.Write($bytes, 0, $bytes.Length)
  Start-Sleep -Milliseconds 400
  $port.Close()
  Write-Output "OK"
} catch { Write-Output "FAIL" }
`);
  try { fs.unlinkSync(tmp); } catch (_) {}
  if (r.ok && (r.stdout || '').trim() === 'OK') return { ok: true, via: 'serial', puerto };
  return { ok: false, error: 'No se pudo escribir en ' + puerto };
}

// ------------------------------------------------------------------
// API principal
// ------------------------------------------------------------------
async function imprimir(buffer, config = {}) {
  const modo = config.modo || 'auto';
  if (modo === 'html') return { ok: false, via: 'html', error: 'Configurado para imprimir por HTML' };

  if (config.impresora) {
    const r = await enviarRaw(config.impresora, buffer);
    if (r.ok) return r;
    if (modo === 'raw') return r; // el usuario la fijó: no adivinar otra
  }
  if (config.puerto_serie) {
    const r = await enviarSerial(config.puerto_serie, buffer, config.baud);
    if (r.ok) return r;
    if (modo === 'serial') return r;
  }

  if (modo === 'auto') {
    // Sin configurar: probar la que parezca ticketera, luego la predeterminada.
    const impresoras = await listarImpresoras();
    const candidatas = [
      ...impresoras.filter(i => i.probableTicketera),
      ...impresoras.filter(i => i.predeterminada && !i.probableTicketera),
    ];
    for (const imp of candidatas) {
      const r = await enviarRaw(imp.nombre, buffer);
      if (r.ok) return { ...r, detectada: true };
    }
  }
  return { ok: false, error: 'No se encontró una impresora de tickets. Se usará la impresión por HTML.' };
}

module.exports = { listarImpresoras, listarPuertosSerie, enviarRaw, enviarSerial, imprimir };
