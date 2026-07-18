import React, { useState, useEffect, useRef } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { setToken, getToken, auth, accounting, settings as settingsApi } from './api'
import { applyPalette } from './theme'
import ErrorBoundary from './components/ErrorBoundary'
import LogoWatermark from './components/LogoWatermark'
import ConfirmDialogHost from './components/ConfirmDialogHost'
import { modalKeys } from './modalKeys'
import Login from './components/Login'
import POS from './components/POS'
import Inventory from './components/Inventory'
import Accounting from './components/Accounting'
import Settings from './components/Settings'
import Customers from './components/Customers'
import AdminLayout from './components/AdminLayout'
import ProtectedRoute from './components/ProtectedRoute'
import PredictionsPage from './components/PredictionsPage'
import Purchases from './components/Purchases'
import { getShortcuts, matchesShortcut } from './shortcuts'
import './styles/app.css'

function formatMoney(n) {
  return '$' + parseFloat(n || 0).toFixed(2)
}

function InventoryPage({ user, onLogout }) {
  if (user.role === 'inventory') return <Inventory user={user} onLogout={onLogout} />
  return <AdminLayout user={user} onLogout={onLogout}><Inventory user={user} onLogout={onLogout} /></AdminLayout>
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showCashCount, setShowCashCount] = useState(false)
  const [cashCountAmount, setCashCountAmount] = useState('')
  const [sessionToClose, setSessionToClose] = useState(null)
  const [error, setError] = useState('')
  const [isOnline, setIsOnline] = useState(true)

  // Ojo: NO se usa navigator.onLine — solo dice si el sistema operativo tiene
  // alguna red/internet, no si ESTE servidor responde. En el PC principal el
  // servidor vive en localhost, siempre alcanzable sin importar el estado de
  // internet; en la tablet lo que importa es si llega a la IP del PC por
  // WiFi, no si hay internet real. Por eso se prueba de verdad contra la API
  // en vez de confiar en la señal genérica del navegador.
  useEffect(() => {
    let cancelled = false
    const check = () => {
      fetch('/api/network-info').then(r => { if (!cancelled) setIsOnline(r.ok) }).catch(() => { if (!cancelled) setIsOnline(false) })
    }
    check()
    const interval = setInterval(check, 15000)
    window.addEventListener('online', check)
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('online', check) }
  }, [])

  useEffect(() => {
    const handler = (e) => {
      const { key, code } = e
      const isNumpadArrow = (code === 'Numpad8' || code === 'Numpad4' || code === 'Numpad2' || code === 'Numpad6')
      const isRegularArrow = (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')
      const isArrow = isRegularArrow || (isNumpadArrow && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))
      if (isArrow) {
        e.preventDefault()
        const focusable = Array.from(document.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter(el => el.tabIndex !== -1 && el.offsetParent !== null)
        const current = focusable.indexOf(document.activeElement)
        const isPrev = (key === 'ArrowUp' || key === 'ArrowLeft' || code === 'Numpad8' || code === 'Numpad4')
        const next = isPrev
          ? (current <= 0 ? focusable.length - 1 : current - 1)
          : (current >= focusable.length - 1 ? 0 : current + 1)
        focusable[next]?.focus()
      } else if (key === 'Enter' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        document.activeElement?.click()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Atajos de navegación: funcionan en CUALQUIER pantalla (antes vivían
  // solo dentro de POS.jsx, así que por ejemplo F5 no hacía nada estando en
  // Contabilidad). Las acciones específicas del POS (buscar, cobrar,
  // cliente/fiado, historial) se manejan aparte, dentro de POS.jsx, porque
  // solo tienen sentido ahí.
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const shortcuts = getShortcuts()
      for (const id of Object.keys(shortcuts)) {
        if (!id.startsWith('nav_')) continue
        if (matchesShortcut(e, shortcuts[id])) {
          e.preventDefault()
          window.location.hash = shortcuts[id].hash
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const loadPalette = () => {
    settingsApi.getPalette()
      .then(p => applyPalette({ primary: p.palette_primary, success: p.palette_success, danger: p.palette_danger, warning: p.palette_warning }))
      .catch(() => {})
  }

  useEffect(() => {
    const token = getToken()
    if (token) {
      auth.me()
        .then((res) => { setUser(res.user); loadPalette() })
        .catch(() => { setToken(null); setUser(null) })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const handleLogin = (token, userData) => {
    setToken(token)
    setUser(userData)
    loadPalette()
  }

  const doLogout = () => {
    setToken(null)
    setUser(null)
  }

  const handleLogout = () => {
    setShowLogoutConfirm(true)
  }

  const handleLogoutConfirm = async () => {
    setShowLogoutConfirm(false)
    try {
      const res = await accounting.mySession()
      if (res.session) {
        setSessionToClose(res.session)
        setCashCountAmount('')
        setShowCashCount(true)
      } else {
        doLogout()
      }
    } catch (e) {
      doLogout()
    }
  }

  const handleCashCountSubmit = async () => {
    try {
      if (sessionToClose) {
        try { await accounting.closeSession(sessionToClose.id, { closing_amount: parseFloat(cashCountAmount) || 0 }) } catch (e) { setError(e.message) }
      }
    } catch (_) {}
    setShowCashCount(false)
    doLogout()
  }

  const cashCountRef = useRef(null)
  useEffect(() => {
    if (showCashCount) {
      setTimeout(() => { if (cashCountRef.current) cashCountRef.current.focus() }, 100)
    }
  }, [showCashCount])

  if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Cargando...</p></div>

  return (
    <ErrorBoundary>
    <HashRouter>
      {user && <LogoWatermark />}
      <ConfirmDialogHost />
      {!isOnline && (
        <div className="offline-banner">
          Sin conexión — mostrando el catálogo guardado, puede no estar al día. No se puede cobrar hasta recuperar la señal.
        </div>
      )}
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} />
        <Route path="/" element={user ? <Navigate to={user.role === 'inventory' ? '/inventory' : '/pos'} /> : <Navigate to="/login" />} />
        <Route path="/pos" element={<ProtectedRoute user={user} allowedRoles={['admin', 'cashier']}><POS user={user} onLogout={doLogout} /></ProtectedRoute>} />
        <Route path="/inventory" element={
          <ProtectedRoute user={user} allowedRoles={['admin', 'inventory']}>
            <InventoryPage user={user} onLogout={handleLogout} />
          </ProtectedRoute>
        } />
        <Route path="/accounting" element={<ProtectedRoute user={user} allowedRoles={['admin']}><AdminLayout user={user} onLogout={handleLogout}><Accounting user={user} onLogout={handleLogout} /></AdminLayout></ProtectedRoute>} />
        <Route path="/predictions" element={<ProtectedRoute user={user} allowedRoles={['admin', 'cashier']}><PredictionsPage user={user} onLogout={doLogout} /></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute user={user} allowedRoles={['admin']}><AdminLayout user={user} onLogout={handleLogout}><Customers user={user} onLogout={handleLogout} /></AdminLayout></ProtectedRoute>} />
        <Route path="/purchases" element={<ProtectedRoute user={user} allowedRoles={['admin', 'cashier']}><AdminLayout user={user} onLogout={handleLogout}><Purchases user={user} /></AdminLayout></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute user={user} allowedRoles={['admin']}><AdminLayout user={user} onLogout={handleLogout}><Settings user={user} /></AdminLayout></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>

      {showLogoutConfirm && (
        <div className="modal-overlay" onKeyDown={modalKeys(() => setShowLogoutConfirm(false), handleLogoutConfirm)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Cerrar Sesión</h3>
            <p>¿Seguro que deseas salir?</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowLogoutConfirm(false)} tabIndex="0">No</button>
              <button className="btn btn-primary" onClick={handleLogoutConfirm} tabIndex="0">Sí</button>
            </div>
          </div>
        </div>
      )}
      {showCashCount && (
        <div className="modal-overlay" onKeyDown={modalKeys(null, handleCashCountSubmit)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Conteo de Caja</h3>
            <p>Ingresa el efectivo que hay en caja para cerrar el día:</p>
            <div className="form-group">
              <input ref={cashCountRef} type="number" step="0.01" className="input-lg" value={cashCountAmount} onChange={(e) => setCashCountAmount(e.target.value)} placeholder="0.00" />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCashCount(false)} tabIndex="0">Cancelar</button>
              <button className="btn btn-primary" onClick={handleCashCountSubmit} tabIndex="0">Cerrar y Salir</button>
            </div>
          </div>
        </div>
      )}
    </HashRouter>
    </ErrorBoundary>
  )
}
