import React, { useState, useEffect, useCallback } from 'react'
import { events } from '../api'

function formatDate(d) {
  if (!d) return ''
  const date = new Date(d + 'T12:00:00')
  return date.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })
}

const EVENT_TYPES = [
  { value: 'holiday', label: 'Feriado' },
  { value: 'sports', label: 'Deportivo' },
  { value: 'weather', label: 'Clima' },
  { value: 'local', label: 'Evento Local' },
  { value: 'promotion', label: 'Promocion' },
  { value: 'other', label: 'Otro' },
]

const IMPACT_LEVELS = [
  { value: 'low', label: 'Bajo' },
  { value: 'medium', label: 'Medio' },
  { value: 'high', label: 'Alto' },
]

export default function Events({ user }) {
  const [tab, setTab] = useState('list')
  const [eventList, setEventList] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selected, setSelected] = useState(null)
  const [measureResult, setMeasureResult] = useState(null)
  const [factors, setFactors] = useState(null)

  const [form, setForm] = useState({
    name: '', description: '', type: 'local', start_date: '', end_date: '',
    branch_id: 0, impact_expected: 'medium', is_recurring: false,
  })

  const loadEvents = useCallback(async () => {
    try {
      const all = await events.list({ upcoming: '' })
      setEventList(all)
      const up = await events.upcoming(60)
      setUpcoming(up)
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { loadEvents(); setLoading(false) }, [loadEvents])

  const handleCreate = async (e) => {
    e.preventDefault(); setError(''); setSuccess('')
    try {
      const created = await events.create(form)
      setSuccess('Evento creado: ' + created.name)
      setForm({ name: '', description: '', type: 'local', start_date: '', end_date: '', branch_id: 0, impact_expected: 'medium', is_recurring: false })
      loadEvents()
    } catch (e) { setError(e.message) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Eliminar este evento?')) return
    try { await events.delete(id); setSuccess('Evento eliminado'); loadEvents() }
    catch (e) { setError(e.message) }
  }

  const handleMeasure = async (id) => {
    try { const r = await events.measure(id); setMeasureResult(r); setSuccess('Impacto medido') }
    catch (e) { setError(e.message) }
  }

  const handleSync = async () => {
    try { await events.sync(new Date().getFullYear()); setSuccess('Eventos precargados sincronizados'); loadEvents() }
    catch (e) { setError(e.message) }
  }

  const loadFactors = async (date) => {
    try { const f = await events.factors(date); setFactors(f) }
    catch (e) { setError(e.message) }
  }

  const getTypeLabel = (t) => EVENT_TYPES.find(et => et.value === t)?.label || t
  const getImpactLabel = (i) => IMPACT_LEVELS.find(il => il.value === i)?.label || i

  const [factorDate, setFactorDate] = useState(new Date().toISOString().split('T')[0])

  if (loading) return <div className="loading">Cargando eventos...</div>

  return (
    <div>
      <div className="page-header">
        <h2>Eventos</h2>
        <div className="header-actions">
          <button className="btn btn-sm btn-outline" onClick={handleSync}>Sincronizar Feriados</button>
        </div>
      </div>

      {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}
      {success && <div className="alert alert-success" onClick={() => setSuccess('')}>{success}</div>}

      <div className="tabs">
        <button className={`tab-btn ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>Lista</button>
        <button className={`tab-btn ${tab === 'upcoming' ? 'active' : ''}`} onClick={() => setTab('upcoming')}>Proximos</button>
        <button className={`tab-btn ${tab === 'new' ? 'active' : ''}`} onClick={() => setTab('new')}>Nuevo Evento</button>
        <button className={`tab-btn ${tab === 'factors' ? 'active' : ''}`} onClick={() => setTab('factors')}>Factor Predictivo</button>
      </div>

      {tab === 'list' && (
        <div className="card">
          <div className="card-header"><h3>Todos los Eventos</h3></div>
          <div className="table-responsive">
            <table className="table">
              <thead><tr><th>Nombre</th><th>Tipo</th><th>Inicio</th><th>Fin</th><th>Impacto</th><th>Medido</th><th>Fuente</th><th></th></tr></thead>
              <tbody>
                {eventList.map(ev => (
                  <tr key={ev.id}>
                    <td><strong>{ev.name}</strong>{ev.description && <br />}<small className="text-muted">{ev.description}</small></td>
                    <td><span className="badge badge-{ev.type}">{getTypeLabel(ev.type)}</span></td>
                    <td>{formatDate(ev.start_date)}</td>
                    <td>{ev.end_date !== ev.start_date ? formatDate(ev.end_date) : '-'}</td>
                    <td>{getImpactLabel(ev.impact_expected)}</td>
                    <td>{ev.impact_measured !== null ? ev.impact_measured.toFixed(1) + '%' : '-'}</td>
                    <td><small>{ev.source}</small></td>
                    <td>
                      <button className="btn btn-sm btn-outline" onClick={() => handleMeasure(ev.id)} title="Medir impacto real">Medir</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(ev.id)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
                {eventList.length === 0 && <tr><td colSpan="8" className="text-center">Sin eventos registrados</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'upcoming' && (
        <div className="card">
          <div className="card-header"><h3>Proximos 60 dias</h3></div>
          {upcoming.length === 0 ? <div className="card-body"><p className="text-muted">No hay eventos proximos</p></div> : (
            <div className="table-responsive">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Nombre</th><th>Tipo</th><th>Impacto Esperado</th></tr></thead>
                <tbody>
                  {upcoming.map(ev => (
                    <tr key={ev.id}>
                      <td>{formatDate(ev.start_date)}</td>
                      <td><strong>{ev.name}</strong></td>
                      <td><span className="badge badge-{ev.type}">{getTypeLabel(ev.type)}</span></td>
                      <td>{getImpactLabel(ev.impact_expected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'new' && (
        <div className="card">
          <div className="card-header"><h3>Registrar Evento Local</h3></div>
          <div className="card-body">
            <form onSubmit={handleCreate} className="form-grid">
              <div className="form-group">
                <label>Nombre del Evento</label>
                <input className="form-control" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required placeholder="Ej: Feria patronal, cierre de calle" />
              </div>
              <div className="form-group">
                <label>Descripcion</label>
                <input className="form-control" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Detalles opcionales" />
              </div>
              <div className="form-group">
                <label>Tipo</label>
                <select className="form-control" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                  {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Fecha de Inicio</label>
                <input className="form-control" type="date" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Fecha de Fin</label>
                <input className="form-control" type="date" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Impacto Esperado</label>
                <select className="form-control" value={form.impact_expected} onChange={e => setForm({...form, impact_expected: e.target.value})}>
                  {IMPACT_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Sucursal</label>
                <select className="form-control" value={form.branch_id} onChange={e => setForm({...form, branch_id: parseInt(e.target.value)})}>
                  <option value={0}>Todas las sucursales</option>
                  <option value={1}>Sucursal 1</option>
                </select>
              </div>
              <div className="form-group">
                <label><input type="checkbox" checked={form.is_recurring} onChange={e => setForm({...form, is_recurring: e.target.checked})} /> Evento recurrente (anual)</label>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">Guardar Evento</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'factors' && (
        <div className="card">
          <div className="card-header"><h3>Factor Predictivo por Fecha</h3></div>
          <div className="card-body">
            <div className="form-group">
              <label>Selecciona una fecha</label>
              <div className="input-group">
                <input className="form-control" type="date" value={factorDate} onChange={e => { setFactorDate(e.target.value); loadFactors(e.target.value) }} />
                <button className="btn btn-primary" onClick={() => loadFactors(factorDate)}>Calcular Factor</button>
              </div>
            </div>
            {factors && (
              <div className="dashboard-grid" style={{ marginTop: 16 }}>
                <div className="dash-card">
                  <h4>Factor Combinado</h4>
                  <div className="dash-number">{(factors.combined * 100).toFixed(1)}%</div>
                  <p>Ajuste de ventas esperado</p>
                </div>
                <div className="dash-card">
                  <h4>Factor Eventos</h4>
                  <div className="dash-number">{(factors.eventFactor * 100).toFixed(1)}%</div>
                </div>
                <div className="dash-card">
                  <h4>Factor Clima</h4>
                  <div className="dash-number">{(factors.weatherFactor * 100).toFixed(1)}%</div>
                </div>
                {factors.activeEvents?.length > 0 && (
                  <div className="dash-card dash-card-wide">
                    <h4>Eventos activos en esta fecha</h4>
                    {factors.activeEvents.map(ev => (
                      <p key={ev.id}>{ev.name} <small className="text-muted">({ev.type}, factor: {(ev.factor * 100).toFixed(0)}%)</small></p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {measureResult && (
        <div className="modal-overlay" onClick={() => setMeasureResult(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Resultado de Medicion</h3>
            <p>Venta esperada por dia: <strong>${parseFloat(measureResult.expectedDaily || 0).toFixed(2)}</strong></p>
            <p>Venta real por dia: <strong>${parseFloat(measureResult.actualDaily || 0).toFixed(2)}</strong></p>
            <p>Diferencia: <strong className={measureResult.deltaPct > 0 ? 'text-success' : 'text-danger'}>{measureResult.deltaPct > 0 ? '+' : ''}{measureResult.deltaPct.toFixed(1)}%</strong></p>
            <p>Impacto: <strong>{measureResult.impactLabel === 'positive_high' ? 'Alto positivo' : measureResult.impactLabel === 'positive_low' ? 'Positivo' : measureResult.impactLabel === 'negative_high' ? 'Alto negativo' : measureResult.impactLabel === 'negative_low' ? 'Negativo' : 'Neutro'}</strong></p>
            <button className="btn btn-primary" onClick={() => setMeasureResult(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}
