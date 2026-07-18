import React, { useState, useEffect, useCallback } from 'react'
import { accounting, sales } from '../api'
import { formatDateTime, formatDate, isSameLocalDay } from '../dateUtils'
import Events from './Events'
import PredictionsTab from './PredictionsTab'
import { modalKeys } from '../modalKeys'
import { confirmDialog } from '../confirmDialog'

function formatMoney(n) {
  return '$' + parseFloat(n || 0).toFixed(2)
}

function SimpleBar({ data, maxVal }) {
  if (!data || data.length === 0) return <p className="text-muted">Sin datos</p>
  return (
    <div className="simple-chart">
      {data.map((d, i) => (
        <div key={i} className="bar-item">
          <span className="bar-label">{d.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{width: `${(d.value / maxVal) * 100}%`}}></div>
          </div>
          <span className="bar-value">{formatMoney(d.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Accounting({ user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [dashData, setDashData] = useState(null)
  const [cashReg, setCashReg] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [expenseForm, setExpenseForm] = useState({ description: '', amount: '', category: '', payment_method: 'cash', notes: '' })
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [historyData, setHistoryData] = useState(null)
  const [profitData, setProfitData] = useState(null)
  const [topProducts, setTopProducts] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [movements, setMovements] = useState([])
  const [movementsType, setMovementsType] = useState('')
  const [wasteData, setWasteData] = useState(null)

  const loadDashboard = useCallback(async () => {
    try { setDashData(await accounting.dashboard()) } catch (e) { setError(e.message) }
  }, [])

  const loadCashRegister = useCallback(async () => {
    try { setCashReg(await accounting.cashRegister()) } catch (e) { setError(e.message) }
  }, [])

  const loadExpenses = useCallback(async () => {
    try {
      const params = {}
      if (dateFrom) params.dateFrom = dateFrom
      if (dateTo) params.dateTo = dateTo
      const res = await accounting.expenses(params)
      setExpenses(res.expenses)
    } catch (e) { setError(e.message) }
  }, [dateFrom, dateTo])

  const loadMovements = async () => {
    try {
      const params = { limit: 200 }
      if (dateFrom) params.dateFrom = dateFrom
      if (dateTo) params.dateTo = dateTo
      if (movementsType) params.type = movementsType
      const res = await accounting.cashMovements(params)
      setMovements(res.movements)
    } catch (e) { setError(e.message) }
  }

  useEffect(() => {
    loadDashboard(); loadCashRegister(); loadWasteTotals()
    if (tab === 'dashboard') {
      const interval = setInterval(() => { loadDashboard(); loadCashRegister(); loadWasteTotals() }, 30000)
      return () => clearInterval(interval)
    }
  }, [loadDashboard, loadCashRegister, tab])

  const loadWasteTotals = async () => {
    try {
      const res = await accounting.listWaste({ limit: 100 })
      setWasteData(res.waste)
    } catch (e) {}
  }

  const handleAddExpense = async () => {
    if (!expenseForm.description || !expenseForm.amount) { setError('Descripción y monto requeridos'); return }
    setError('')
    try {
      await accounting.addExpense({
        description: expenseForm.description,
        amount: parseFloat(expenseForm.amount),
        category: expenseForm.category || null,
        payment_method: expenseForm.payment_method,
        notes: expenseForm.notes || null
      })
      setExpenseForm({ description: '', amount: '', category: '', payment_method: 'cash', notes: '' })
      setShowExpenseForm(false)
      await Promise.all([loadExpenses(), loadDashboard(), loadCashRegister()])
      setSuccess('Gasto registrado')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const loadHistory = async () => {
    try {
      const params = {}
      if (dateFrom) params.dateFrom = dateFrom
      if (dateTo) params.dateTo = dateTo
      const [hist, prof, top] = await Promise.all([
        accounting.history(params),
        accounting.profit(params),
        accounting.topProducts(params)
      ])
      setHistoryData(hist)
      setProfitData(prof)
      setTopProducts(top.products || [])
    } catch (e) { setError(e.message) }
  }

  useEffect(() => {
    if (tab === 'reports') {
      loadHistory()
      const interval = setInterval(loadHistory, 30000)
      return () => clearInterval(interval)
    }
  }, [tab, dateFrom, dateTo])
  useEffect(() => {
    if (tab === 'expenses') {
      loadExpenses()
      const interval = setInterval(loadExpenses, 30000)
      return () => clearInterval(interval)
    }
  }, [tab, dateFrom, dateTo])
  useEffect(() => { if (tab === 'movements') { loadMovements(); const interval = setInterval(loadMovements, 30000); return () => clearInterval(interval) } }, [tab, dateFrom, dateTo, movementsType])
  useEffect(() => { if (tab === 'cashier') { loadCashRegister(); loadHistory(); const interval = setInterval(() => { loadCashRegister(); loadHistory() }, 30000); return () => clearInterval(interval) } }, [tab])

  const exportCSV = (data, filename) => {
    if (!data || data.length === 0) return
    const keys = Object.keys(data[0])
    const csv = [keys.join(','), ...data.map(r => keys.map(k => `"${r[k]}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
  }

  const exportDetailedSales = async () => {
    const params = {}
    if (dateFrom) params.dateFrom = dateFrom
    if (dateTo) params.dateTo = dateTo
    try {
      const res = await sales.exportDetailed(params)
      if (!res.sales || res.sales.length === 0) { setError('Sin datos para exportar'); return }
      exportCSV(res.sales, 'ventas_detalladas.csv')
    } catch (e) { setError(e.message) }
  }

  const tabs = [
    { id: 'dashboard', label: 'Resumen' },
    { id: 'cashier', label: 'Caja' },
    { id: 'movements', label: 'Movimientos' },
    { id: 'expenses', label: 'Gastos' },
    { id: 'reports', label: 'Reportes' },
    { id: 'predictions', label: 'Predicciones' },
    { id: 'events', label: 'Eventos' },
  ]

  const maxDailySales = dashData?.dailySales?.length > 0
    ? Math.max(...dashData.dailySales.map(d => d.total))
    : 1

  return (
    <div className="accounting-page">
      <div className="page-header">
        <h2>Contabilidad</h2>
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

      {tab === 'dashboard' && dashData && (
        <div className="dashboard-grid">
          <div className="dash-card">
            <h4>Ventas Hoy</h4>
            <div className="dash-number">{formatMoney(dashData.todaySales.total)}</div>
            <p>{dashData.todaySales.count} ventas</p>
          </div>
          <div className="dash-card">
            <h4>Ventas Semana</h4>
            <div className="dash-number">{formatMoney(dashData.weekSales)}</div>
          </div>
          <div className="dash-card">
            <h4>Ventas Mes</h4>
            <div className="dash-number">{formatMoney(dashData.monthSales)}</div>
          </div>
          <div className="dash-card">
            <h4>Gastos Hoy</h4>
            <div className="dash-number">{formatMoney(dashData.todayExpenses)}</div>
          </div>
          <div className="dash-card dash-card-wide">
            <h4>Productos más vendidos (mes)</h4>
            {dashData.productsSold?.length > 0 ? (
              <table className="table table-sm">
                <thead><tr><th>Producto</th><th>Cant</th><th>Total</th></tr></thead>
                <tbody>
                  {dashData.productsSold.map((p, i) => (
                    <tr key={i}><td>{p.product_name}</td><td>{p.total_qty}</td><td>{formatMoney(p.total_revenue)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-muted">Sin datos</p>}
          </div>
          <div className="dash-card dash-card-wide">
            <h4>Ventas Diarias (mes)</h4>
            <SimpleBar data={dashData.dailySales.map(d => ({ label: d.date.slice(5), value: d.total }))} maxVal={maxDailySales} />
          </div>
          <div className="dash-card">
            <h4>Stock Bajo</h4>
            <div className="dash-number text-warning">{dashData.lowStockCount}</div>
            <p>productos</p>
          </div>
          {wasteData && wasteData.length > 0 && (
            <div className="dash-card">
              <h4>Mermas (hoy)</h4>
              <div className="dash-number text-danger">{formatMoney(wasteData.filter(w => isSameLocalDay(w.created_at, new Date())).reduce((s, w) => s + w.total_loss, 0))}</div>
              <p>{wasteData.filter(w => isSameLocalDay(w.created_at, new Date())).length} registros</p>
            </div>
          )}
        </div>
      )}

      {tab === 'cashier' && (
        <div className="cashier-section">
          <div className="card">
            <h3>Corte de Caja - {cashReg?.date || new Date().toISOString().split('T')[0]}</h3>
            {cashReg && (
              <div className="cash-register-info">
                <div className="info-row"><span>Estado:</span><span className={cashReg.status === 'open' ? 'text-success' : 'text-muted'}>{cashReg.status === 'open' ? 'Abierta' : 'Cerrada'}</span></div>
                <div className="info-row"><span>Monto inicial:</span><span>{formatMoney(cashReg.opening_amount)}</span></div>
                <div className="info-row"><span>Ventas totales:</span><span>{formatMoney(cashReg.totalSales !== undefined ? cashReg.totalSales : cashReg.total_sales)}</span></div>
                <div className="info-row"><span>Gastos:</span><span>{formatMoney(cashReg.totalExpenses !== undefined ? cashReg.totalExpenses : cashReg.total_expenses)}</span></div>
                {cashReg.status === 'closed' && (
                  <>
                    <div className="info-row"><span>Efectivo esperado:</span><span>{formatMoney(cashReg.expected_amount)}</span></div>
                    <div className="info-row"><span>Efectivo contado:</span><span>{formatMoney(cashReg.closing_amount)}</span></div>
                    <div className="info-row"><span className={cashReg.difference !== 0 ? 'text-danger' : 'text-success'}>Diferencia:</span><span>{formatMoney(cashReg.difference)}</span></div>
                  </>
                )}
              </div>
            )}
          </div>

          {historyData && (
            <div className="card">
              <h3>Últimos Cortes</h3>
              <table className="table">
                <thead><tr><th>Fecha</th><th>Esperado</th><th>Contado</th><th>Diferencia</th></tr></thead>
                <tbody>
                  {(historyData.registers || []).slice(0, 10).map(r => (
                    <tr key={r.id}>
                      <td>{r.date}</td>
                      <td>{formatMoney(r.expected_amount)}</td>
                      <td>{formatMoney(r.closing_amount)}</td>
                      <td className={r.difference !== 0 ? 'text-danger' : 'text-success'}>{formatMoney(r.difference)}</td>
                    </tr>
                  ))}
                  {(!historyData.registers || historyData.registers.length === 0) && <tr><td colSpan="4" className="text-center">Sin cortes registrados</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'movements' && (
        <div>
          <div className="section-header">
            <div className="filters">
              <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              <select value={movementsType} onChange={e => setMovementsType(e.target.value)}>
                <option value="">Todos los tipos</option>
                <option value="opening">Apertura</option>
                <option value="closing">Cierre</option>
                <option value="sale">Ventas</option>
                <option value="expense">Gastos</option>
                <option value="waste">Mermas</option>
                <option value="return">Devoluciones</option>
              </select>
              <button className="btn btn-sm btn-primary" onClick={loadMovements}>Actualizar</button>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr><th>Hora</th><th>Tipo</th><th>Descripción</th><th>Monto</th><th>Registró</th></tr>
              </thead>
              <tbody>
                {movements.map(m => (
                  <tr key={m.id}>
                    <td style={{fontSize:'0.8rem'}}>{formatDateTime(m.created_at)}</td>
                    <td>
                      <span className={`badge ${m.type === 'opening' ? 'badge-success' : m.type === 'closing' ? 'badge-warning' : m.type === 'sale' ? 'badge-primary' : m.type === 'expense' ? 'badge-danger' : m.type === 'waste' ? 'badge-danger' : 'badge-secondary'}`}>
                        {m.type === 'opening' ? 'Apertura' : m.type === 'closing' ? 'Cierre' : m.type === 'sale' ? 'Venta' : m.type === 'expense' ? 'Gasto' : m.type === 'waste' ? 'Merma' : m.type === 'return' ? 'Devolución' : m.type}
                      </span>
                    </td>
                    <td style={{fontSize:'0.85rem'}}>{m.description}</td>
                    <td><strong>{formatMoney(m.amount)}</strong></td>
                    <td style={{fontSize:'0.8rem'}}>{m.created_by_name || '-'}</td>
                  </tr>
                ))}
                {movements.length === 0 && <tr><td colSpan="5" className="text-center">Sin movimientos</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'expenses' && (
        <div>
          <div className="section-header">
            <div className="filters">
              <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              <button className="btn btn-sm btn-outline" onClick={loadExpenses}>Filtrar</button>
            </div>
            <button className="btn btn-primary" onClick={() => setShowExpenseForm(true)}>+ Nuevo Gasto</button>
          </div>

          <div className="table-responsive">
            <table className="table">
              <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Monto</th><th>Pago</th><th>Notas</th><th>Registró</th><th></th></tr></thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id}>
                    <td>{formatDate(e.created_at)}</td>
                    <td>{e.description}</td>
                    <td>{e.category || '-'}</td>
                    <td><strong>{formatMoney(e.amount)}</strong></td>
                    <td>{e.payment_method}</td>
                    <td style={{fontSize:'0.8rem'}}>{e.notes || '-'}</td>
                    <td>{e.created_by_name || '-'}</td>
                    <td>{user?.role === 'admin' && <button className="btn btn-sm btn-danger" onClick={async () => { if (await confirmDialog('Eliminar gasto?')) { await accounting.deleteExpense(e.id); loadExpenses() } }}>X</button>}</td>
                  </tr>
                ))}
                {expenses.length === 0 && <tr><td colSpan="8" className="text-center">Sin gastos registrados</td></tr>}
              </tbody>
            </table>
          </div>

          {showExpenseForm && (
            <div className="modal-overlay" onClick={() => setShowExpenseForm(false)} onKeyDown={modalKeys(() => setShowExpenseForm(false), handleAddExpense)}>
              <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                <h3>Nuevo Gasto</h3>
                <div className="form-group">
                  <label>Descripción *</label>
                  <input type="text" value={expenseForm.description} onChange={e => setExpenseForm({...expenseForm, description: e.target.value})} autoFocus />
                </div>
                <div className="form-group">
                  <label>Monto *</label>
                  <input type="number" step="0.01" value={expenseForm.amount} onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Categoría</label>
                  <input type="text" value={expenseForm.category} onChange={e => setExpenseForm({...expenseForm, category: e.target.value})} placeholder="Ej: Renta, Luz, Agua..." />
                </div>
                <div className="form-group">
                  <label>Método de pago</label>
                  <select value={expenseForm.payment_method} onChange={e => setExpenseForm({...expenseForm, payment_method: e.target.value})}>
                    <option value="cash">Efectivo</option>
                    <option value="card">Tarjeta</option>
                    <option value="transfer">Transferencia</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Notas</label>
                  <textarea value={expenseForm.notes} onChange={e => setExpenseForm({...expenseForm, notes: e.target.value})} rows="2"></textarea>
                </div>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setShowExpenseForm(false)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={handleAddExpense}>Guardar</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'reports' && (
        <div>
          <div className="filters" style={{marginBottom:'1rem'}}>
            <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={loadHistory}>Actualizar</button>
          </div>

          <div className="dashboard-grid">
            {profitData && (
              <>
                <div className="dash-card"><h4>Ingresos</h4><div className="dash-number text-success">{formatMoney(profitData.revenue)}</div></div>
                <div className="dash-card"><h4>Costo de Ventas</h4><div className="dash-number">{formatMoney(profitData.cost)}</div></div>
                <div className="dash-card"><h4>Utilidad Bruta</h4><div className="dash-number">{formatMoney(profitData.grossProfit)}</div></div>
                <div className="dash-card"><h4>Gastos</h4><div className="dash-number text-danger">{formatMoney(profitData.expenses)}</div></div>
                <div className="dash-card dash-card-wide"><h4>Utilidad Neta</h4><div className="dash-number" style={{color: profitData.netProfit >= 0 ? '#27ae60' : '#e74c3c'}}>{formatMoney(profitData.netProfit)}</div></div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Productos más vendidos</h3>
              <button className="btn btn-sm btn-outline" onClick={() => exportCSV(topProducts, 'productos_mas_vendidos.csv')}>Exportar CSV</button>
            </div>
            <div className="table-responsive">
              <table className="table">
                <thead><tr><th>#</th><th>Producto</th><th>Cantidad</th><th>Total</th></tr></thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={i}><td>{i + 1}</td><td>{p.product_name}</td><td>{p.total_qty}</td><td>{formatMoney(p.total_revenue)}</td></tr>
                  ))}
                  {topProducts.length === 0 && <tr><td colSpan="4" className="text-center">Sin datos</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Ventas por período</h3>
              <button className="btn btn-sm btn-outline" onClick={() => exportCSV(historyData?.sales || [], 'ventas_periodo.csv')}>Exportar CSV</button>
              <button className="btn btn-sm btn-outline" onClick={exportDetailedSales}>Exportar Detallado</button>
            </div>
            <div className="table-responsive">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Ventas</th><th>Total</th></tr></thead>
                <tbody>
                  {(historyData?.sales || []).map(s => (
                    <tr key={s.date}><td>{s.date}</td><td>{s.count}</td><td>{formatMoney(s.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'predictions' && (
        <PredictionsTab />
      )}

      {tab === 'events' && (
        <Events user={user} />
      )}

    </div>
  )
}

export { formatMoney }
