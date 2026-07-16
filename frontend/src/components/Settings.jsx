import React, { useState, useEffect, useRef } from 'react'
import { auth, backup, settings as settingsApi } from '../api'
import { formatDate, formatDateTime } from '../dateUtils'
import { getTheme, setTheme } from '../theme'
import { getShortcuts, setShortcutKey, resetShortcuts, eventToKeyString, DEFAULT_SHORTCUTS } from '../shortcuts'
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
  const [storeForm, setStoreForm] = useState({ store_name: '', store_address: '', store_phone: '', ticket_footer: '' })
  const [theme, setThemeState] = useState(getTheme())
  const [shortcuts, setShortcutsState] = useState(getShortcuts())
  const [capturingShortcut, setCapturingShortcut] = useState(null)
  const [manualOffsetInput, setManualOffsetInput] = useState(String(getManualOffsetHours()))
  const [previewClock, setPreviewClock] = useState(new Date())

  const handleThemeChange = (value) => {
    setTheme(value)
    setThemeState(value)
  }

  // Captura la siguiente tecla presionada (F1-F12, o Ctrl+letra) para
  // remapear un atajo. Se ignoran otras teclas para no guardar algo como
  // "a" que chocaría con escritura normal en cualquier input.
  useEffect(() => {
    if (!capturingShortcut) return
    const onKeyDown = (e) => {
      e.preventDefault()
      const key = eventToKeyString(e)
      if (!key) return
      setShortcutKey(capturingShortcut, key)
      setShortcutsState(getShortcuts())
      setCapturingShortcut(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [capturingShortcut])

  const handleResetShortcuts = () => {
    resetShortcuts()
    setShortcutsState(getShortcuts())
  }

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
    if (!confirm('Eliminar este usuario?')) return
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
      setSuccess('Datos de la tienda actualizados')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

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
    if (!confirm(`¿Importar "${file.name}"? Se reemplazará la base de datos actual y la aplicación se reiniciará.`)) return
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
    { id: 'security', label: 'Seguridad' },
    { id: 'backups', label: 'Respaldos' },
  ]

  return (
    <div className="accounting-page">
      <div className="page-header">
        <h2>Configuración</h2>
        <div className="header-actions">
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
          <div className="modal-actions" style={{padding:0, marginTop:'1rem'}}>
            <button className="btn btn-primary" onClick={handleSaveStore}>Guardar</button>
          </div>
        </div>
      )}

      {tab === 'appearance' && (
        <div className="card" style={{maxWidth:'450px', padding:'1.5rem'}}>
          <h3 style={{marginTop:0}}>Apariencia</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
            Elige cómo se ve la aplicación. Se guarda en este dispositivo.
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
        <div className="card" style={{maxWidth:'550px', padding:'1.5rem'}}>
          <h3 style={{marginTop:0}}>Atajos de Teclado</h3>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
            Los de navegación funcionan en cualquier pantalla. Los del punto de venta solo aplican estando ahí. Haz clic en "Cambiar" y presiona la tecla que quieras usar (F1-F12, o Ctrl + una letra).
          </p>
          <table className="table">
            <thead><tr><th>Acción</th><th>Tecla</th><th></th></tr></thead>
            <tbody>
              {Object.keys(DEFAULT_SHORTCUTS).map(id => (
                <tr key={id}>
                  <td>{shortcuts[id].label}</td>
                  <td><strong>{capturingShortcut === id ? 'Presiona una tecla...' : shortcuts[id].key}</strong></td>
                  <td>
                    <button className="btn btn-sm btn-outline" onClick={() => setCapturingShortcut(id)} disabled={capturingShortcut === id}>
                      Cambiar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="modal-actions" style={{justifyContent:'flex-start', paddingLeft:0}}>
            <button className="btn btn-secondary btn-sm" onClick={handleResetShortcuts}>Restablecer todos</button>
          </div>
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
        <div className="modal-overlay" onClick={() => setShowUserForm(false)}>
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
        <div className="modal-overlay">
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
    </div>
  )
}
