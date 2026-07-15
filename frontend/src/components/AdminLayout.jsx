import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

export default function AdminLayout({ user, onLogout, children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [clock, setClock] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const navItems = [
    { path: '/pos', label: 'POS' },
    { path: '/inventory', label: 'Inventario' },
    { path: '/purchases', label: 'Compras' },
    { path: '/accounting', label: 'Contabilidad' },
    { path: '/customers', label: 'Clientes' },
  ]

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div className="header-left">
          <h1 onClick={() => navigate('/pos')} style={{ cursor: 'pointer' }}>
            Tienda
          </h1>
          <span className="header-user">{user?.name}</span>
        </div>
        <nav className="admin-nav">
          {navItems.map(item => (
            <button
              key={item.path}
              className={`nav-btn ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className="header-date">{clock.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' })} {clock.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Mexico_City' })}</span>
          {user?.role === 'admin' && (
          <button className="btn btn-sm btn-outline" onClick={() => navigate('/settings')} title="Configuracion">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          )}
          <button className="btn btn-sm btn-outline" onClick={onLogout} title="Cerrar sesion">Salir</button>
        </div>
      </header>
      <main className="admin-content">
        {children}
      </main>
    </div>
  )
}
