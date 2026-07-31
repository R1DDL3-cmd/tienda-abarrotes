import React, { useState, useEffect, useRef } from 'react'
import { auth, backup, settings as settingsApi, hardware } from '../api'
import { imprimirTextoHtml } from '../ticketPrint'
import { formatDate, formatDateTime } from '../dateUtils'
import { getTheme, setTheme, applyPalette, clearPalette, getSkin, setSkin, SKINS } from '../theme'
// La pantalla de Atajos ya no usa el puente shortcuts.js: se genera del
// registro de acciones, que es la única fuente de verdad de las teclas.
import { allActions, keysFor, setKeys, resetKeys, exportKeymap, importKeymap, STATES } from '../keyboard/registry.js'
import { eventToKeyString, keyLabel, keyWarning } from '../keyboard/keys.js'
import { useKeyboardLayer } from '../keyboard/input.js'
import HelpBar from './HelpBar'
import KeyHelpSheet from './KeyHelpSheet'
import { modalKeys } from '../modalKeys'
import { confirmDialog } from '../confirmDialog'
import { getManualOffsetHours, setManualOffsetHours } from '../dateUtils'

function formatMoney(n) {
  return '$' + parseFloat(n || 0).toFixed(2)
}

export default function Settings({ user }) {
  const [tab, setTab] = useState('users')
  const [userList, setUserList] = useState([])
  const [userForm, setUserForm] = useState({ username: '', password: '', name: '', role: 'cashier' })
  const [editingUser, setEditingUser] = useState(null)
  const [showUserForm, setShowUserForm] = useState(false)
  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [showPwdModal, setShowPwdModal] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [backupList, setBackupList] = useState([])
  const [backupDir, setBackupDir] = useState('')
  const [restoreConfirm, setRestoreConfirm] = useState(null)
  const [securityPinForm, setSecurityPinForm] = useState('')
  const [backupPath, setBackupPath] = useState('')
  const importFileRef = useRef(null)
  const [storeForm, setStoreForm] = useState({ store_name: '', store_address: '', store_phone: '', ticket_footer: '', store_logo: '' })
  const logoInputRef = useRef(null)
  const [theme, setThemeState] = useState(getTheme())
  const [skin, setSkinState] = useState(getSkin())
  const [capturingShortcut, setCapturingShortcut] = useState(null)
  const [versionTeclas, setVersionTeclas] = useState(0)   // fuerza el repintado tras cambiar teclas
  const [filtroTeclas, setFiltroTeclas] = useState('')
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
  const importKeysRef = useRef(null)
  const [manualOffsetInput, setManualOffsetInput] = useState(String(getManualOffsetHours()))
  const [previewClock, setPreviewClock] = useState(new Date())

  const handleThemeChange = (value) => {
    setTheme(value)
    setThemeState(value)
  }

  // --- Impresora de tickets ---
  const [printer, setPrinter] = useState({ printer_columns: '32', printer_mode: 'html', printer_name: '', printer_port: '', printer_codepage: '2', printer_translit: '0' })
  const [printers, setPrinters] = useState({ impresoras: [], puertos: [] })
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (tab === 'printer') {
      settingsApi.getPrinter().then(setPrinter).catch(() => {})
      hardware.printers().then(setPrinters).catch(() => setPrinters({ impresoras: [], puertos: [] }))
    }
  }, [tab])

  const handleSavePrinter = async () => {
    try {
      await settingsApi.updatePrinter(printer)
      setSuccess('Configuración de impresora guardada')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  // Imprime la hoja de prueba: reglas de 32/48/64 columnas y una línea con
  // acentos. Con eso se decide el ancho sin conocer el modelo de impresora.
  const handleTestPrint = async () => {
    setTesting(true); setTestResult(null); setError('')
    try {
      const r = await hardware.testPrint({
        modo: printer.printer_mode,
        impresora: printer.printer_name,
        puerto_serie: printer.printer_port,
        codepage: parseInt(printer.printer_codepage, 10),
        translit: printer.printer_translit === '1',
      })
      setTestResult(r)
      // Respaldo HTML: si no hay impresora ESC/POS, se manda por el camino
      // de siempre para que igual salga la hoja de prueba.
      if (r.via === 'html' && r.texto) imprimirTextoHtml(r.texto, 'Prueba de impresión')
    } catch (e) { setError(e.message) }
    setTesting(false)
  }

  const [palette, setPaletteState] = useState({ primary: '', success: '', danger: '', warning: '', header_bg: '', header_text: '', accent: '' })

  useEffect(() => {
    if (tab === 'appearance') {
      settingsApi.getPalette().then(p => setPaletteState({
        primary: p.palette_primary || '',
        success: p.palette_success || '',
        danger: p.palette_danger || '',
        warning: p.palette_warning || '',
        header_bg: p.palette_header_bg || '',
        header_text: p.palette_header_text || '',
        accent: p.palette_accent || ''
      })).catch(() => {})
    }
  }, [tab])

  // Temas predefinidos: aplican varios colores de un jalón. El usuario puede
  // partir de uno y luego afinar cada color a mano.
  const PRESETS = [
    { name: 'Azul (por defecto)', colors: { primary: '#2563eb', success: '#16a34a', danger: '#dc2626', warning: '#f59e0b', header_bg: '#1e293b', header_text: '#ffffff', accent: '#f0f7ff' } },
    { name: 'Verde', colors: { primary: '#059669', success: '#16a34a', danger: '#dc2626', warning: '#f59e0b', header_bg: '#064e3b', header_text: '#ffffff', accent: '#ecfdf5' } },
    { name: 'Rojo', colors: { primary: '#dc2626', success: '#16a34a', danger: '#b91c1c', warning: '#f59e0b', header_bg: '#7f1d1d', header_text: '#ffffff', accent: '#fef2f2' } },
    { name: 'Morado', colors: { primary: '#7c3aed', success: '#16a34a', danger: '#dc2626', warning: '#f59e0b', header_bg: '#4c1d95', header_text: '#ffffff', accent: '#f5f3ff' } },
    { name: 'Naranja', colors: { primary: '#ea580c', success: '#16a34a', danger: '#dc2626', warning: '#f59e0b', header_bg: '#7c2d12', header_text: '#ffffff', accent: '#fff7ed' } },
    { name: 'Oscuro elegante', colors: { primary: '#3b82f6', success: '#22c55e', danger: '#ef4444', warning: '#f59e0b', header_bg: '#000000', header_text: '#f1f5f9', accent: '#eff6ff' } },
  ]

  const applyPreset = (preset) => {
    setPaletteState(preset.colors)
    applyPalette(preset.colors)
  }

  const cssVar = (name) => (typeof window !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '') || '#000000'

  const handlePaletteChange = (key, value) => {
    const next = { ...palette, [key]: value }
    setPaletteState(next)
    applyPalette(next)
  }

  const handleSavePalette = async () => {
    try {
      await settingsApi.updatePalette({
        palette_primary: palette.primary,
        palette_success: palette.success,
        palette_danger: palette.danger,
        palette_warning: palette.warning,
        palette_header_bg: palette.header_bg,
        palette_header_text: palette.header_text,
        palette_accent: palette.accent
      })
      setSuccess('Colores de marca guardados')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const handleResetPalette = async () => {
    const empty = { primary: '', success: '', danger: '', warning: '', header_bg: '', header_text: '', accent: '' }
    setPaletteState(empty)
    clearPalette()
    try {
      await settingsApi.updatePalette({ palette_primary: '', palette_success: '', palette_danger: '', palette_warning: '', palette_header_bg: '', palette_header_text: '', palette_accent: '' })
      setSuccess('Colores restablecidos')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  // Captura la siguiente tecla presionada para remapear una acción del
  // registro. Acepta CUALQUIER tecla (letras, números, Enter, Supr, Inicio,
  // flechas, F1-F12, o combinaciones con Ctrl/Alt). Escape cancela.
  useEffect(() => {
    if (!capturingShortcut) return
    const onKeyDown = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setCapturingShortcut(null); return }
      const key = eventToKeyString(e)
      if (!key) return // tecla modificadora sola: seguir esperando
      setKeys(capturingShortcut, [key])
      setVersionTeclas(v => v + 1)
      setCapturingShortcut(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturingShortcut])

  const handleResetShortcuts = () => {
    resetKeys()
    setVersionTeclas(v => v + 1)
  }

  // Perfil de teclas exportable: el dueño configura una caja y lleva el mismo
  // teclado a las demás sin volver a tocarlo.
  const exportarTeclas = () => {
    const blob = new Blob([exportKeymap()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `teclas_${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importarTeclas = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        importKeymap(String(reader.result))
        setVersionTeclas(v => v + 1)
        setSuccess('Teclas importadas')
      } catch (err) { setError('Archivo de teclas inválido: ' + err.message) }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Acciones agrupadas para la pantalla, filtrables por nombre.
  const accionesPorGrupo = React.useMemo(() => {
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const q = norm(filtroTeclas)
    return allActions()
      .filter(a => !q || norm(a.nombre).includes(q) || norm(a.descripcion).includes(q) || norm(a.group).includes(q))
      .reduce((acc, a) => {
        const g = a.group || 'Otros'
        acc[g] = acc[g] || []
        acc[g].push(a)
        return acc
      }, {})
  }, [filtroTeclas, versionTeclas])

  useEffect(() => {
    const id = setInterval(() => setPreviewClock(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const handleSaveManualOffset = () => {
    const hours = parseFloat(manualOffsetInput) || 0
    setManualOffsetHours(hours)
    setSuccess('Ajuste de hora guardado')
    setTimeout(() => setSuccess(''), 3000)
  }

  const loadUsers = async () => {
    try { const res = await auth.listUsers(); setUserList(res.users) }
    catch (e) { setError(e.message) }
  }

  useEffect(() => { loadUsers() }, [])

  const openNewUser = () => {
    setEditingUser(null)
    setUserForm({ username: '', password: '', name: '', role: 'cashier' })
    setShowUserForm(true)
    setError('')
  }

  const openEditUser = (u) => {
    setEditingUser(u)
    setUserForm({ username: u.username, password: '', name: u.name, role: u.role })
    setShowUserForm(true)
    setError('')
  }

  const handleSaveUser = async () => {
    if (!userForm.username || !userForm.name) { setError('Usuario y nombre requeridos'); return }
    if (!editingUser && !userForm.password) { setError('Contraseña requerida'); return }
    try {
      if (editingUser) {
        const data = { username: userForm.username, name: userForm.name, role: userForm.role }
        if (userForm.password) data.password = userForm.password
        await auth.updateUser(editingUser.id, data)
      } else {
        await auth.createUser(userForm)
      }
      setShowUserForm(false)
      setSuccess(editingUser ? 'Usuario actualizado' : 'Usuario creado')
      setTimeout(() => setSuccess(''), 3000)
      loadUsers()
    } catch (e) { setError(e.message) }
  }

  const handleDeleteUser = async (id) => {
    if (!(await confirmDialog('Eliminar este usuario?'))) return
    try { await auth.deleteUser(id); loadUsers(); setSuccess('Usuario eliminado'); setTimeout(() => setSuccess(''), 3000) }
    catch (e) { setError(e.message) }
  }

  const handleChangePassword = async () => {
    if (!pwdForm.currentPassword || !pwdForm.newPassword) { setError('Todos los campos requeridos'); return }
    if (pwdForm.newPassword !== pwdForm.confirmPassword) { setError('Las contraseñas nuevas no coinciden'); return }
    if (pwdForm.newPassword.length < 4) { setError('La contraseña debe tener al menos 4 caracteres'); return }
    try {
      await auth.changePassword(pwdForm.currentPassword, pwdForm.newPassword)
      setShowPwdModal(false)
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setSuccess('Contraseña cambiada exitosamente')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const loadBackups = async () => {
    try { const res = await backup.list(); setBackupList(res.backups); setBackupDir(res.dir) } catch (e) { setError(e.message) }
  }

  useEffect(() => { if (tab === 'backups') { loadBackups(); setBackupPath(localStorage.getItem('backupPath') || '') } }, [tab])

  useEffect(() => {
    if (tab === 'security') {
      setSecurityPinForm(localStorage.getItem('securityPin') || '1234')
    }
  }, [tab])

  useEffect(() => {
    if (tab === 'store') {
      settingsApi.getStore().then(setStoreForm).catch(e => setError(e.message))
    }
  }, [tab])

  const handleSaveStore = async () => {
    try {
      await settingsApi.updateStore(storeForm)
      window.dispatchEvent(new CustomEvent('store-updated', { detail: storeForm }))
      setSuccess('Datos de la tienda actualizados')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  // Redimensiona/recomprime la imagen en un <canvas> antes de convertirla a
  // base64: cada guardado de la app reescribe el archivo completo de la base
  // de datos (server/db.js, debouncedSave), así que un logo sin comprimir de
  // varios MB volvería más lento *cada* guardado de la app, no solo el del
  // logo. 300px de lado es de sobra para el tamaño en el que se muestra.
  const handleLogoFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('El archivo debe ser una imagen'); e.target.value = ''; return }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const maxSize = 300
        let { width, height } = img
        if (width > height) {
          if (width > maxSize) { height = Math.round(height * (maxSize / width)); width = maxSize }
        } else if (height > maxSize) {
          width = Math.round(width * (maxSize / height)); height = maxSize
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        setStoreForm(f => ({ ...f, store_logo: canvas.toDataURL('image/png') }))
      }
      img.onerror = () => setError('No se pudo leer la imagen')
      img.src = reader.result
    }
    reader.onerror = () => setError('Error al leer el archivo')
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleRemoveLogo = () => setStoreForm(f => ({ ...f, store_logo: '' }))

  const handleSaveSecurityPin = () => {
    if (!securityPinForm || securityPinForm.length < 4) { setError('El codigo debe tener al menos 4 caracteres'); return }
    localStorage.setItem('securityPin', securityPinForm)
    setSuccess('Codigo de seguridad actualizado')
    setTimeout(() => setSuccess(''), 3000)
  }

  const handleBackupNow = async () => {
    const dest = backupPath.trim() || undefined
    try { await backup.now(dest); loadBackups(); setSuccess('Respaldo creado'); setTimeout(() => setSuccess(''), 3000) }
    catch (e) { setError(e.message) }
  }

  const handleRestore = async (filename) => {
    setRestoreConfirm({ filename, message: `¿Restaurar respaldo "${filename}"? Se perderán los cambios no guardados y la aplicación se reiniciará.` })
  }

  const handleRestoreConfirm = async () => {
    if (!restoreConfirm) return
    const { filename } = restoreConfirm
    setRestoreConfirm(null)
    try {
      await backup.restore(filename)
      setSuccess('Respaldo restaurado. Reiniciando...')
      setTimeout(() => {
        if (window.electronAPI?.restartApp) { window.electronAPI.restartApp() }
        else { window.location.reload(true) }
      }, 1500)
    } catch (e) { setError(e.message) }
  }

  const handleExportDB = async () => {
    try { await backup.exportDB(); setSuccess('Base de datos exportada'); setTimeout(() => setSuccess(''), 3000) }
    catch (e) { setError(e.message) }
  }

  const handleSaveBackupPath = () => {
    localStorage.setItem('backupPath', backupPath.trim())
    setSuccess('Ruta de respaldo guardada')
    setTimeout(() => setSuccess(''), 3000)
  }

  const handleImportDB = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.db')) { setError('Solo archivos .db'); return }
    if (!(await confirmDialog(`¿Importar "${file.name}"? Se reemplazará la base de datos actual y la aplicación se reiniciará.`))) return
    try {
      await backup.importDB(file)
      setSuccess('Base de datos importada. Reiniciando...')
      setTimeout(() => {
        if (window.electronAPI?.restartApp) { window.electronAPI.restartApp() }
        else { window.location.reload(true) }
      }, 1500)
    } catch (e) { setError(e.message) }
    e.target.value = ''
  }

  const tabs = [
    { id: 'store', label: 'Tienda' },
    { id: 'appearance', label: 'Apariencia' },
    { id: 'shortcuts', label: 'Atajos' },
    { id: 'time', label: 'Hora' },
    { id: 'users', label: 'Usuarios' },
    { id: 'password', label: 'Contraseña' },
    { id: 'printer', label: 'Impresora' },
    { id: 'security', label: 'Seguridad' },
    { id: 'backups', label: 'Respaldos' },
  ]

  // ============================================================
  // CAPA DE TECLADO — ← → cambian de pestaña, F4 guarda la que esté abierta
  // ============================================================

  const guardarPestanaActual = () => {
    if (tab === 'store') handleSaveStore()
    else if (tab === 'appearance') handleSavePalette()
    else if (tab === 'printer') handleSavePrinter()
    else if (tab === 'security') handleSaveSecurityPin()
    else if (tab === 'password') handleChangePassword()
    else if (tab === 'backups') handleSaveBackupPath()
    else if (tab === 'time') handleSaveManualOffset()
    else setError('Esta pestaña no tiene nada que guardar')
  }

  useKeyboardLayer({
    // Mientras se captura una tecla nueva, la capa se apaga: si no, la tecla
    // que el usuario está asignando ejecutaría su acción al pulsarla.
    enabled: !capturingShortcut,
    state: showKeyboardHelp ? STATES.MODAL : STATES.CONFIGURACION,
    role: user?.role,
    handlers: {
      sys_help: () => setShowKeyboardHelp(true),
      cfg_save: () => guardarPestanaActual(),
      // Funcional: dos flechas seguidas deben avanzar dos pestañas (ver
      // keyboard/useActiveIndex.js para el mismo problema en las listas).
      con_tab_prev: () => setTab(actual => tabs[Math.max(0, tabs.findIndex(t => t.id === actual) - 1)].id),
      con_tab_next: () => setTab(actual => tabs[Math.min(tabs.length - 1, tabs.findIndex(t => t.id === actual) + 1)].id),
      cfg_export_keys: () => exportarTeclas(),
      cfg_import_keys: () => importKeysRef.current?.click(),
      cfg_reset_keys: () => handleResetShortcuts(),
    },
  })

  return (
    <div className="accounting-page">
      <div className="page-header">
        <h2>Configuración</h2>
        <div className="header-actions">
          <button className="btn btn-sm btn-primary" onClick={guardarPestanaActual}>Guardar <kbd>F4</kbd></button>
        </div>
      </div>

      {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}
      {success && <div className="alert alert-success" onClick={() => setSuccess('')}>{success}</div>}

      <div className="tabs">
        {tabs.map(t => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'store' && (
        <div className="card" style={{maxWidth:'450px', padding:'1.5rem'}}>
          <h3 style={{marginTop:0}}>Datos de la Tienda</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
            Esta información aparece en los tickets impresos.
          </p>
          <div className="form-group">
            <label>Nombre de la tienda</label>
            <input type="text" value={storeForm.store_name} onChange={e => setStoreForm({...storeForm, store_name: e.target.value})} autoFocus />
          </div>
          <div className="form-group">
            <label>Dirección</label>
            <input type="text" value={storeForm.store_address} onChange={e => setStoreForm({...storeForm, store_address: e.target.value})} placeholder="Opcional" />
          </div>
          <div className="form-group">
            <label>Teléfono</label>
            <input type="text" value={storeForm.store_phone} onChange={e => setStoreForm({...storeForm, store_phone: e.target.value})} placeholder="Opcional" />
          </div>
          <div className="form-group">
            <label>Mensaje al pie del ticket</label>
            <input type="text" value={storeForm.ticket_footer} onChange={e => setStoreForm({...storeForm, ticket_footer: e.target.value})} />
          </div>
          <div className="form-group">
            <label>Logo de la tienda</label>
            <p style={{fontSize:'0.8rem', color:'var(--text-muted)', margin:'0 0 0.5rem 0'}}>
              Aparece de fondo (pálido) en el sistema y en los tickets impresos.
            </p>
            <div style={{display:'flex', alignItems:'center', gap:'0.75rem'}}>
              {storeForm.store_logo && (
                <img src={storeForm.store_logo} alt="Logo" style={{width:'56px', height:'56px', objectFit:'contain', background:'var(--bg)', borderRadius:'var(--radius-sm)', border:'1px solid var(--border)'}} />
              )}
              <button type="button" className="btn btn-sm btn-outline" onClick={() => logoInputRef.current?.click()}>
                {storeForm.store_logo ? 'Cambiar Logo' : 'Subir Logo'}
              </button>
              {storeForm.store_logo && (
                <button type="button" className="btn btn-sm btn-outline" onClick={handleRemoveLogo}>Quitar</button>
              )}
              <input ref={logoInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleLogoFile} />
            </div>
          </div>
          <div className="modal-actions" style={{padding:0, marginTop:'1rem'}}>
            <button className="btn btn-primary" onClick={handleSaveStore}>Guardar</button>
          </div>
        </div>
      )}

      {tab === 'appearance' && (
        <div className="card" style={{maxWidth:'450px', padding:'1.5rem'}}>
          <h3 style={{marginTop:0}}>Estética</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
            La vista clásica está pensada para trabajar horas seguidas: más densa,
            cuadrada y sin adornos, con más renglones visibles por pantalla. La
            moderna es la de siempre. Se guarda en este dispositivo y también se
            puede cambiar desde la barra superior.
          </p>
          <div style={{display:'flex', gap:'0.75rem', marginBottom:'1.5rem'}}>
            <button
              className={`btn ${skin === SKINS.MODERNO ? 'btn-primary' : 'btn-outline'}`}
              style={{flex:1}}
              onClick={() => setSkinState(setSkin(SKINS.MODERNO))}
            >
              ◱ Moderno
            </button>
            <button
              className={`btn ${skin === SKINS.ENTERPRISE ? 'btn-primary' : 'btn-outline'}`}
              style={{flex:1}}
              onClick={() => setSkinState(setSkin(SKINS.ENTERPRISE))}
            >
              ▤ Clásico
            </button>
          </div>

          <h3>Tema</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
            Claro u oscuro. Funciona con cualquiera de las dos estéticas.
          </p>
          <div style={{display:'flex', gap:'0.75rem'}}>
            <button
              className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-outline'}`}
              style={{flex:1}}
              onClick={() => handleThemeChange('light')}
            >
              ☀️ Claro
            </button>
            <button
              className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-outline'}`}
              style={{flex:1}}
              onClick={() => handleThemeChange('dark')}
            >
              🌙 Oscuro
            </button>
          </div>

          <h3 style={{marginTop:'1.5rem'}}>Colores de Marca</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'0.75rem'}}>
            Se aplican en toda la app (barra de navegación, botones, alertas) para todos los usuarios. Elige un tema listo o afina cada color.
          </p>
          {skin === SKINS.ENTERPRISE && (
            <div className="alert alert-warning" style={{cursor:'default'}}>
              La vista clásica usa a propósito una paleta neutra: el color solo aparece
              cuando significa algo (azul acción, verde éxito, naranja aviso, rojo error).
              Estos colores se guardan, pero se verán al volver a la vista moderna.
            </div>
          )}

          <label style={{fontWeight:600, fontSize:'0.9rem'}}>Temas listos</label>
          <div style={{display:'flex', flexWrap:'wrap', gap:'0.5rem', margin:'0.4rem 0 1.2rem'}}>
            {PRESETS.map(preset => (
              <button key={preset.name} className="btn btn-sm btn-outline" onClick={() => applyPreset(preset)}
                style={{display:'flex', alignItems:'center', gap:'0.4rem'}}>
                <span style={{width:14, height:14, borderRadius:'50%', background:preset.colors.header_bg, border:'1px solid var(--border)'}}></span>
                <span style={{width:14, height:14, borderRadius:'50%', background:preset.colors.primary, border:'1px solid var(--border)'}}></span>
                {preset.name}
              </button>
            ))}
          </div>

          <label style={{fontWeight:600, fontSize:'0.9rem'}}>Barra de navegación (arriba)</label>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', margin:'0.4rem 0 1rem'}}>
            <div className="form-group">
              <label>Fondo de la barra</label>
              <input type="color" className="input" value={palette.header_bg || cssVar('--header-bg')} onChange={e => handlePaletteChange('header_bg', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Texto de la barra</label>
              <input type="color" className="input" value={palette.header_text || cssVar('--header-text')} onChange={e => handlePaletteChange('header_text', e.target.value)} />
            </div>
          </div>

          <label style={{fontWeight:600, fontSize:'0.9rem'}}>Colores de acción</label>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginTop:'0.4rem'}}>
            <div className="form-group">
              <label>Primario (botones)</label>
              <input type="color" className="input" value={palette.primary || cssVar('--primary')} onChange={e => handlePaletteChange('primary', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Éxito (verde)</label>
              <input type="color" className="input" value={palette.success || cssVar('--success')} onChange={e => handlePaletteChange('success', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Peligro (rojo)</label>
              <input type="color" className="input" value={palette.danger || cssVar('--danger')} onChange={e => handlePaletteChange('danger', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Advertencia (amarillo)</label>
              <input type="color" className="input" value={palette.warning || cssVar('--warning')} onChange={e => handlePaletteChange('warning', e.target.value)} />
            </div>
          </div>
          <div className="modal-actions" style={{padding:0, marginTop:'1rem', justifyContent:'flex-start'}}>
            <button className="btn btn-primary" onClick={handleSavePalette}>Guardar Colores</button>
            <button className="btn btn-secondary" onClick={handleResetPalette}>Restablecer</button>
          </div>
        </div>
      )}

      {tab === 'time' && (
        <div className="card" style={{maxWidth:'450px', padding:'1.5rem'}}>
          <h3 style={{marginTop:0}}>Ajuste de Hora</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
            La hora se corrige automáticamente, pero si aún así se ve mal, ajústala aquí (en horas; usa decimales para minutos, ej. 0.5 = media hora). Se guarda en este dispositivo.
          </p>
          <div className="form-group">
            <label>Hora actual con este ajuste:</label>
            <p style={{fontSize:'1.3rem', fontWeight:'bold', margin:'0.25rem 0 1rem 0'}}>
              {new Date(previewClock.getTime() + (parseFloat(manualOffsetInput) || 0) * 60 * 60 * 1000)
                .toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
          <div className="form-group" style={{display:'flex', gap:'0.5rem', alignItems:'flex-end'}}>
            <div style={{flex:1}}>
              <label>Ajuste manual (horas)</label>
              <input type="number" step="0.5" className="input" value={manualOffsetInput} onChange={e => setManualOffsetInput(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={handleSaveManualOffset}>Guardar</button>
          </div>
          {parseFloat(manualOffsetInput) !== 0 && (
            <p style={{fontSize:'0.8rem', color:'var(--text-muted)', marginTop:'0.5rem'}}>
              Con {parseFloat(manualOffsetInput) > 0 ? '+' : ''}{parseFloat(manualOffsetInput)}h, la hora mostrada se mueve {parseFloat(manualOffsetInput) > 0 ? 'hacia adelante' : 'hacia atrás'}.
            </p>
          )}
        </div>
      )}

      {tab === 'shortcuts' && (
        <div className="card" style={{maxWidth:'760px', padding:'1.5rem'}}>
          <h3 style={{marginTop:0}}>Teclas del sistema</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
            Esta pantalla se genera sola del registro de acciones: cada función del sistema
            aparece aquí con su tecla real, agrupada por sección. Pulsa "Cambiar" y luego la
            tecla que quieras (cualquiera: letra, número, Enter, Supr, F1-F12, o Ctrl/Alt +
            una tecla). Esc cancela.
          </p>
          <p style={{fontSize:'0.8rem', color:'var(--warning-dark)', marginBottom:'1rem'}}>
            Evita letras y números sueltos para el punto de venta: podrían dispararse al
            escanear un código de barras.
          </p>

          <div className="filters" style={{marginBottom:'0.75rem'}}>
            <input type="text" className="input" placeholder="Filtrar por nombre de función..."
              value={filtroTeclas} onChange={e => setFiltroTeclas(e.target.value)} />
            <button className="btn btn-sm btn-outline" onClick={exportarTeclas}>Exportar JSON</button>
            <button className="btn btn-sm btn-outline" onClick={() => importKeysRef.current?.click()}>Importar JSON</button>
            <input ref={importKeysRef} type="file" accept=".json" style={{display:'none'}} onChange={importarTeclas} />
            <button className="btn btn-sm btn-secondary" onClick={handleResetShortcuts}>Restablecer todo</button>
          </div>

          {Object.entries(accionesPorGrupo).map(([grupo, acciones]) => (
            <div key={grupo} style={{marginBottom:'1rem'}}>
              <h4 style={{margin:'0 0 0.25rem'}}>{grupo}</h4>
              <table className="table">
                <thead><tr><th>Función</th><th style={{width:170}}>Tecla</th><th style={{width:110}}></th></tr></thead>
                <tbody>
                  {acciones.map(a => {
                    const teclas = keysFor(a.id)
                    const aviso = teclas.map(k => keyWarning(k)).find(Boolean)
                    return (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.nombre}</strong>
                          <div className="text-muted" style={{fontSize:'0.78rem'}}>{a.descripcion}</div>
                          {aviso && (
                            <div style={{fontSize:'0.75rem', color: aviso.level === 'error' ? 'var(--danger)' : 'var(--warning-dark)'}}>
                              {aviso.level === 'error' ? '⛔' : '⚠'} {aviso.text}
                            </div>
                          )}
                        </td>
                        <td>
                          {capturingShortcut === a.id
                            ? <strong>Presiona una tecla…</strong>
                            : teclas.length
                              ? teclas.map(k => <kbd key={k} style={{marginRight:'0.25rem'}}>{keyLabel(k)}</kbd>)
                              : <span className="text-muted">sin tecla</span>}
                        </td>
                        <td>
                          <button className="btn btn-sm btn-outline" onClick={() => setCapturingShortcut(a.id)} disabled={capturingShortcut === a.id}>
                            Cambiar
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div>
          <div className="section-header" style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem'}}>
            <h3 style={{margin:0}}>Usuarios del Sistema</h3>
            <button className="btn btn-primary" onClick={openNewUser}>+ Nuevo Usuario</button>
          </div>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>Creado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {userList.map(u => (
                  <tr key={u.id}>
                    <td><strong>{u.username}</strong></td>
                    <td>{u.name}</td>
                    <td>{u.role === 'admin' ? 'Administrador' : u.role === 'inventory' ? 'Inventario' : 'Cajero'}</td>
                    <td style={{fontSize:'0.8rem'}}>{formatDate(u.created_at)}</td>
                    <td className="actions-cell">
                      {user?.role === 'admin' && <>
                      <button className="btn btn-sm btn-outline" onClick={() => openEditUser(u)}>Editar</button>
                      {u.id !== user?.id && (
                        <button className="btn btn-sm btn-danger" onClick={() => handleDeleteUser(u.id)}>X</button>
                      )}
                      </>}
                    </td>
                  </tr>
                ))}
                {userList.length === 0 && <tr><td colSpan="5" className="text-center">Sin usuarios</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'password' && (
        <div className="card" style={{maxWidth:'400px', padding:'1.5rem'}}>
          <h3 style={{marginTop:0}}>Cambiar Contraseña</h3>
          <div className="form-group">
            <label>Contraseña Actual</label>
            <input type="password" value={pwdForm.currentPassword} onChange={e => setPwdForm({...pwdForm, currentPassword: e.target.value})} autoFocus />
          </div>
          <div className="form-group">
            <label>Nueva Contraseña</label>
            <input type="password" value={pwdForm.newPassword} onChange={e => setPwdForm({...pwdForm, newPassword: e.target.value})} />
          </div>
          <div className="form-group">
            <label>Confirmar Nueva Contraseña</label>
            <input type="password" value={pwdForm.confirmPassword} onChange={e => setPwdForm({...pwdForm, confirmPassword: e.target.value})} />
          </div>
          <div className="modal-actions" style={{padding:0, marginTop:'1rem'}}>
            <button className="btn btn-primary" onClick={handleChangePassword}>Cambiar Contraseña</button>
          </div>
        </div>
      )}

      {tab === 'printer' && (
        <div className="card" style={{maxWidth:'620px', padding:'1.5rem'}}>
          <h3 style={{marginTop:0}}>Impresora de Tickets</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
            Si no sabes de cuántos milímetros es tu impresora, no importa: presiona <b>Imprimir hoja de prueba</b>,
            mira cuál de las tres reglas sale en <b>una sola línea</b> (sin doblarse), y elige ese ancho aquí.
          </p>

          <div className="form-group">
            <label>Ancho del papel</label>
            <select className="input" value={printer.printer_columns}
              onChange={e => setPrinter({...printer, printer_columns: e.target.value})}>
              <option value="32">32 columnas — papel de 58 mm (lo más común)</option>
              <option value="48">48 columnas — papel de 80 mm</option>
              <option value="64">64 columnas — papel de 80 mm, letra condensada</option>
            </select>
          </div>

          <div className="form-group">
            <label>Cómo imprimir</label>
            <select className="input" value={printer.printer_mode}
              onChange={e => setPrinter({...printer, printer_mode: e.target.value})}>
              <option value="html">Por Windows (como hasta ahora) — siempre funciona</option>
              <option value="auto">Automático — busca la impresora de tickets sola</option>
              <option value="raw">Impresora USB específica (más rápido)</option>
              <option value="serial">Puerto COM (impresoras viejas)</option>
            </select>
          </div>

          {(printer.printer_mode === 'raw' || printer.printer_mode === 'auto') && (
            <div className="form-group">
              <label>Impresora</label>
              <select className="input" value={printer.printer_name}
                onChange={e => setPrinter({...printer, printer_name: e.target.value})}>
                <option value="">
                  {printer.printer_mode === 'auto' ? 'Que la busque sola' : 'Elige una...'}
                </option>
                {(printers.impresoras || []).map(i => (
                  <option key={i.nombre} value={i.nombre}>
                    {i.nombre}{i.probableTicketera ? '  (parece ticketera)' : ''}{i.predeterminada ? '  ★' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {printer.printer_mode === 'serial' && (
            <div className="form-group">
              <label>Puerto COM</label>
              <select className="input" value={printer.printer_port}
                onChange={e => setPrinter({...printer, printer_port: e.target.value})}>
                <option value="">Elige uno...</option>
                {(printers.puertos || []).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}

          <details style={{marginBottom:'1rem'}}>
            <summary style={{cursor:'pointer', fontSize:'0.9rem', fontWeight:600}}>Acentos y caracteres especiales</summary>
            <p style={{fontSize:'0.85rem', color:'var(--text-muted)', margin:'0.5rem 0'}}>
              Si en la hoja de prueba las letras con acento (á é í ó ú ñ) salen como símbolos raros, cambia estas opciones.
            </p>
            <div className="form-group">
              <label>Juego de caracteres</label>
              <select className="input" value={printer.printer_codepage}
                onChange={e => setPrinter({...printer, printer_codepage: e.target.value})}>
                <option value="2">CP850 — Latino (lo normal)</option>
                <option value="19">CP858</option>
                <option value="16">Windows-1252</option>
                <option value="0">CP437</option>
              </select>
            </div>
            <label style={{display:'flex', alignItems:'center', gap:'0.5rem', fontWeight:'normal'}}>
              <input type="checkbox" checked={printer.printer_translit === '1'}
                onChange={e => setPrinter({...printer, printer_translit: e.target.checked ? '1' : '0'})} />
              Quitar los acentos al imprimir (usa esto si nada más funciona)
            </label>
          </details>

          {testResult && (
            <div className={`alert ${testResult.ok ? 'alert-success' : 'alert-warning'}`} style={{marginBottom:'1rem'}}>
              {testResult.ok
                ? (testResult.via === 'html'
                    ? 'Se envió por Windows. Revisa la ventana de impresión que se abrió.'
                    : `Impreso directo en ${testResult.impresora || testResult.puerto}${testResult.detectada ? ' (detectada automáticamente)' : ''}.`)
                : `No se pudo imprimir directo: ${testResult.error}. Se puede seguir usando la impresión por Windows.`}
            </div>
          )}

          <div className="modal-actions" style={{padding:0, justifyContent:'flex-start'}}>
            <button className="btn btn-primary" onClick={handleSavePrinter}>Guardar</button>
            <button className="btn btn-outline" onClick={handleTestPrint} disabled={testing}>
              {testing ? 'Imprimiendo...' : 'Imprimir hoja de prueba'}
            </button>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="card" style={{maxWidth:'400px', padding:'1.5rem'}}>
          <h3 style={{marginTop:0}}>Codigo de Seguridad</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
            Este codigo se solicita al escanear un producto no registrado en el inventario.
          </p>
          <div className="form-group">
            <label>Codigo de Seguridad (min. 4 caracteres)</label>
            <input type="password" className="input-lg" value={securityPinForm} onChange={e => setSecurityPinForm(e.target.value)} autoFocus />
          </div>
          <div className="modal-actions" style={{padding:0, marginTop:'1rem'}}>
            <button className="btn btn-primary" onClick={handleSaveSecurityPin}>Guardar Codigo</button>
          </div>
        </div>
      )}

      {tab === 'backups' && (
        <div>
          <div className="section-header">
            <h3>Respaldos de Base de Datos</h3>
            <div style={{display:'flex', gap:'0.5rem'}}>
              <button className="btn btn-primary" onClick={handleBackupNow}>Respaldar Ahora</button>
              <button className="btn btn-outline" onClick={handleExportDB}>Extraer DB</button>
              <button className="btn btn-outline" onClick={() => importFileRef.current?.click()}>Importar DB</button>
              <input ref={importFileRef} type="file" accept=".db" style={{display:'none'}} onChange={handleImportDB} />
            </div>
          </div>
          <div className="card" style={{padding:'1rem', marginBottom:'1rem'}}>
            <label style={{display:'block', marginBottom:'0.4rem', fontSize:'0.85rem', fontWeight:600}}>Ruta de respaldo</label>
            <div style={{display:'flex', gap:'0.5rem'}}>
              <input type="text" className="input" style={{flex:1}} value={backupPath} onChange={e => setBackupPath(e.target.value)} placeholder={backupDir || 'Ruta por defecto del servidor'} />
              <button className="btn btn-primary" onClick={handleSaveBackupPath}>Guardar</button>
            </div>
            <p className="text-muted" style={{marginTop:'0.4rem', fontSize:'0.8rem'}}>Ruta actual del servidor: <code>{backupDir}</code></p>
          </div>
          <div className="table-responsive">
            <table className="table">
              <thead><tr><th>Archivo</th><th>Fecha</th><th>Tamaño</th><th></th></tr></thead>
              <tbody>
                {backupList.map(b => (
                  <tr key={b.name}>
                    <td style={{fontSize:'0.8rem'}}>{b.name}</td>
                    <td>{formatDateTime(b.date)}</td>
                    <td>{(b.size / 1024).toFixed(1)} KB</td>
                    <td><button className="btn btn-sm btn-warning" onClick={() => handleRestore(b.name)}>Restaurar</button></td>
                  </tr>
                ))}
                {backupList.length === 0 && <tr><td colSpan="4" className="text-center">Sin respaldos aún</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showUserForm && (
        <div className="modal-overlay" onClick={() => setShowUserForm(false)} onKeyDown={modalKeys(() => setShowUserForm(false), handleSaveUser)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>{editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
            <div className="form-group">
              <label>Usuario *</label>
              <input type="text" value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} autoFocus />
            </div>
            <div className="form-group">
              <label>Nombre Completo *</label>
              <input type="text" value={userForm.name} onChange={e => setUserForm({...userForm, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Contraseña {editingUser ? '(dejar vacío para no cambiar)' : '*'}</label>
              <input type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Rol</label>
              <select value={userForm.role} onChange={e => setUserForm({...userForm, role: e.target.value})}>
                <option value="cashier">Cajero</option>
                <option value="admin">Administrador</option>
                <option value="inventory">Inventario</option>
              </select>
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowUserForm(false); setError('') }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveUser}>{editingUser ? 'Actualizar' : 'Crear'}</button>
            </div>
          </div>
        </div>
      )}

      {restoreConfirm && (
        <div className="modal-overlay" onClick={() => setRestoreConfirm(null)} onKeyDown={modalKeys(() => setRestoreConfirm(null), handleRestoreConfirm)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Restaurar Respaldo</h3>
            <p>{restoreConfirm.message}</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setRestoreConfirm(null)}>No</button>
              <button className="btn btn-danger" onClick={handleRestoreConfirm}>Sí, restaurar y reiniciar</button>
            </div>
          </div>
        </div>
      )}

      {showKeyboardHelp && (
        <KeyHelpSheet state={STATES.CONFIGURACION} role={user?.role} titulo="Teclas de Configuración"
          onClose={() => setShowKeyboardHelp(false)} />
      )}

      <HelpBar state={showKeyboardHelp ? STATES.MODAL : STATES.CONFIGURACION} role={user?.role} />
    </div>
  )
}
