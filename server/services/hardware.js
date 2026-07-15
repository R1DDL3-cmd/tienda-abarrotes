const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const DRAWER_CMD = [0x1B, 0x70, 0x00, 0x19, 0xFA];

function getPS() {
  if (process.env.ELECTRON_RUN && process.platform === 'win32') {
    const sys32 = path.join(process.env.WINDIR || 'C:\\Windows', 'System32');
    const ps = path.join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(ps)) return ps;
  }
  return 'powershell.exe';
}

function listPortsPS() {
  try {
    const ps = getPS();
    const out = execSync(`"${ps}" -NoProfile -Command "[System.IO.Ports.SerialPort]::getportnames()"`, { timeout: 5000, encoding: 'utf8' });
    return out.split('\r\n').map(s => s.trim()).filter(s => /^COM\d+$/i.test(s));
  } catch (e) {
    return [];
  }
}

function openDrawerOnPortPS(portName) {
  return new Promise((resolve) => {
    const ps = getPS();
    const bytes = DRAWER_CMD.map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(',');
    const script = `
      try {
        $port = new-Object System.IO.Ports.SerialPort '${portName}',9600,None,8,One
        $port.Open()
        $port.Write([byte[]](${bytes}))
        Start-Sleep -Milliseconds 300
        $port.Close()
        Write-Output "OK"
      } catch {
        Write-Output "FAIL"
      }
    `;
    const child = exec(`"${ps}" -NoProfile -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.trim() === 'OK');
    });
    setTimeout(() => { try { child.kill() } catch(_) {}; resolve(false) }, 5000);
  });
}

async function openDrawer() {
  let ports = listPortsPS();
  for (const port of ports) {
    const ok = await openDrawerOnPortPS(port);
    if (ok) return { success: true, port };
  }
  return { success: false, error: 'No se detectó caja registradora. Conecta el cable y asegúrate de tener los drivers instalados.' };
}

module.exports = { openDrawer };