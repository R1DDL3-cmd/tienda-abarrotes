import React, { useState, useEffect, useRef, useCallback } from 'react'
import { sales, products, customers, network, accounting, withdrawals, hardware, settings as settingsApi } from '../api'

function formatMoney(n) {
  return '$' + parseFloat(n || 0).toFixed(2)
}

export default function POS({ user, onLogout }) {
  const [barcode, setBarcode] = useState('')
  const [cart, setCart] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showSearch, setShowSearch] = useState(false)
  const [paymentModal, setPaymentModal] = useState(false)
  const [payments, setPayments] = useState([{ method: 'cash', amount: 0 }])
  const [customerModal, setCustomerModal] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerList, setCustomerList] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [totalDiscount, setTotalDiscount] = useState(0)
  const [saleDone, setSaleDone] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [todaySales, setTodaySales] = useState({ count: 0, total_sales: 0 })
  const [networkInfo, setNetworkInfo] = useState(null)
  const [storeInfo, setStoreInfo] = useState({ store_name: 'Tienda de Abarrotes', store_address: '', store_phone: '', ticket_footer: '¡Gracias por su compra!' })
  const [historyModal, setHistoryModal] = useState(false)
  const [salesHistory, setSalesHistory] = useState([])
  const [cancelModal, setCancelModal] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [saleDetail, setSaleDetail] = useState(null)
  const [showCashierExpenseModal, setShowCashierExpenseModal] = useState(false)
  const [cashierExpenseForm, setCashierExpenseForm] = useState({ description: '', amount: '', category: '', notes: '' })
  const [newCustomerModal, setNewCustomerModal] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [registerData, setRegisterData] = useState(null)
  const [currentSession, setCurrentSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [showStartDayModal, setShowStartDayModal] = useState(false)
  const [startDayAmount, setStartDayAmount] = useState('')
  const [showEndDayModal, setShowEndDayModal] = useState(false)
  const [endDayAmount, setEndDayAmount] = useState('')
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false)
  const [withdrawalAmount, setWithdrawalAmount] = useState('')
  const [withdrawalReason, setWithdrawalReason] = useState('')
  const [showWithdrawalsList, setShowWithdrawalsList] = useState(false)
  const [withdrawalsList, setWithdrawalsList] = useState([])
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showCashCountModal, setShowCashCountModal] = useState(false)
  const [cashCountAmount, setCashCountAmount] = useState('')
  const [showSecurityModal, setShowSecurityModal] = useState(false)
  const [securityBarcode, setSecurityBarcode] = useState('')
  const [securityQty, setSecurityQty] = useState(1)
  const [securityPin, setSecurityPin] = useState('')
  const barcodeRef = useRef(null)
  const searchRef = useRef(null)
  const processedRef = useRef(false)
  const cashCountRef = useRef(null)
  const paymentRef = useRef(null)
  const securityRef = useRef(null)
  const [clock, setClock] = useState(new Date())

  useEffect(() => { const id = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(id) }, [])
  useEffect(() => { if (error) { const t = setTimeout(() => setError(''), 7000); return () => clearTimeout(t) } }, [error])
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t) } }, [success])
  useEffect(() => { network.info().then(setNetworkInfo).catch(() => {}) }, [])
  useEffect(() => { settingsApi.getStore().then(setStoreInfo).catch(() => {}) }, [])
  useEffect(() => { loadTodaySales() }, [])

  const loadRegister = useCallback(async () => {
    try {
      const reg = await accounting.cashRegister()
      setRegisterData(reg)
    } catch (e) { setError('Error al cargar caja: ' + e.message) }
  }, [])

  const loadMySession = useCallback(async () => {
    try {
      const res = await accounting.mySession()
      setCurrentSession(res.session)
    } catch (e) {}
    setSessionLoading(false)
  }, [])

  useEffect(() => {
    loadRegister()
    const interval = setInterval(loadRegister, 30000)
    return () => clearInterval(interval)
  }, [loadRegister])

  useEffect(() => { loadMySession() }, [loadMySession])

  useEffect(() => {
    if (sessionLoading) return
    if (currentSession) return
    if (registerData === null) return
    if (showStartDayModal) return
    setStartDayAmount('')
    setShowStartDayModal(true)
  }, [registerData, currentSession, sessionLoading, showStartDayModal])

  useEffect(() => {
    if (showSearch && searchRef.current) searchRef.current.focus()
  }, [showSearch])

  useEffect(() => {
    const onFocus = () => {
      if (barcodeRef.current && !showStartDayModal && !paymentModal && !customerModal && !historyModal && !showEndDayModal && !showWithdrawalModal && !showWithdrawalsList && !showLogoutConfirm && !showCashCountModal && !cancelModal && !newCustomerModal && !showSecurityModal) {
        barcodeRef.current.focus()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [showStartDayModal, showEndDayModal, showWithdrawalModal, showWithdrawalsList, showLogoutConfirm, showCashCountModal, paymentModal, customerModal, historyModal, cancelModal, newCustomerModal, showSecurityModal])

  useEffect(() => {
    const noModal = !showStartDayModal && !paymentModal && !customerModal && !historyModal && !showEndDayModal && !showWithdrawalModal && !showWithdrawalsList && !showLogoutConfirm && !showCashCountModal && !cancelModal && !newCustomerModal && !showSecurityModal
    if (noModal) {
      setTimeout(() => { if (barcodeRef.current) barcodeRef.current.focus() }, 50)
    }
  }, [showStartDayModal, showEndDayModal, showWithdrawalModal, showWithdrawalsList, showLogoutConfirm, showCashCountModal, paymentModal, customerModal, historyModal, cancelModal, newCustomerModal, showSecurityModal, saleDone, error, success])

  useEffect(() => {
    if (showCashCountModal) {
      setTimeout(() => { if (cashCountRef.current) cashCountRef.current.focus() }, 100)
    }
  }, [showCashCountModal])

  useEffect(() => {
    if (paymentModal) {
      setTimeout(() => { if (paymentRef.current) paymentRef.current.focus() }, 100)
    }
  }, [paymentModal])

  const loadTodaySales = async () => {
    try {
      const res = await sales.today()
      setTodaySales(res.totals)
      setSalesHistory(res.sales)
    } catch (e) {}
  }

  const loadSaleDetails = async (id) => {
    try {
      const data = await sales.get(id)
      setSaleDetail(data)
    } catch (e) {
      setError('Error al cargar detalles de venta')
    }
  }

  const subtotal = cart.reduce((sum, item) => sum + (item.unit_price * item.quantity) - (item.discount || 0), 0)
  const total = subtotal - totalDiscount

  // Atajos de teclado para las acciones más frecuentes del día a día:
  // buscar producto, cobrar, seleccionar cliente (fiado) e historial.
  // Se ignoran mientras el usuario escribe en cualquier input que no sea el
  // de código de barras, para no interferir con formularios ni con el
  // escaneo normal (los lectores de código de barras no envían teclas F).
  useEffect(() => {
    const noModal = !showStartDayModal && !paymentModal && !customerModal && !historyModal && !showEndDayModal && !showWithdrawalModal && !showWithdrawalsList && !showLogoutConfirm && !showCashCountModal && !cancelModal && !newCustomerModal && !showSecurityModal
    const onKeyDown = (e) => {
      const tag = e.target.tagName
      const isTypingElsewhere = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && e.target !== barcodeRef.current
      if (isTypingElsewhere) return
      if (e.key === 'F2' && noModal) { e.preventDefault(); setShowSearch(true) }
      else if (e.key === 'F4' && noModal) { e.preventDefault(); openPayment() }
      else if (e.key === 'F6' && noModal) { e.preventDefault(); setCustomerModal(true) }
      else if (e.key === 'F8' && noModal) { e.preventDefault(); setHistoryModal(true) }
      else if (e.key === 'Escape' && showSearch) { setShowSearch(false); setSearchQuery('') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showStartDayModal, paymentModal, customerModal, historyModal, showEndDayModal, showWithdrawalModal, showWithdrawalsList, showLogoutConfirm, showCashCountModal, cancelModal, newCustomerModal, showSecurityModal, showSearch, cart, total])

  const handleBarcode = useCallback(async (value) => {
    if (!value) return
    let qty = 1
    let code = value
    const match = value.match(/^(\d+)[*xX](.+)/)
    if (match) {
      qty = parseInt(match[1])
      code = match[2]
    }
    try {
      const product = await products.getByBarcode(code)
      addToCart(product, qty)
      setBarcode('')
      setError('')
    } catch (e) {
      setSecurityBarcode(code)
      setSecurityQty(qty)
      setSecurityPin('')
      setShowSecurityModal(true)
      setBarcode('')
    }
  }, [])

  const handleSecurityConfirm = () => {
    const storedPin = localStorage.getItem('securityPin') || '1234'
    if (securityPin === storedPin) {
      setShowSecurityModal(false)
      setError('')
    } else {
      setError('Codigo de seguridad incorrecto')
      setSecurityPin('')
      setTimeout(() => { if (securityRef.current) securityRef.current.focus() }, 50)
    }
  }

    const handleBarcodeChange = (e) => {
    const raw = e.target.value
    if (raw.includes('\n') || raw.includes('\r')) {
      if (processedRef.current) {
        processedRef.current = false
        setBarcode('')
        return
      }
      const code = raw.replace(/[\n\r]/g, '').trim()
      if (code) handleBarcode(code)
      setBarcode('')
      // Reset processedRef after handling barcode to allow future scans
      processedRef.current = false
    } else {
      setBarcode(raw)
    }
  }

  const addToCart = (product, qty) => {
    const quantity = qty || 1
    setCart(prev => {
      const existing = prev.find(i => i.product_id === product.id)
      if (existing && product.unit_type !== 'kg' && product.unit_type !== 'l') {
        return prev.map(i => i.product_id === product.id
          ? { ...i, quantity: i.quantity + quantity, subtotal: (i.quantity + quantity) * i.unit_price - i.discount }
          : i
        )
      }
      const itemQty = quantity
      return [...prev, {
        product_id: product.id,
        product_name: product.name,
        barcode: product.barcode,
        unit_price: product.sale_price,
        quantity: itemQty,
        discount: 0,
        subtotal: itemQty * product.sale_price,
        stock: product.stock,
        unit_type: product.unit_type || 'unit'
      }]
    })
  }

  const updateCartItem = (id, field, value) => {
    setCart(prev => prev.map(i => {
      if (i.product_id !== id) return i
      if (user?.role === 'cashier' && (field === 'unit_price' || field === 'discount')) return i
      const updated = { ...i, [field]: value }
      updated.subtotal = (updated.quantity * updated.unit_price) - updated.discount
      return updated
    }))
  }

  const removeFromCart = (id) => setCart(prev => prev.filter(i => i.product_id !== id))

  const handleSearch = async (q) => {
    setSearchQuery(q)
    if (q.length < 2) { setSearchResults([]); return }
    try {
      const res = await products.search(q)
      setSearchResults(res.products)
    } catch (e) {}
  }

  const selectSearchResult = (product) => {
    addToCart(product)
    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
    barcodeRef.current?.focus()
  }

  const openPayment = () => {
    if (cart.length === 0) { setError('Agregue productos al carrito'); return }
    setPayments([{ method: 'cash', amount: total }])
    setPaymentModal(true)
    setError('')
  }

  const updatePayment = (index, field, value) => {
    setPayments(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p))
  }

  const addPaymentMethod = () => {
    const remaining = total - payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0)
    if (remaining <= 0) return
    setPayments(prev => [...prev, { method: 'credit', amount: remaining }])
  }

  const removePayment = (index) => {
    if (payments.length <= 1) return
    setPayments(prev => prev.filter((_, i) => i !== index))
  }

  const getPaymentTotal = () => payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0)
  const paymentDiff = getPaymentTotal() - total
  const change = payments.some(p => p.method === 'cash') && paymentDiff >= 0 ? paymentDiff : 0

  const handleCompleteSale = async () => {
    if (!currentSession) {
      setError('Debe iniciar su turno antes de realizar ventas')
      return
    }
    const totalPaid = getPaymentTotal()
    if (totalPaid < total) {
      setError('El total de pagos debe cubrir el monto de la venta')
      return
    }

    try {
      const res = await sales.create({
        items: cart.map(i => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          discount: i.discount
        })),
        payments: payments.map(p => ({ method: p.method, amount: parseFloat(p.amount) || 0 })),
        discount: totalDiscount,
        customer_id: selectedCustomer?.id || null,
        customer_name: selectedCustomer?.name || null
      })
      setSaleDone({ sale: res.sale, items: res.items })
      setCart([])
      setTotalDiscount(0)
      setSelectedCustomer(null)
      setPaymentModal(false)
      loadTodaySales()
      loadRegister()
      setSuccess('Venta completada exitosamente')
      setTimeout(() => setSuccess(''), 3000)
      hardware.openDrawer().catch(() => {})
    } catch (e) {
      setError(e.message)
    }
  }

  const handleStartDay = async () => {
    try {
      const amount = parseFloat(startDayAmount) || 0
      // If first opening of the day, set cash_register opening_amount too
      if (registerData && parseFloat(registerData.opening_amount) === 0) {
        await accounting.updateCashRegister({ opening_amount: amount })
      }
      // Create a session for the current user
      const res = await accounting.openSession({ opening_amount: amount })
      if (!res.session) {
        setError('Error al crear sesión. Intente de nuevo.')
        return
      }
      setCurrentSession(res.session)
      setShowStartDayModal(false)
      await loadRegister()
      loadTodaySales()
      hardware.openDrawer().catch(() => {})
    } catch (e) {
      setError(e.message)
    }
  }

  const PAYMENT_METHOD_LABELS = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', credit: 'Fiado', fiado: 'Fiado' }

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  const printTicket = (saleData, items) => {
    if (!saleData) return
    const w = window.open('', '_blank', 'width=380,height=600')
    const ticketItems = items || []
    const itemsHtml = ticketItems.map(i => {
      const isWeight = i.unit_type === 'kg' || i.unit_type === 'l'
      const unitLabel = isWeight ? (i.unit_type === 'kg' ? ' kg' : ' L') : ''
      return `
      <tr>
        <td class="product-name">${escapeHtml(i.product_name)}</td>
        <td style="text-align:center">${i.quantity}${unitLabel}</td>
        <td style="text-align:right">${formatMoney(i.unit_price)}</td>
        <td style="text-align:right">${formatMoney(i.subtotal)}</td>
      </tr>
    `}).join('')

    // sale.payment_method ya viene como texto combinado ("cash: $50.00, credit: $20.00")
    // desde el backend; se traduce cada método a español conservando el monto.
    const paymentLine = (saleData.payment_method || '')
      .split(',')
      .map(part => {
        const [method, amount] = part.split(':').map(s => s.trim())
        const label = PAYMENT_METHOD_LABELS[method] || method
        return amount ? `${label}: ${amount}` : label
      })
      .join(' + ')

    const isCredit = saleData.customer_id && /credit|fiado/.test(saleData.payment_method || '')
    const balanceHtml = isCredit && saleData.customer_balance != null ? `
      <div class="line"></div>
      <div class="center" style="font-weight:bold">
        <p>SALDO PENDIENTE DE ${escapeHtml(saleData.customer_name || 'CLIENTE')}:</p>
        <p style="font-size:14px">${formatMoney(saleData.customer_balance)}</p>
      </div>
    ` : ''

    const storeHeader = `
      <h3>${escapeHtml(storeInfo.store_name)}</h3>
      ${storeInfo.store_address ? `<p>${escapeHtml(storeInfo.store_address)}</p>` : ''}
      ${storeInfo.store_phone ? `<p>Tel: ${escapeHtml(storeInfo.store_phone)}</p>` : ''}
    `

    w.document.write(`
      <html><head><title>Ticket - Venta #${saleData.id}</title>
      <style>
        body { font-family: 'Courier New', monospace; font-size: 12px; width: 58mm; margin: 0; padding: 5px; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { padding: 2px 0; overflow-wrap: break-word; word-break: break-word; }
        .product-name { max-width: 0; }
        .center { text-align: center; }
        .right { text-align: right; }
        .line { border-top: 1px dashed #000; margin: 5px 0; }
        h3 { margin: 5px 0; overflow-wrap: break-word; }
        p { margin: 2px 0; }
        @media print { body { width: 58mm; } }
      </style></head><body>
      <div class="center">
        ${storeHeader}
        <p>Ticket de Venta #${saleData.id}</p>
        <p>${new Date(saleData.created_at.replace(' ', 'T') + 'Z').toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</p>
        <p>Atendió: ${escapeHtml(saleData.created_by_name || user?.name)}</p>
        ${saleData.customer_name ? `<p>Cliente: ${escapeHtml(saleData.customer_name)}</p>` : ''}
      </div>
      <div class="line"></div>
      <table>
        <colgroup><col style="width:46%"><col style="width:16%"><col style="width:19%"><col style="width:19%"></colgroup>
        <tr><th style="text-align:left">Producto</th><th>Cant</th><th style="text-align:right">Precio</th><th style="text-align:right">Subtotal</th></tr>
        ${itemsHtml}
      </table>
      <div class="line"></div>
      <div class="right">
        ${saleData.discount > 0 ? `<p>Descuento: -${formatMoney(saleData.discount)}</p>` : ''}
        <p><strong>TOTAL: ${formatMoney(saleData.total)}</strong></p>
        <p>Pago: ${escapeHtml(paymentLine)}</p>
      </div>
      ${balanceHtml}
      <div class="line"></div>
      <div class="center">
        <p>${escapeHtml(storeInfo.ticket_footer)}</p>
      </div>
      <script>window.print()</script>
      </body></html>
    `)
    w.document.close()
  }

  const handlePrintTicket = () => {
    if (!saleDone) return
    printTicket(saleDone.sale, saleDone.items)
  }


  const handleNewCustomer = async () => {
    if (!newCustomerName.trim()) { setError('Nombre del cliente requerido'); return }
    try {
      const res = await customers.create({ name: newCustomerName.trim() })
      setSelectedCustomer(res)
      setNewCustomerModal(false)
      setNewCustomerName('')
      setCustomerModal(false)
      setSuccess('Cliente creado')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const handleCancelSale = async (saleId) => {
    if (!cancelReason.trim()) { setError('El motivo es obligatorio'); return }
    try {
      await sales.cancel(saleId, cancelReason)
      setCancelModal(null)
      setCancelReason('')
      loadTodaySales()
      setSuccess('Venta cancelada')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleEndDayClick = () => {
    setEndDayAmount('')
    setShowEndDayModal(true)
  }

  const handleEndDaySubmit = async () => {
    try {
      await accounting.updateCashRegister({ closing_amount: parseFloat(endDayAmount) || 0 })
      setShowEndDayModal(false)
      await loadRegister()
      setSuccess('Cierre de día registrado')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleWithdrawalSubmit = async () => {
    const amount = parseFloat(withdrawalAmount)
    if (!amount || amount <= 0) { setError('Ingrese un monto válido'); return }
    if (!withdrawalReason.trim()) { setError('Ingrese el motivo del retiro'); return }
    try {
      await withdrawals.create({ amount, reason: withdrawalReason.trim() })
      setShowWithdrawalModal(false)
      setWithdrawalAmount('')
      setWithdrawalReason('')
      loadRegister()
      setSuccess('Retiro registrado')
      setTimeout(() => setSuccess(''), 3000)
      hardware.openDrawer().catch(() => {})
    } catch (e) { setError(e.message) }
  }

  const loadWithdrawals = async () => {
    try {
      const res = await withdrawals.list()
      setWithdrawalsList(res.withdrawals || [])
    } catch (_) {}
  }

  const handleCancelWithdrawal = async (id) => {
    try {
      await withdrawals.cancel(id)
      loadWithdrawals()
      loadRegister()
      setSuccess('Retiro cancelado')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const handleLogout = () => {
    setShowLogoutConfirm(true)
  }

  const handleLogoutConfirm = async () => {
    setShowLogoutConfirm(false)
    if (!currentSession) return onLogout()
    setCashCountAmount('')
    setShowCashCountModal(true)
  }

  const handleCashierExpenseSubmit = async () => {
    if (!cashierExpenseForm.description || !cashierExpenseForm.amount) { setError('Descripción y monto requeridos'); return }
    try {
      await accounting.addExpense({
        description: cashierExpenseForm.description,
        amount: parseFloat(cashierExpenseForm.amount),
        category: cashierExpenseForm.category || null,
        notes: cashierExpenseForm.notes || null
      })
      setCashierExpenseForm({ description: '', amount: '', category: '', notes: '' })
      setShowCashierExpenseModal(false)
      loadRegister()
      setSuccess('Gasto registrado')
      setTimeout(() => setSuccess(''), 3000)
      hardware.openDrawer().catch(() => {})
    } catch (e) { setError(e.message) }
  }

  const handleCashCountSubmit = async () => {
    try {
      if (currentSession) {
        try { await accounting.closeSession(currentSession.id, { closing_amount: parseFloat(cashCountAmount) || 0 }) } catch (e) { setError(e.message) }
      }
    } catch (_) {}
    setShowCashCountModal(false)
    onLogout()
  }

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div className="pos-header-left">
          <h1>Punto de Venta</h1>
          <span className="header-user">{user?.name}</span>
          <span className="header-today">{clock.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' })} {clock.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Mexico_City' })}</span>
          {registerData && (
            <span className="header-register-info">
              ${parseFloat((currentSession?.opening_amount ?? registerData.opening_amount) || 0).toFixed(0)} ini | ${parseFloat(registerData.totalExpenses || 0).toFixed(0)} gas | ${parseFloat(registerData.totalSales || 0).toFixed(0)} ven
            </span>
          )}
        </div>
        <div className="pos-header-right">
          <div className="btn-group">
            {user?.role === 'admin' && (
              <>
                <button className="btn btn-sm btn-outline" onClick={() => window.location.hash = '#/inventory'}>Inventario</button>
                <button className="btn btn-sm btn-outline" onClick={() => window.location.hash = '#/accounting'}>Contabilidad</button>
                <button className="btn btn-sm btn-outline" onClick={() => window.location.hash = '#/customers'}>Clientes</button>
              </>
            )}
            {user?.role === 'cashier' && (
              <button className="btn btn-sm btn-outline" onClick={() => window.location.hash = '#/predictions'}>Proyector</button>
            )}
            {user?.role === 'cashier' && (
              <button className="btn btn-sm btn-outline" onClick={() => { setCashierExpenseForm({ description: '', amount: '', category: '', notes: '' }); setShowCashierExpenseModal(true) }}>Gasto</button>
            )}
          </div>
          <div className="btn-group">
            {!currentSession ? (
              <button className="btn btn-sm btn-success" onClick={() => { setStartDayAmount(''); setShowStartDayModal(true) }}>Iniciar Dia</button>
            ) : (
              <>
                {registerData && registerData.status !== 'closed' && (
                  <button className="btn btn-sm btn-outline" onClick={() => { setWithdrawalAmount(''); setWithdrawalReason(''); setShowWithdrawalModal(true) }}>Retiro</button>
                )}
                <button className="btn btn-sm btn-outline" onClick={() => { loadWithdrawals(); setShowWithdrawalsList(true) }}>Retiros</button>
                {registerData && parseFloat(registerData.opening_amount) > 0 && registerData.status !== 'closed' && (
                  <button className="btn btn-sm btn-warning" onClick={handleEndDayClick}>Cerrar Dia</button>
                )}
              </>
            )}
          </div>
          <div className="btn-group">
            <button className="btn btn-sm btn-outline" onClick={() => setHistoryModal(true)}>Historial</button>
            <button className="btn btn-sm btn-outline" onClick={handleLogout}>Salir</button>
            {user?.role === 'admin' && (
            <button className="btn btn-sm btn-outline settings-btn" onClick={() => window.location.hash = '#/settings'} title="Configuracion">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            )}
          </div>
        </div>
      </header>

      {networkInfo && (
        <div className="network-bar">
          Tablet: <strong>http://{networkInfo.ip}:{networkInfo.port}</strong>
        </div>
      )}

      {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}
      {success && <div className="alert alert-success" onClick={() => setSuccess('')}>{success}</div>}

      <div className="barcode-input">
        <div className="input-group">
          <input
            ref={barcodeRef}
            type="text"
            className="input-lg"
            placeholder="Escanear código de barras..."
            value={barcode}
            onChange={handleBarcodeChange}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { processedRef.current = true; const val = e.currentTarget.value.replace(/[\n\r]/g, '').trim(); if (val) { handleBarcode(val) }; setBarcode('') }}}
          />
          <button className="btn btn-secondary" onClick={() => { setShowSearch(!showSearch); setSearchQuery('') }}>
            Buscar
          </button>
        </div>
        <div className="shortcuts-hint" style={{fontSize:'0.75rem', color:'var(--text-muted)', marginTop:'0.25rem'}}>
          F2 Buscar producto · F4 Cobrar · F6 Cliente/Fiado · F8 Historial
        </div>
      </div>

      {saleDone ? (
        <div className="sale-done">
          <div className="sale-done-icon">✓</div>
          <h2>Venta Completada</h2>
          <p>Ticket #{saleDone.sale.id} - Total: {formatMoney(saleDone.sale.total)}</p>
          <div className="sale-done-actions">
            <button className="btn btn-primary" onClick={handlePrintTicket}>Imprimir Ticket</button>
            <button className="btn btn-secondary" onClick={() => { setSaleDone(null) }}>
              Nueva Venta
            </button>
          </div>
        </div>
      ) : (
        <div className="pos-container">
          <div className="pos-left">

            {showSearch && (
              <div className="search-panel">
                <input
                  ref={searchRef}
                  type="text"
                  className="input-lg"
                  placeholder="Buscar por nombre de producto..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && searchResults.length > 0) { selectSearchResult(searchResults[0]) } }}
                />
                <div className="search-results">
                  {searchResults.map(p => (
                    <div key={p.id} className="search-result-item" tabIndex="0" onClick={() => selectSearchResult(p)} onKeyDown={(e) => { if (e.key === 'Enter') { selectSearchResult(p) } }}>
                      <span className="sr-name">{p.name}</span>
                      <span className="sr-price">{formatMoney(p.sale_price)}</span>
                      <span className="sr-stock">Stock: {p.stock} {p.unit_type === 'kg' ? 'kg' : p.unit_type === 'l' ? 'L' : 'uds'}</span>
                    </div>
                  ))}
                  {searchQuery.length >= 2 && searchResults.length === 0 && (
                    <p className="no-results">Sin resultados</p>
                  )}
                </div>
              </div>
            )}

            <div className="cart-section">
              <div className="cart-header">
                <h3>Carrito ({cart.length} productos)</h3>
                {selectedCustomer && (
                  <span className="customer-badge">{selectedCustomer.name}</span>
                )}
              </div>
              {cart.length === 0 ? (
                <div className="cart-empty">Escanee o busque productos para agregar al carrito</div>
              ) : (
                <div className="cart-table-wrap">
                  <table className="cart-table">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th style={{width:80}}>Cant</th>
                        <th style={{width:80}}>Precio</th>
                        <th style={{width:60}}>Desc</th>
                        <th style={{width:80}}>Subtotal</th>
                        <th style={{width:40}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cart.map(item => {
                        const isWeight = item.unit_type === 'kg' || item.unit_type === 'l'
                        const unitLabel = item.unit_type === 'kg' ? 'kg' : item.unit_type === 'l' ? 'L' : ''
                        const qtyStep = isWeight ? 0.1 : 1
                        const qtyMin = isWeight ? 0.1 : 1
                        const isCashier = user?.role === 'cashier'
                        return (
                        <tr key={item.product_id}>
                          <td>{item.product_name}</td>
                          <td className="qty-cell">
                            <input type="number" className="qty-input" min={qtyMin} step={qtyStep} value={item.quantity} onChange={(e) => updateCartItem(item.product_id, 'quantity', parseFloat(e.target.value) || 0)} />
                            {unitLabel && <span className="unit-label">{unitLabel}</span>}
                          </td>
                          <td>{isCashier ? <span className="price-display">{formatMoney(item.unit_price)}</span> : <input type="number" className="price-input" step={isWeight ? "0.01" : "1"} value={item.unit_price} onChange={(e) => updateCartItem(item.product_id, 'unit_price', parseFloat(e.target.value) || 0)} />}</td>
                          <td>{isCashier ? <span className="price-display">$0.00</span> : <input type="number" className="disc-input" step="0.01" value={item.discount} disabled={isCashier} onChange={(e) => updateCartItem(item.product_id, 'discount', parseFloat(e.target.value) || 0)} />}</td>
                          <td className="subtotal-cell">{formatMoney(item.subtotal)}</td>
                          <td><button className="btn btn-danger btn-sm" onClick={() => removeFromCart(item.product_id)}>X</button></td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="pos-right">
            <div className="pos-summary">
              <div className="summary-row">
                <span>Subtotal:</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              <div className="summary-row">
                <span>Descuento total:</span>
                <input type="number" className="discount-input" step="0.01" value={totalDiscount} disabled={user?.role === 'cashier'} onChange={(e) => setTotalDiscount(parseFloat(e.target.value) || 0)} />
              </div>
              <div className="summary-row total-row">
                <span>TOTAL:</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>

            <div className="pos-actions">
              <button className="btn btn-secondary btn-block" onClick={() => setCustomerModal(true)}>
                {selectedCustomer ? `Cliente: ${selectedCustomer.name}` : 'Seleccionar Cliente (Fiado)'}
              </button>
              <button className="btn btn-primary btn-lg btn-block" onClick={openPayment}>
                Cobrar ({formatMoney(total)})
              </button>
              <button className="btn btn-outline btn-block" onClick={() => { setCart([]); setTotalDiscount(0); setSelectedCustomer(null) }}>
                Cancelar Venta
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentModal && (
        <div className="modal-overlay" onKeyDown={(e) => { if (e.key === 'Enter' && getPaymentTotal() >= total) { handleCompleteSale() } if (e.key === 'Escape') { setPaymentModal(false) } }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Cobrar Venta</h2>
            <p className="modal-total">Total a cobrar: {formatMoney(total)}</p>

            <div className="payments-list">
              {payments.map((p, i) => (
                <div key={i} className="payment-row">
                  <select value={p.method} onChange={(e) => updatePayment(i, 'method', e.target.value)}>
                    <option value="cash">Efectivo</option>
                    <option value="card">Tarjeta</option>
                    <option value="transfer">Transferencia</option>
                    {user?.role !== 'cashier' && <option value="credit">Fiado/Crédito</option>}
                  </select>
                  <input ref={i === 0 ? paymentRef : null} type="number" step="0.01" placeholder="Monto" value={p.amount} onChange={(e) => updatePayment(i, 'amount', e.target.value)} />
                  {payments.length > 1 && <button className="btn btn-sm btn-danger" onClick={() => removePayment(i)}>X</button>}
                </div>
              ))}
            </div>

            <button className="btn btn-sm btn-outline" onClick={addPaymentMethod}>+ Agregar otro pago</button>

            <div className="payment-summary">
              <p>Total pagado: {formatMoney(getPaymentTotal())}</p>
              {paymentDiff >= 0 && <p className="change-amount">Cambio: {formatMoney(change)}</p>}
              {paymentDiff < 0 && <p className="due-amount">Falta: {formatMoney(Math.abs(paymentDiff))}</p>}
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setPaymentModal(false)} tabIndex="0">Cancelar</button>
              <button className="btn btn-primary" onClick={handleCompleteSale} tabIndex="0" disabled={getPaymentTotal() < total}>
                Completar Venta
              </button>
            </div>
          </div>
        </div>
      )}

      {customerModal && (
        <div className="modal-overlay" onClick={() => setCustomerModal(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Seleccionar Cliente</h3>
            <input type="text" className="input-lg" placeholder="Buscar cliente..." value={customerSearch} onChange={async (e) => {
              setCustomerSearch(e.target.value)
              if (e.target.value.length >= 1) {
                try { const res = await customers.list(e.target.value); setCustomerList(res.customers) } catch (e) {}
              }
            }} />
            <div className="customer-list">
              {customerList.map(c => (
                <div key={c.id} className="customer-item" onClick={() => { setSelectedCustomer(c); setCustomerModal(false); setCustomerSearch(''); }}>
                  <span>{c.name}</span>
                  <span className="customer-balance">Saldo: {formatMoney(c.balance)}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-sm btn-outline" onClick={() => { setNewCustomerModal(true); setNewCustomerName('') }}>+ Nuevo Cliente</button>
          </div>
        </div>
      )}

      {historyModal && (
        <div className="modal-overlay" onClick={() => setHistoryModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Ventas de Hoy</h2>
              <button className="btn btn-sm btn-outline" onClick={() => setHistoryModal(false)}>Cerrar</button>
            </div>
            <div className="modal-body">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Hora</th>
                    <th>Productos</th>
                    <th>Total</th>
                    <th>Pago</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {salesHistory.map(s => (
                    <tr key={s.id} className={s.status === 'cancelled' ? 'row-cancelled' : ''}>
                      <td>{s.id}</td>
                      <td>{new Date(s.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{s.items?.length || 0} prod.</td>
                      <td>{formatMoney(s.total)}</td>
                      <td style={{fontSize:'0.8rem'}}>{s.payment_method}</td>
                      <td>{s.status === 'cancelled' ? 'Cancelada' : s.status}</td>
                      <td>
                        <button className="btn btn-sm btn-outline" onClick={() => loadSaleDetails(s.id)}>Ver</button>
                        {s.status === 'completed' && user?.role === 'admin' && (
                          <button className="btn btn-sm btn-danger" onClick={() => setCancelModal(s)}>Cancelar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {salesHistory.length === 0 && <tr><td colSpan="7" className="text-center">Sin ventas hoy</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="modal-overlay" style={{display: showSecurityModal ? 'flex' : 'none'}} onClick={e => e.preventDefault()}>
        <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
          <h3>Producto No Registrado</h3>
          <p>Codigo: <strong>{securityBarcode}</strong></p>
          <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
            Este codigo no existe en el inventario. Ingresa el codigo de seguridad para autorizar la operacion.
          </p>
          <div className="form-group">
            <label>Codigo de Seguridad</label>
            <input
              ref={securityRef}
              type="password"
              className="input-lg"
              value={securityPin}
              onChange={e => setSecurityPin(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSecurityConfirm() }}
              autoFocus
            />
          </div>
          {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={handleSecurityConfirm}>Autorizar</button>
          </div>
        </div>
      </div>

      {newCustomerModal && (
        <div className="modal-overlay" onClick={() => setNewCustomerModal(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Nuevo Cliente</h3>
            <div className="form-group">
              <label>Nombre del Cliente *</label>
              <input type="text" className="input-lg" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} placeholder="Nombre completo" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleNewCustomer() }} />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setNewCustomerModal(false); setError('') }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleNewCustomer}>Crear Cliente</button>
            </div>
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="modal-overlay" onKeyDown={(e) => { if (e.key === 'Enter') { handleLogoutConfirm() } if (e.key === 'Escape') { setShowLogoutConfirm(false) } }}>
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

      {showStartDayModal && (
        <div className="modal-overlay" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleStartDay() } }}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Iniciar Turno</h3>
            <p>Debe ingresar el efectivo actual en caja para iniciar su turno:</p>
            <div className="form-group">
              <input type="number" step="0.01" className="input-lg" value={startDayAmount} onChange={(e) => setStartDayAmount(e.target.value)} placeholder="0.00" autoFocus />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-primary btn-block" onClick={handleStartDay} tabIndex="0" disabled={startDayAmount === '' || parseFloat(startDayAmount) < 0}>Iniciar Turno</button>
            </div>
          </div>
        </div>
      )}
      {showEndDayModal && (
        <div className="modal-overlay" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleEndDaySubmit() } if (e.key === 'Escape') { setShowEndDayModal(false) } }}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Cerrar Día</h3>
            <p>¿Cuánto dinero hay en caja al cierre del día?</p>
            <div className="form-group">
              <input type="number" step="0.01" className="input-lg" value={endDayAmount} onChange={(e) => setEndDayAmount(e.target.value)} placeholder="0.00" autoFocus />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowEndDayModal(false)} tabIndex="0">Cancelar</button>
              <button className="btn btn-warning" onClick={handleEndDaySubmit} tabIndex="0">Cerrar Día</button>
            </div>
          </div>
        </div>
      )}
      {showCashCountModal && (
        <div className="modal-overlay" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCashCountSubmit() } if (e.key === 'Escape') { setShowCashCountModal(false) } }}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Conteo de Caja</h3>
            <p>Ingresa el efectivo que hay en caja para cerrar el día:</p>
            <div className="form-group">
              <input ref={cashCountRef} type="number" step="0.01" className="input-lg" value={cashCountAmount} onChange={(e) => setCashCountAmount(e.target.value)} placeholder="0.00" />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCashCountModal(false)} tabIndex="0">Cancelar</button>
              <button className="btn btn-primary" onClick={handleCashCountSubmit} tabIndex="0">Cerrar y Salir</button>
            </div>
          </div>
        </div>
      )}
      {showWithdrawalModal && (
        <div className="modal-overlay" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleWithdrawalSubmit() } if (e.key === 'Escape') { setShowWithdrawalModal(false); setError('') } }}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Retiro de Efectivo</h3>
            <p>Registra la salida de efectivo de la caja:</p>
            <div className="form-group">
              <label>Monto *</label>
              <input type="number" step="0.01" className="input-lg" value={withdrawalAmount} onChange={(e) => setWithdrawalAmount(e.target.value)} placeholder="0.00" autoFocus />
            </div>
            <div className="form-group">
              <label>Motivo *</label>
              <textarea value={withdrawalReason} onChange={(e) => setWithdrawalReason(e.target.value)} rows="2" placeholder="¿Para qué se retira el efectivo?" />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowWithdrawalModal(false); setError('') }} tabIndex="0">Cancelar</button>
              <button className="btn btn-warning" onClick={handleWithdrawalSubmit} tabIndex="0">Registrar Retiro</button>
            </div>
          </div>
        </div>
      )}
      {showWithdrawalsList && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Retiros de Hoy</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setShowWithdrawalsList(false)} tabIndex="0">Cerrar</button>
            </div>
            <div className="modal-body">
              {withdrawalsList.length === 0 ? (
                <p className="text-center">Sin retiros registrados hoy</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Monto</th>
                      <th>Motivo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawalsList.map(w => (
                      <tr key={w.id}>
                        <td>{new Date(w.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td>{'$' + parseFloat(w.amount).toFixed(2)}</td>
                        <td style={{fontSize:'0.85rem'}}>{w.description.replace(/^Retiro de efectivo[^—]*—\s*/, '')}</td>
                        <td>
                          <button className="btn btn-sm btn-danger" onClick={() => handleCancelWithdrawal(w.id)}>Cancelar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
      {cancelModal && (
        <div className="modal-overlay" onClick={() => setCancelModal(null)} onKeyDown={(e) => { if (e.key === 'Escape') { setCancelModal(null); setCancelReason('') } }}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Cancelar Venta #{cancelModal.id}</h3>
            <p>Total: {formatMoney(cancelModal.total)}</p>
            <div className="form-group">
              <label>Motivo de cancelación *</label>
              <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows="3" required></textarea>
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setCancelModal(null); setCancelReason('') }} tabIndex="0">Volver</button>
              <button className="btn btn-danger" onClick={() => handleCancelSale(cancelModal.id)} tabIndex="0">Cancelar Venta</button>
            </div>
          </div>
        </div>
      )}

      {saleDetail && (
        <div className="modal-overlay" onClick={() => setSaleDetail(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Detalle de Venta #{saleDetail.id}</h2>
              <button className="btn btn-sm btn-outline" onClick={() => setSaleDetail(null)}>Cerrar</button>
            </div>
            <div className="modal-body">
              <div style={{display:'flex', gap:'2rem', marginBottom:'1rem', flexWrap:'wrap'}}>
                <div><strong>Fecha:</strong> {new Date(saleDetail.created_at).toLocaleDateString('es-MX')}</div>
                <div><strong>Hora:</strong> {new Date(saleDetail.created_at).toLocaleTimeString('es-MX')}</div>
                <div><strong>Cajero:</strong> {saleDetail.created_by_name || '-'}</div>
                <div><strong>Pago:</strong> {saleDetail.payment_method}</div>
              </div>
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Precio</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(saleDetail.items || []).map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.product_name}</td>
                        <td>{item.quantity}</td>
                        <td>{formatMoney(item.unit_price)}</td>
                        <td>{formatMoney(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{textAlign:'right', marginTop:'1rem'}}>
                {saleDetail.discount > 0 && <p>Descuento: -{formatMoney(saleDetail.discount)}</p>}
                <p style={{fontSize:'1.2rem'}}><strong>TOTAL: {formatMoney(saleDetail.total)}</strong></p>
                <p style={{fontSize:'0.9rem'}}>Estado: {saleDetail.status === 'cancelled' ? 'Cancelada' : saleDetail.status}</p>
              </div>
              <div className="modal-actions" style={{marginTop:'1rem'}}>
                <button className="btn btn-primary" onClick={() => printTicket(saleDetail, saleDetail.items)}>Imprimir Ticket</button>
                <button className="btn btn-secondary" onClick={() => setSaleDetail(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCashierExpenseModal && (
        <div className="modal-overlay" onClick={() => setShowCashierExpenseModal(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Registrar Gasto</h3>
            <div className="form-group">
              <label>Descripción *</label>
              <input type="text" value={cashierExpenseForm.description} onChange={e => setCashierExpenseForm({...cashierExpenseForm, description: e.target.value})} autoFocus />
            </div>
            <div className="form-group">
              <label>Monto *</label>
              <input type="number" step="0.01" value={cashierExpenseForm.amount} onChange={e => setCashierExpenseForm({...cashierExpenseForm, amount: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Categoría</label>
              <input type="text" value={cashierExpenseForm.category} onChange={e => setCashierExpenseForm({...cashierExpenseForm, category: e.target.value})} placeholder="Ej: Renta, Luz..." />
            </div>
            <div className="form-group">
              <label>Notas</label>
              <textarea value={cashierExpenseForm.notes} onChange={e => setCashierExpenseForm({...cashierExpenseForm, notes: e.target.value})} rows="2" />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowCashierExpenseModal(false); setError('') }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCashierExpenseSubmit}>Guardar Gasto</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
