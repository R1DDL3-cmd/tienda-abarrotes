import React, { useState, useEffect, useRef, useCallback } from 'react'
import { customers } from '../api'
import { formatDateTime } from '../dateUtils'
import { modalKeys } from '../modalKeys'
import { useKeyboardLayer } from '../keyboard/input.js'
import { useActiveIndex } from '../keyboard/useActiveIndex.js'
import { STATES } from '../keyboard/registry.js'
import HelpBar from './HelpBar'
import KeyHelpSheet from './KeyHelpSheet'

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

  // --- Capa de teclado ---
  const [soloConSaldo, setSoloConSaldo] = useState(false)
  const [nuevoCliente, setNuevoCliente] = useState(null)
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
  const searchRef = useRef(null)
  const montoRef = useRef(null)

  const loadCustomers = useCallback(async (q) => {
    try {
      const res = await customers.list(q)
      setCustomerList(res.customers)
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => {
    loadCustomers('')
    const interval = setInterval(() => loadCustomers(search), 30000)
    return () => clearInterval(interval)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (q) => {
    setSearch(q)
    setActiveRow(0)
    loadCustomers(q)
  }

  const visibles = soloConSaldo ? customerList.filter(c => c.balance > 0) : customerList
  // Índice con ref: varias teclas seguidas llegan antes del siguiente render
  // (ver keyboard/useActiveIndex.js).
  const fila = useActiveIndex(visibles.length)
  const activeRow = fila.index
  const setActiveRow = fila.setIndex
  const clienteActivo = () => selectedCustomer || visibles[fila.current()] || null
  const activo = selectedCustomer || visibles[Math.min(activeRow, Math.max(0, visibles.length - 1))] || null

  const selectCustomer = useCallback(async (c) => {
    if (!c) return
    setSelectedCustomer(c)
    setLoading(true)
    setError('')
    try {
      const res = await customers.history(c.id)
      setCustomerHistory(res)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [])

  const abrirAbono = useCallback((c) => {
    const cliente = c || activo
    if (!cliente) { setError('Elige un cliente con ↑↓'); return }
    if (!selectedCustomer) setSelectedCustomer(cliente)
    // El monto llega con el saldo completo: Enter = liquidar.
    setPaymentAmount(cliente.balance > 0 ? cliente.balance.toFixed(2) : '')
    setPaymentMethod('cash')
    setPaymentNotes('')
    setShowPaymentModal(true)
  }, [activo, selectedCustomer])

  const handlePayment = async () => {
    const amount = parseFloat(paymentAmount)
    if (!amount || amount <= 0) { setError('Monto inválido'); return }
    try {
      const res = await customers.addPayment(selectedCustomer.id, {
        amount, payment_method: paymentMethod, notes: paymentNotes || null,
      })
      setSelectedCustomer(res.customer)
      setShowPaymentModal(false)
      setPaymentAmount('')
      setPaymentMethod('cash')
      setPaymentNotes('')
      const hist = await customers.history(res.customer.id)
      setCustomerHistory(hist)
      loadCustomers(search)
    } catch (e) {
      setError(e.message)   // el modal sigue abierto: no se pierde lo tecleado
      setTimeout(() => montoRef.current?.focus(), 30)
    }
  }

  const crearCliente = async () => {
    if (!nuevoCliente?.name?.trim()) { setError('El nombre es obligatorio'); return }
    try {
      await customers.create({
        name: nuevoCliente.name.trim(),
        phone: nuevoCliente.phone || null,
        credit_limit: parseFloat(nuevoCliente.credit_limit) || 0,
      })
      setNuevoCliente(null)
      loadCustomers(search)
    } catch (e) { setError(e.message) }
  }

  // ============================================================
  // TECLADO — las teclas salen del registro; aquí solo el comportamiento
  // ============================================================
  const anyModal = !!(nuevoCliente || showKeyboardHelp)
  const estado = showPaymentModal ? STATES.ABONO_CLIENTE : anyModal ? STATES.MODAL : STATES.CLIENTES

  const sumarAlMonto = (n) => setPaymentAmount(v => ((parseFloat(v) || 0) + n).toFixed(2))

  const handlers = {
    sys_help: () => setShowKeyboardHelp(true),
    cli_search: () => { setSelectedCustomer(null); setCustomerHistory(null); setTimeout(() => searchRef.current?.focus(), 20) },
    cli_pay: () => abrirAbono(clienteActivo()),
    cli_history: () => selectCustomer(clienteActivo()),
    cli_new: () => setNuevoCliente({ name: search, phone: '', credit_limit: '' }),
    cli_debtors: () => { setSoloConSaldo(v => !v); setActiveRow(0) },
    cli_row_prev: () => fila.move(-1),
    cli_row_next: () => fila.move(1),
    // Abono: mismas teclas que el cobro del POS (clase "pago")
    cobro_cash: () => setPaymentMethod('cash'),
    cobro_card: () => setPaymentMethod('card'),
    cobro_transfer: () => setPaymentMethod('transfer'),
    cobro_d20: () => sumarAlMonto(20),
    cobro_d50: () => sumarAlMonto(50),
    cobro_d100: () => sumarAlMonto(100),
    cobro_d200: () => sumarAlMonto(200),
    cobro_d500: () => sumarAlMonto(500),
  }

  useKeyboardLayer({
    state: estado,
    role: user?.role,
    handlers,
    commandLineRef: searchRef,
    isCommandLineEmpty: () => !search,
  })

  // Enter avanza, Esc retrocede.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      const avanza = e.key === 'Enter'

      if (showKeyboardHelp) { e.preventDefault(); setShowKeyboardHelp(false); return }
      if (nuevoCliente) return                       // lo maneja modalKeys
      if (showPaymentModal) {
        e.preventDefault()
        if (avanza) handlePayment()
        else { setShowPaymentModal(false); setError('') }
        return
      }
      if (selectedCustomer) {
        e.preventDefault()
        if (avanza) abrirAbono(selectedCustomer)     // en la ficha, Enter abona
        else { setSelectedCustomer(null); setCustomerHistory(null) }
        return
      }
      e.preventDefault()
      if (avanza) selectCustomer(clienteActivo())    // en la lista, Enter abre la ficha
      else if (search) { setSearch(''); loadCustomers('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showKeyboardHelp, nuevoCliente, showPaymentModal, selectedCustomer, activo, search,
      abrirAbono, selectCustomer, loadCustomers])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showPaymentModal) setTimeout(() => { montoRef.current?.focus(); montoRef.current?.select() }, 40)
  }, [showPaymentModal])

  useEffect(() => {
    const fila = document.querySelector('tr.row-active')
    if (fila && fila.scrollIntoView) fila.scrollIntoView({ block: 'nearest' })
  }, [activeRow, visibles.length])

  return (
    <div className="inventory-page">
      <div className="page-header">
        <h2>Clientes {soloConSaldo && <span className="badge badge-warning">solo con saldo</span>}</h2>
        <div className="header-actions">
          <button className="btn btn-outline btn-sm" onClick={() => setSoloConSaldo(v => !v)}>
            {soloConSaldo ? 'Ver todos' : 'Solo con saldo'} <kbd>F9</kbd>
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setNuevoCliente({ name: search, phone: '', credit_limit: '' })}>
            Nuevo cliente <kbd>Ins</kbd>
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}

      <div className="filters">
        <input ref={searchRef} type="text" className="input" placeholder="Buscar cliente por nombre o teléfono... (F2)"
          value={search} onChange={(e) => handleSearch(e.target.value)} />
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
                <div className="pay-figure">
                  <span className="pay-figure-label">Saldo</span>
                  <span className={`money money-sub ${selectedCustomer.balance > 0 ? 'text-danger' : 'text-success'}`}>
                    {formatMoney(selectedCustomer.balance)}
                  </span>
                </div>
                {selectedCustomer.credit_limit > 0 && <p style={{margin:0, fontSize:'0.8rem'}}>Límite: {formatMoney(selectedCustomer.credit_limit)}</p>}
              </div>
            </div>
            <div style={{marginTop:'0.8rem', display:'flex', gap:'0.5rem'}}>
              <button className="btn btn-primary btn-sm" onClick={() => abrirAbono(selectedCustomer)}>Registrar pago <kbd>Enter</kbd></button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedCustomer(null); setCustomerHistory(null) }}>Volver a la lista <kbd>Esc</kbd></button>
            </div>
          </div>

          <div className="card" style={{marginBottom:'1rem'}}>
            <h3>Ventas a crédito</h3>
            <div className="table-responsive">
              <table className="table">
                <thead><tr><th>#</th><th>Fecha</th><th>Total</th><th>Detalle pago</th></tr></thead>
                <tbody>
                  {customerHistory.sales.map(s => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td>{formatDateTime(s.created_at)}</td>
                      <td className="money">{formatMoney(s.total)}</td>
                      <td style={{fontSize:'0.8rem'}}>{s.payment_method}</td>
                    </tr>
                  ))}
                  {customerHistory.sales.length === 0 && <tr><td colSpan="4" className="text-center">Sin ventas registradas</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>Pagos y abonos</h3>
            <div className="table-responsive">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Monto</th><th>Método</th><th>Notas</th></tr></thead>
                <tbody>
                  {customerHistory.payments.map(p => (
                    <tr key={p.id}>
                      <td>{formatDateTime(p.created_at)}</td>
                      <td className={`money ${p.amount > 0 ? 'text-success' : 'text-danger'}`}>{formatMoney(p.amount)}</td>
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
              <tr><th>Nombre</th><th>Teléfono</th><th>Saldo</th><th>Límite crédito</th><th></th></tr>
            </thead>
            <tbody>
              {visibles.map((c, idx) => (
                <tr key={c.id}
                    className={`${c.balance > 0 ? 'row-warning' : ''} ${idx === Math.min(activeRow, visibles.length - 1) ? 'row-active' : ''}`}
                    onClick={() => setActiveRow(idx)}
                    onDoubleClick={() => selectCustomer(c)}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.phone || '-'}</td>
                  <td className={`money ${c.balance > 0 ? 'text-danger' : ''}`}>{formatMoney(c.balance)}</td>
                  <td className="money">{formatMoney(c.credit_limit)}</td>
                  <td className="actions-cell">
                    <button className="btn btn-sm btn-outline" onClick={() => selectCustomer(c)}>Ver</button>
                    <button className="btn btn-sm btn-primary" onClick={() => abrirAbono(c)}>Abonar</button>
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && <tr><td colSpan="5" className="text-center">Sin clientes{soloConSaldo ? ' con saldo' : ' registrados'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showPaymentModal && selectedCustomer && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Registrar pago — {selectedCustomer.name}</h3>
            <div className="pay-figures">
              <div className="pay-figure">
                <span className="pay-figure-label">Saldo actual</span>
                <span className={`money money-pay ${selectedCustomer.balance > 0 ? 'text-danger' : ''}`}>{formatMoney(selectedCustomer.balance)}</span>
              </div>
            </div>
            <div className="form-group">
              <label>Monto (Enter = liquidar el saldo)</label>
              <input ref={montoRef} className="input-money" type="number" step="0.01" value={paymentAmount}
                onChange={e => setPaymentAmount(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Método de pago</label>
              <div style={{display:'flex', gap:'0.35rem'}}>
                {[['cash','F1 Efectivo'], ['card','F2 Tarjeta'], ['transfer','F3 Transferencia']].map(([v, l]) => (
                  <button key={v} className={`btn btn-sm ${paymentMethod === v ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => setPaymentMethod(v)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Notas</label>
              <input type="text" value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} placeholder="Opcional" />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowPaymentModal(false); setError('') }}>Cancelar <kbd>Esc</kbd></button>
              <button className="btn btn-primary" onClick={handlePayment}>Registrar <kbd>Enter</kbd></button>
            </div>
          </div>
        </div>
      )}

      {nuevoCliente && (
        <div className="modal-overlay" onKeyDown={modalKeys(() => setNuevoCliente(null), crearCliente)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Nuevo cliente</h3>
            <div className="form-group">
              <label>Nombre *</label>
              <input autoFocus className="input" value={nuevoCliente.name}
                onChange={e => setNuevoCliente(c => ({ ...c, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Teléfono</label>
              <input className="input" value={nuevoCliente.phone}
                onChange={e => setNuevoCliente(c => ({ ...c, phone: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Límite de crédito</label>
              <input className="input" type="number" step="0.01" value={nuevoCliente.credit_limit}
                onChange={e => setNuevoCliente(c => ({ ...c, credit_limit: e.target.value }))} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setNuevoCliente(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={crearCliente}>Crear</button>
            </div>
          </div>
        </div>
      )}

      {showKeyboardHelp && (
        <KeyHelpSheet state={estado} role={user?.role} titulo="Teclas de Clientes"
          onClose={() => setShowKeyboardHelp(false)} />
      )}

      <HelpBar state={estado} role={user?.role} />
    </div>
  )
}
