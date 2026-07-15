import React, { useState, useEffect, useCallback } from 'react'
import PredictionsTab from './PredictionsTab'
import { events } from '../api'

function formatDate(d) {
  if (!d) return ''
  return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

const IMPACT_LEVELS = [
  { value: 'low', label: 'Bajo (-5%)' },
  { value: 'medium', label: 'Medio (-12%)' },
  { value: 'high', label: 'Alto (-25%)' },
]

export default function PredictionsPage({ user, onLogout }) {
  const [showEventForm, setShowEventForm] = useState(false)
  const [upcomingEvents, setUpcomingEvents] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [clock, setClock] = useState(new Date())

  useEffect(() => { const id = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(id) }, [])

  const [form, setForm] = useState({
    name: '', start_date: '', end_date: '', impact_expected: 'medium',
  })

  const loadUpcoming = useCallback(async () => {
    try {
      const up = await events.upcoming(60)
      setUpcomingEvents(up)
    } catch (e) { /* ignore */ }
  }, [])

  useEffect(() => { loadUpcoming() }, [loadUpcoming])

  const handleCreateEvent = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    try {
      await events.create({
        name: form.name,
        start_date: form.start_date,
        end_date: form.end_date || form.start_date,
        impact_expected: form.impact_expected,
        type: 'local',
        is_recurring: false,
      })
      setSuccess('Evento registrado. Ya afecta las predicciones.')
      setForm({ name: '', start_date: '', end_date: '', impact_expected: 'medium' })
      setShowEventForm(false)
      loadUpcoming()
    } catch (e) { setError(e.message) }
  }

  const handleDeleteEvent = async (id) => {
    try { await events.delete(id); loadUpcoming() }
    catch (e) { setError(e.message) }
  }

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div className="header-left">
          <h1 onClick={() => window.location.hash = '#/pos'} style={{ cursor: 'pointer' }}>
            Tienda
          </h1>
          <span className="header-user">{user?.name}</span>
        </div>
        <nav className="admin-nav">
          <button className="nav-btn" onClick={() => window.location.hash = '#/pos'}>POS</button>
        </nav>
        <div className="header-right">
          <span className="header-date">{clock.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' })} {clock.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Mexico_City' })}</span>
          <button className="btn btn-sm btn-outline" onClick={onLogout}>Salir</button>
        </div>
      </header>
      <main className="admin-content">
        <div className="accounting-page">
          <div className="page-header">
            <h2>Proyector de Ventas</h2>
            <div className="header-actions">
              <button className="btn btn-sm btn-primary" onClick={() => setShowEventForm(!showEventForm)}>
                {showEventForm ? 'Cerrar' : 'Registrar Evento Local'}
              </button>
            </div>
          </div>

          {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}
          {success && <div className="alert alert-success" onClick={() => setSuccess('')}>{success}</div>}

          {showEventForm && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="card-header">
                <h3>Nuevo Evento Local</h3>
              </div>
              <div className="card-body">
                <form onSubmit={handleCreateEvent} className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Nombre del evento</label>
                    <input className="form-control" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required placeholder="Ej: Feria patronal" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Fecha inicio</label>
                    <input className="form-control" type="date" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} required />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Fecha fin</label>
                    <input className="form-control" type="date" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Impacto</label>
                    <select className="form-control" value={form.impact_expected} onChange={e => setForm({...form, impact_expected: e.target.value})}>
                      {IMPACT_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                  <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
                    <button type="submit" className="btn btn-primary">Registrar</button>
                  </div>
                </form>
                <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
                  Los eventos registrados se usan automaticamente para ajustar el pronostico de ventas.
                </p>
              </div>
            </div>
          )}

          {upcomingEvents.length > 0 && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="card-header">
                <h3>Proximos Eventos</h3>
                <span className="text-muted" style={{ fontSize: '0.8rem' }}>{upcomingEvents.length} evento(s) en los proximos 60 dias</span>
              </div>
              <div className="table-responsive">
                <table className="table table-sm">
                  <thead><tr><th>Fecha</th><th>Nombre</th><th>Tipo</th><th>Impacto</th><th></th></tr></thead>
                  <tbody>
                    {upcomingEvents.map(ev => (
                      <tr key={ev.id}>
                        <td>{formatDate(ev.start_date)}{ev.end_date && ev.end_date !== ev.start_date ? ' - ' + formatDate(ev.end_date) : ''}</td>
                        <td><strong>{ev.name}</strong></td>
                        <td><small>{ev.type === 'local' ? 'Local' : ev.type === 'holiday' ? 'Feriado' : ev.type === 'promotion' ? 'Promocion' : ev.type}</small></td>
                        <td>{ev.impact_expected === 'high' ? 'Alto' : ev.impact_expected === 'medium' ? 'Medio' : 'Bajo'}</td>
                        <td>
                          {ev.source === 'manual' && (
                            <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteEvent(ev.id)}>X</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <PredictionsTab />
        </div>
      </main>
    </div>
  )
}
