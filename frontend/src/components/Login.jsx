import React, { useState, useEffect } from 'react'
import { auth, network } from '../api'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [networkInfo, setNetworkInfo] = useState(null)

  useEffect(() => {
    network.info().then(setNetworkInfo).catch(() => {})
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await auth.login(username, password)
      onLogin(res.token, res.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#3498db" strokeWidth="1.5">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </div>
        <h2>Sistema Tienda de Abarrotes</h2>
        {networkInfo && (
          <p className="network-hint">
            Accede desde la tablet: <strong>http://{networkInfo.ip}:{networkInfo.port}</strong>
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Usuario</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </div>
          <div className="form-group">
            <label>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
        <div className="login-footer">
          <small>Software diseñado por Ingeniero Jacob Parra © {new Date().getFullYear()}</small>
        </div>
      </div>
    </div>
  )
}
