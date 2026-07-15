import React, { useState, useEffect } from 'react'
import { customers } from '../api'

function formatMoney(n) {
  return '$' + parseFloat(n || 0).toFixed(2)
}

export default function Customers({ user, onLogout }) {
  const [search, setSearch] = useState('')
  const [customerList, setCustomerList] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [customerHistory, setCustomerHistory] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentNotes, setPaymentNotes] = useState('')

  const loadCustomers = async (q) => {
    try {
      const res = await customers.list(q)
      setCustomerList(res.customers)
    } catch (e) { setError(e.message) }
  }

  useEffect(() => { loadCustomers(''); const interval = setInterval(() => loadCustomers(search), 30000); return () => clearInterval(interval) }, [])

  const handleSearch = (q) => {
    setSearch(q)
    loadCustomers(q)
  }

  const selectCustomer = async (c) => {
    setSelectedCustomer(c)
    setLoading(true)
    setError('')
    try {
      const res = await customers.history(c.id)
      setCustomerHistory(res)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const handlePayment = async () => {
    const amount = parseFloat(paymentAmount)
    if (!amount || amount <= 0) { setError('Monto inválido'); return }
    try {
      const res = await customers.addPayment(selectedCustomer.id, {
        amount,
        payment_method: paymentMethod,
        notes: paymentNotes || null
      })
      setSelectedCustomer(res.customer)
      setShowPaymentModal(false)
      setPaymentAmount('')
      setPaymentMethod('cash')
      setPaymentNotes('')
      const hist = await customers.history(res.customer.id)
      setCustomerHistory(hist)
    } catch (e) { setError(e.message) }
  }

  const totalCreditSales = customerHistory?.sales?.reduce((sum, s) => {
    const credit = (s.payment_details || '').match(/credit:\s*\$([\d.]+)/)
    return sum + (credit ? parseFloat(credit[1]) : 0)
  }, 0) || 0

  const totalPayments = customerHistory?.payments?.reduce((sum, p) => {
    if (p.payment_method !== 'credit') return sum + (p.amount || 0)
    return sum
  }, 0) || 0

  return (
    <div className="inventory-page">
      <div className="page-header">
        <h2>Clientes</h2>
        <div className="header-actions">
        </div>
      </div>

      {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}

      <div className="filters">
        <input type="text" className="input" placeholder="Buscar cliente por nombre o teléfono..." value={search} onChange={(e) => handleSearch(e.target.value)} />
      </div>

      {selectedCustomer && customerHistory ? (
        <div>
          <div className="card" style={{marginBottom:'1rem'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'1rem'}}>
              <div>
                <h3 style={{margin:'0 0 0.3rem 0'}}>{selectedCustomer.name}</h3>
                {selectedCustomer.phone && <p style={{margin:0, fontSize:'0.9rem'}}>Tel: {selectedCustomer.phone}</p>}
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:'1.1rem'}}><strong>Saldo:</strong> <span className={selectedCustomer.balance > 0 ? 'text-danger' : 'text-success'}>{formatMoney(selectedCustomer.balance)}</span></div>
                {selectedCustomer.credit_limit > 0 && <p style={{margin:0, fontSize:'0.8rem'}}>Límite: {formatMoney(selectedCustomer.credit_limit)}</p>}
              </div>
            </div>
            <div style={{marginTop:'0.8rem', display:'flex', gap:'0.5rem'}}>
              <button className="btn btn-primary btn-sm" onClick={() => { setShowPaymentModal(true); setPaymentAmount('') }}>Registrar Pago</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedCustomer(null); setCustomerHistory(null) }}>Volver a la lista</button>
            </div>
          </div>

          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Ventas a Crédito</h3>
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>Fecha</th><th>Total</th><th>Detalle Pago</th></tr>
                </thead>
                <tbody>
                  {customerHistory.sales.map(s => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td>{new Date(s.created_at).toLocaleString('es-MX')}</td>
                      <td>{formatMoney(s.total)}</td>
                      <td style={{fontSize:'0.8rem'}}>{s.payment_method}</td>
                    </tr>
                  ))}
                  {customerHistory.sales.length === 0 && <tr><td colSpan="4" className="text-center">Sin ventas registradas</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>Pagos y Abonos</h3>
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr><th>Fecha</th><th>Monto</th><th>Método</th><th>Notas</th></tr>
                </thead>
                <tbody>
                  {customerHistory.payments.map(p => (
                    <tr key={p.id}>
                      <td>{new Date(p.created_at).toLocaleString('es-MX')}</td>
                      <td className={p.amount > 0 ? 'text-success' : 'text-danger'}>{formatMoney(p.amount)}</td>
                      <td>{p.payment_method}</td>
                      <td style={{fontSize:'0.8rem'}}>{p.notes || '-'}</td>
                    </tr>
                  ))}
                  {customerHistory.payments.length === 0 && <tr><td colSpan="4" className="text-center">Sin pagos registrados</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Saldo</th>
                <th>Límite Crédito</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customerList.map(c => (
                <tr key={c.id} className={c.balance > 0 ? 'row-warning' : ''}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.phone || '-'}</td>
                  <td className={c.balance > 0 ? 'text-danger' : ''}>{formatMoney(c.balance)}</td>
                  <td>{formatMoney(c.credit_limit)}</td>
                  <td>
                    <button className="btn btn-sm btn-outline" onClick={() => selectCustomer(c)}>Ver</button>
                  </td>
                </tr>
              ))}
              {customerList.length === 0 && <tr><td colSpan="5" className="text-center">Sin clientes registrados</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showPaymentModal && (
        <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Registrar Pago - {selectedCustomer.name}</h3>
            <p>Saldo actual: <strong className={selectedCustomer.balance > 0 ? 'text-danger' : ''}>{formatMoney(selectedCustomer.balance)}</strong></p>
            <div className="form-group">
              <label>Monto *</label>
              <input type="number" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label>Método de Pago</label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="transfer">Transferencia</option>
              </select>
            </div>
            <div className="form-group">
              <label>Notas</label>
              <input type="text" value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} placeholder="Opcional" />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowPaymentModal(false); setError('') }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handlePayment}>Registrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
