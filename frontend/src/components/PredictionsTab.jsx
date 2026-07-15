import React, { useState, useEffect } from 'react'
import { accounting } from '../api'

function formatNumber(n) { return (n || 0).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }

export default function PredictionsTab() {
  const [summary, setSummary] = useState(null)
  const [predictions, setPredictions] = useState([])
  const [view, setView] = useState('summary')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('suggested_order')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [sumRes, prodRes] = await Promise.all([accounting.predictions(), accounting.predictionsByProduct()])
      setSummary(sumRes)
      setPredictions(prodRes.predictions || [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const sorted = [...predictions]
    .filter(p => !search || p.product_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') return a.product_name.localeCompare(b.product_name)
      if (sortBy === 'stockout') return a.days_until_stockout - b.days_until_stockout
      if (sortBy === 'forecast') return b.daily_forecast - a.daily_forecast
      return b.suggested_order - a.suggested_order
    })

  if (loading) return <div className="text-center" style={{padding:'2rem'}}><div className="spinner"></div><p style={{marginTop:'1rem', color:'var(--text-muted)'}}>Calculando predicciones...</p></div>

  return (
    <div>
      {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}

      <div className="tabs" style={{marginBottom:'1rem'}}>
        <button className={`tab-btn ${view === 'summary' ? 'active' : ''}`} onClick={() => setView('summary')}>Resumen</button>
        <button className={`tab-btn ${view === 'products' ? 'active' : ''}`} onClick={() => setView('products')}>Productos</button>
      </div>

      {view === 'summary' && summary && (
        <>
          <div className="dashboard-grid" style={{marginBottom:'1rem'}}>
            <div className="dash-card">
              <h4>Pronostico Diario</h4>
              <div className="dash-number" style={{color:'var(--primary)'}}>${formatNumber(summary.total_daily_forecast)}</div>
            </div>
            <div className="dash-card">
              <h4>Pronostico Mensual</h4>
              <div className="dash-number">${formatNumber(summary.total_monthly_forecast)}</div>
            </div>
            <div className="dash-card">
              <h4>Inventario Actual</h4>
              <div className="dash-number" style={{color:'var(--text-secondary)'}}>${formatNumber(summary.total_current_stock)}</div>
            </div>
            <div className="dash-card">
              <h4>Compra Sugerida</h4>
              <div className="dash-number" style={{color:'var(--success)'}}>${formatNumber(summary.total_suggested_order)}</div>
            </div>
            <div className="dash-card">
              <h4>Riesgo de Faltante</h4>
              <div className="dash-number" style={{color: summary.stockout_risk_count > 5 ? 'var(--danger)' : 'var(--warning)'}}>{summary.stockout_risk_count} prod.</div>
            </div>
            <div className="dash-card">
              <h4>Sobreinventario</h4>
              <div className="dash-number" style={{color:'var(--text-muted)'}}>{summary.overstock_risk_count} prod.</div>
            </div>
          </div>

          <div className="card" style={{marginBottom:'1rem'}}>
            <div className="card-header">
              <h3>Distribucion por Tipo de Demanda</h3>
            </div>
            <div className="card-body">
              <div style={{display:'flex', gap:'1rem', flexWrap:'wrap'}}>
                {Object.entries(summary.demand_distribution || {}).map(([type, count]) => (
                  <div key={type} style={{flex:1, minWidth:'120px', padding:'0.75rem', background:'var(--bg)', borderRadius:'var(--radius)', textAlign:'center'}}>
                    <div style={{fontSize:'1.3rem', fontWeight:700}}>{count}</div>
                    <div style={{fontSize:'0.75rem', color:'var(--text-muted)', marginTop:'0.2rem'}}>{type}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Prioridad de Reorden</h3>
              <span className="text-muted" style={{fontSize:'0.8rem'}}>Top 20 productos que necesitan compra</span>
            </div>
            <div className="table-responsive">
              <table className="table">
                <thead><tr><th>Producto</th><th>Pronostico Diario</th><th>Stock Actual</th><th>Dias Restantes</th><th>Compra Sugerida</th></tr></thead>
                <tbody>
                  {(summary.top_reorder || []).map((p, i) => (
                    <tr key={i}>
                      <td>{p.product_name}</td>
                      <td>{formatNumber(p.daily_forecast)}</td>
                      <td>{formatNumber(p.current_stock)}</td>
                      <td style={{color: p.days_until_stockout < 7 ? 'var(--danger)' : 'inherit'}}>{p.days_until_stockout}</td>
                      <td><strong>{formatNumber(p.suggested_order)}</strong></td>
                    </tr>
                  ))}
                  {(!summary.top_reorder || summary.top_reorder.length === 0) && <tr><td colSpan="5" className="text-center">Sin datos</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {view === 'products' && (
        <div>
          <div style={{display:'flex', gap:'0.5rem', marginBottom:'1rem', alignItems:'center', flexWrap:'wrap'}}>
            <input type="text" className="input" style={{flex:1, maxWidth:'300px'}} placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} />
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{width:'auto', display:'inline-block'}}>
              <option value="suggested_order">Compra Sugerida</option>
              <option value="forecast">Pronostico</option>
              <option value="stockout">Riesgo Faltante</option>
              <option value="name">Nombre</option>
            </select>
            <span className="text-muted" style={{fontSize:'0.8rem'}}>{sorted.length} productos</span>
          </div>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th>Diario</th>
                  <th>Semanal</th>
                  <th>Mensual</th>
                  <th>Stock</th>
                  <th>Min</th>
                  <th>Pto Reorden</th>
                  <th>Dias Rest.</th>
                  <th>Compra Sug.</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 100).map(p => (
                  <tr key={p.product_id} style={{background: p.days_until_stockout < 7 ? 'rgba(220,38,38,0.04)' : p.suggested_order > 0 ? 'rgba(245,158,11,0.04)' : ''}}>
                    <td><strong>{p.product_name}</strong></td>
                    <td><span className={`badge badge-${p.demand_type === 'REGULAR' ? 'success' : p.demand_type === 'INTERMITTENT' ? 'warning' : 'secondary'}`} style={{fontSize:'0.7rem', padding:'0.15rem 0.4rem', borderRadius:'4px'}}>{p.demand_type}</span></td>
                    <td>{p.daily_forecast.toFixed(1)}</td>
                    <td>{formatNumber(p.weekly_forecast)}</td>
                    <td>{formatNumber(p.monthly_forecast)}</td>
                    <td>{formatNumber(p.current_stock)}</td>
                    <td>{p.min_stock}</td>
                    <td>{p.reorder_point}</td>
                    <td style={{color: p.days_until_stockout < 7 ? 'var(--danger)' : p.days_until_stockout < 14 ? 'var(--warning)' : 'inherit', fontWeight: p.days_until_stockout < 14 ? 600 : 'normal'}}>{p.days_until_stockout.toFixed(1)}</td>
                    <td><strong style={{color: p.suggested_order > 0 ? 'var(--success)' : 'inherit'}}>{formatNumber(p.suggested_order)}</strong></td>
                  </tr>
                ))}
                {sorted.length === 0 && <tr><td colSpan="10" className="text-center">Sin datos</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
