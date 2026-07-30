import React, { useState, useEffect, useRef, useCallback } from 'react'
import { sales, products, customers, network, accounting, withdrawals, hardware, settings as settingsApi } from '../api'
import { getTheme, toggleTheme } from '../theme'
import { enqueueSale, getQueue, syncQueue, discardFailed, retryFailed } from '../offlineQueue'
import { formatDateTime, formatDate, formatTime, formatLiveClock } from '../dateUtils'
import { getShortcuts, matchesShortcut, keyLabel } from '../shortcuts'
import { escapeHtml, buildStoreHeader, openTicketWindow } from '../ticketPrint'
import { modalKeys } from '../modalKeys'
import { confirmDialog } from '../confirmDialog'
import { useKeyboardLayer, focusCommandLine } from '../keyboard/input.js'
import { STATES, actionsFor } from '../keyboard/registry.js'
import { parseCommand, resolveCommand, ghostSuggestion } from '../keyboard/parser.js'
import { suspendSale, resumeSale, listSuspended, discardSuspended } from '../suspendedSales'
import HelpBar from './HelpBar'
import CommandPalette from './CommandPalette'

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
  const [theme, setThemeState] = useState(getTheme())
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
  const [individualChoice, setIndividualChoice] = useState(null)
  const [individualQty, setIndividualQty] = useState('1')
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [offlineQueue, setOfflineQueue] = useState([])
  const [showQueueModal, setShowQueueModal] = useState(false)
  const [offlineSaleQueued, setOfflineSaleQueued] = useState(false)
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
  // --- Capa de teclado (ver frontend/src/keyboard/) ---
  const [activeLine, setActiveLine] = useState(0)      // línea seleccionada del ticket
  const [flashLine, setFlashLine] = useState(null)     // parpadeo al agregar
  const [undoStack, setUndoStack] = useState([])       // deshacer en captura
  const [showPalette, setShowPalette] = useState(false)
  const [showHelpSheet, setShowHelpSheet] = useState(false)
  const [showSuspendedList, setShowSuspendedList] = useState(false)
  const [suspendedList, setSuspendedList] = useState([])
  const [scanning, setScanning] = useState(false)
  const [toast, setToast] = useState(null)             // aviso no bloqueante
  const isCashier = user?.role === 'cashier'

  useEffect(() => { const id = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(id) }, [])
  useEffect(() => { if (error) { const t = setTimeout(() => setError(''), 7000); return () => clearTimeout(t) } }, [error])
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t) } }, [success])
  useEffect(() => { network.info().then(setNetworkInfo).catch(() => {}) }, [])
  useEffect(() => { settingsApi.getStore().then(setStoreInfo).catch(() => {}) }, [])
  // Precalienta el catálogo offline (ver api.js): el POS normalmente nunca
  // pide el catálogo completo (solo busca/escanea puntualmente), así que sin
  // esto no habría nada guardado para cuando falte la conexión.
  useEffect(() => { products.all().catch(() => {}); customers.list().catch(() => {}) }, [])

  // Checkpoint 2 de modo offline: reintenta enviar las ventas en cola al
  // arrancar y cada vez que vuelve la conexión — no espera a que el cajero
  // haga algo para intentarlo.
  const refreshQueueState = useCallback(() => { setOfflineQueue(getQueue()) }, [])

  const trySyncQueue = useCallback(async () => {
    const before = getQueue().filter(i => i.status === 'pending').length
    if (before === 0) { refreshQueueState(); return }
    const synced = await syncQueue(sales.create)
    refreshQueueState()
    if (synced.length > 0) {
      loadTodaySales()
      loadRegister()
      setSuccess(`${synced.length} venta(s) pendiente(s) sincronizada(s)`)
      setTimeout(() => setSuccess(''), 4000)
    }
  }, [refreshQueueState])

  useEffect(() => {
    refreshQueueState()
    trySyncQueue()
    window.addEventListener('online', trySyncQueue)
    // Red de seguridad: navigator.onLine solo detecta la interfaz de red, no
    // si el servidor específicamente volvió a responder. Si el PC principal
    // se reinicia sin que el WiFi de la tablet se haya caído en ningún
    // momento, el evento 'online' nunca dispara — este intervalo cubre ese caso.
    const interval = setInterval(trySyncQueue, 30000)
    return () => { window.removeEventListener('online', trySyncQueue); clearInterval(interval) }
  }, [trySyncQueue, refreshQueueState])
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
      if (barcodeRef.current && !showStartDayModal && !paymentModal && !customerModal && !historyModal && !showEndDayModal && !showWithdrawalModal && !showWithdrawalsList && !showLogoutConfirm && !showCashCountModal && !cancelModal && !newCustomerModal && !showSecurityModal && !individualChoice) {
        barcodeRef.current.focus()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [showStartDayModal, showEndDayModal, showWithdrawalModal, showWithdrawalsList, showLogoutConfirm, showCashCountModal, paymentModal, customerModal, historyModal, cancelModal, newCustomerModal, showSecurityModal, individualChoice])

  useEffect(() => {
    const noModal = !showStartDayModal && !paymentModal && !customerModal && !historyModal && !showEndDayModal && !showWithdrawalModal && !showWithdrawalsList && !showLogoutConfirm && !showCashCountModal && !cancelModal && !newCustomerModal && !showSecurityModal && !individualChoice
    if (noModal) {
      setTimeout(() => { if (barcodeRef.current) barcodeRef.current.focus() }, 50)
    }
  }, [showStartDayModal, showEndDayModal, showWithdrawalModal, showWithdrawalsList, showLogoutConfirm, showCashCountModal, paymentModal, customerModal, historyModal, cancelModal, newCustomerModal, showSecurityModal, individualChoice, saleDone, error, success])

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

  // ============================================================
  // MÁQUINA DE ESTADOS + CAPA DE TECLADO
  // El estado decide qué significa cada tecla (la misma F1 es "Ayuda" en
  // captura y "Efectivo" en cobro) y qué muestra la barra de ayuda. Los
  // atajos NO se escriben aquí: salen del registro (keyboard/registry.js);
  // este componente solo aporta el comportamiento.
  // ============================================================
  const anyModalOpen = showStartDayModal || customerModal || historyModal || showEndDayModal ||
    showWithdrawalModal || showWithdrawalsList || showLogoutConfirm || showCashCountModal ||
    cancelModal || newCustomerModal || showSecurityModal || individualChoice ||
    showPalette || showHelpSheet || showSuspendedList || showCashierExpenseModal || showQueueModal

  const posState = saleDone ? STATES.CAMBIO
    : paymentModal ? STATES.COBRO
    : showSearch ? STATES.BUSQUEDA
    : anyModalOpen ? STATES.MODAL
    : STATES.CAPTURA

  // Aviso no bloqueante: no roba el foco y se va solo (principio 7).
  const notify = useCallback((text, kind = 'info') => {
    setToast({ text, kind, id: Date.now() })
    setTimeout(() => setToast(t => (t && Date.now() - t.id >= 2400 ? null : t)), 2500)
  }, [])

  // Instantánea del ticket para poder deshacer. Solo en captura: el dinero ya
  // registrado no se deshace desde aquí (se cancela con su propio flujo).
  const pushUndo = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-19), { cart, totalDiscount, selectedCustomer }])
  }, [cart, totalDiscount, selectedCustomer])

  const handleUndo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) { notify('Nada que deshacer'); return prev }
      const snapshot = prev[prev.length - 1]
      setCart(snapshot.cart)
      setTotalDiscount(snapshot.totalDiscount)
      setSelectedCustomer(snapshot.selectedCustomer)
      notify('Deshecho')
      return prev.slice(0, -1)
    })
  }, [notify])

  const handleSuspend = useCallback(() => {
    if (cart.length === 0) { notify('No hay nada que suspender'); return }
    suspendSale({ cart, totalDiscount, customer: selectedCustomer, userName: user?.name })
    setCart([]); setTotalDiscount(0); setSelectedCustomer(null); setUndoStack([])
    notify('Venta suspendida — F7 para retomarla', 'success')
  }, [cart, totalDiscount, selectedCustomer, user, notify])

  const openSuspendedList = useCallback(() => {
    const list = listSuspended()
    if (list.length === 0) { notify('No hay ventas suspendidas'); return }
    setSuspendedList(list)
    setShowSuspendedList(true)
  }, [notify])

  const doResumeSale = useCallback((id) => {
    const found = resumeSale(id)
    if (!found) return
    if (cart.length > 0) {
      // No se pisa el ticket en curso: se suspende antes de traer el otro.
      suspendSale({ cart, totalDiscount, customer: selectedCustomer, userName: user?.name })
    }
    setCart(found.cart || [])
    setTotalDiscount(found.totalDiscount || 0)
    setSelectedCustomer(found.customer || null)
    setShowSuspendedList(false)
    setUndoStack([])
    notify('Venta retomada', 'success')
  }, [cart, totalDiscount, selectedCustomer, user, notify])

  // Mueve la selección de línea del ticket y la mantiene dentro de rango.
  const moveLine = useCallback((delta) => {
    setActiveLine(i => {
      if (cart.length === 0) return 0
      return Math.max(0, Math.min(cart.length - 1, i + delta))
    })
  }, [cart.length])

  const changeQty = useCallback((delta) => {
    if (cart.length === 0) return
    const item = cart[Math.min(activeLine, cart.length - 1)]
    if (!item) return
    const isWeight = item.unit_type === 'kg' || item.unit_type === 'l'
    const step = isWeight ? 0.1 : 1
    const next = Math.round((item.quantity + delta * step) * 100) / 100
    if (next <= 0) { notify('Usa Supr para quitar la línea'); return }
    pushUndo()
    updateCartItem(item.product_id, 'quantity', next, item.is_individual)
  }, [cart, activeLine, pushUndo, notify])

  const removeActiveLine = useCallback(() => {
    if (cart.length === 0) { notify('El ticket está vacío'); return }
    const item = cart[Math.min(activeLine, cart.length - 1)]
    if (!item) return
    pushUndo()
    removeFromCart(item.product_id, item.is_individual)
    notify(`Quitado: ${item.product_name} — Ctrl+Z deshace`)
  }, [cart, activeLine, pushUndo, notify])

  const applyLineDiscount = useCallback((pct) => {
    if (isCashier) { notify('Solo el dueño aplica descuentos', 'error'); return }
    if (cart.length === 0) { notify('El ticket está vacío'); return }
    const item = cart[Math.min(activeLine, cart.length - 1)]
    if (!item) return
    const monto = Math.round(item.unit_price * item.quantity * (pct / 100) * 100) / 100
    pushUndo()
    updateCartItem(item.product_id, 'discount', monto, item.is_individual)
    notify(`Descuento ${pct}% en ${item.product_name}`, 'success')
  }, [cart, activeLine, isCashier, pushUndo, notify])

  const setLinePrice = useCallback((price) => {
    if (isCashier) { notify('Solo el dueño cambia precios', 'error'); return }
    if (cart.length === 0) { notify('El ticket está vacío'); return }
    const item = cart[Math.min(activeLine, cart.length - 1)]
    if (!item) return
    pushUndo()
    updateCartItem(item.product_id, 'unit_price', price, item.is_individual)
    notify(`Precio manual: ${formatMoney(price)}`, 'success')
  }, [cart, activeLine, isCashier, pushUndo, notify])

  const clearTicket = useCallback(() => {
    if (cart.length === 0) return
    pushUndo()
    setCart([]); setTotalDiscount(0); setSelectedCustomer(null)
    notify('Ticket vaciado — Ctrl+Z deshace')
  }, [cart.length, pushUndo, notify])

  // Suma una denominación al pago en efectivo (teclas F5-F9 en cobro).
  const addDenomination = useCallback((amount) => {
    setPayments(prev => {
      const idx = prev.findIndex(p => p.method === 'cash')
      if (idx === -1) return [{ method: 'cash', amount }, ...prev]
      const copy = [...prev]
      copy[idx] = { ...copy[idx], amount: (parseFloat(copy[idx].amount) || 0) + amount }
      return copy
    })
  }, [])

  const setPaymentMethod = useCallback((method) => {
    setPayments(prev => {
      const copy = [...prev]
      copy[0] = { ...copy[0], method }
      return copy
    })
  }, [])

  // Handlers: el registro dice QUÉ tecla, esto dice QUÉ hace.
  const handlers = {
    pos_help: () => setShowHelpSheet(true),
    pos_search: () => setShowSearch(true),
    pos_customer: () => setCustomerModal(true),
    pos_charge: () => openPayment(),
    pos_discount: () => applyLineDiscount(10),
    pos_suspend: () => handleSuspend(),
    pos_resume: () => openSuspendedList(),
    pos_history: () => setHistoryModal(true),
    pos_remove_line: () => removeActiveLine(),
    pos_palette: () => setShowPalette(true),
    pos_undo: () => handleUndo(),
    pos_qty_up: () => changeQty(1),
    pos_qty_down: () => changeQty(-1),
    pos_line_prev: () => moveLine(-1),
    pos_line_next: () => moveLine(1),
    pos_clear: () => clearTicket(),
    pos_withdrawal: () => { setWithdrawalAmount(''); setWithdrawalReason(''); setShowWithdrawalModal(true) },
    pos_expense: () => { setCashierExpenseForm({ description: '', amount: '', category: '', notes: '' }); setShowCashierExpenseModal(true) },
    pos_close_day: () => handleEndDayClick(),
    // Cobro
    cobro_cash: () => setPaymentMethod('cash'),
    cobro_card: () => setPaymentMethod('card'),
    cobro_transfer: () => setPaymentMethod('transfer'),
    cobro_mixed: () => addPaymentMethod(),
    cobro_d20: () => addDenomination(20),
    cobro_d50: () => addDenomination(50),
    cobro_d100: () => addDenomination(100),
    cobro_d200: () => addDenomination(200),
    cobro_d500: () => addDenomination(500),
  }

  // Los comandos "/algo" de la línea de comando ejecutan exactamente los
  // mismos handlers que las teclas: una sola definición de comportamiento.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useKeyboardLayer({
    state: posState,
    role: user?.role,
    handlers,
    commandLineRef: barcodeRef,
    isCommandLineEmpty: () => !barcode,
    enabled: !!currentSession || posState !== STATES.CAPTURA,
    onScanStateChange: setScanning,
  })

  // El foco SIEMPRE regresa a la línea de comando al volver a captura,
  // incluso después de una operación fallida (criterio de aceptación 3).
  useEffect(() => {
    if (posState === STATES.CAPTURA) focusCommandLine(barcodeRef, { delay: 30 })
  }, [posState])

  // "Enter avanza, Esc retrocede" es una regla universal de la app, no un
  // atajo configurable: por eso vive aquí y no en el registro de acciones.
  useEffect(() => {
    const onKey = (e) => {
      // CAMBIO: Enter arranca la siguiente venta sin tocar el mouse; P imprime.
      if (posState === STATES.CAMBIO) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          setSaleDone(null)
          setOfflineSaleQueued(false)
        } else if (e.key.toLowerCase() === 'p' && !offlineSaleQueued) {
          e.preventDefault()
          handlePrintTicket()
        }
        return
      }
      // Esc retrocede SIEMPRE, sin importar dónde esté el foco. Antes cada
      // ventana traía su propio manejador que solo servía si el foco estaba
      // dentro — justo el anti-patrón de "atajos que dependen de la ventana
      // activa". Se cierra lo más superficial primero.
      if (e.key !== 'Escape') return
      if (showPalette) { e.preventDefault(); setShowPalette(false) }
      else if (showHelpSheet) { e.preventDefault(); setShowHelpSheet(false) }
      else if (showSuspendedList) { e.preventDefault(); setShowSuspendedList(false) }
      else if (showSearch) { e.preventDefault(); setShowSearch(false); setSearchQuery(''); setSearchResults([]) }
      else if (paymentModal) { e.preventDefault(); setPaymentModal(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [posState, offlineSaleQueued, showPalette, showHelpSheet, showSuspendedList, showSearch, paymentModal])

  // LÍNEA DE COMANDO — todo lo que se teclea pasa por aquí. El parser
  // (keyboard/parser.js) decide la intención; esto la ejecuta.
  const handleBarcode = useCallback(async (value) => {
    const parsed = parseCommand(value)

    switch (parsed.type) {
      case 'empty':
        return

      case 'invalid':
        notify(parsed.reason, 'error')
        setBarcode('')
        return

      case 'search':
        setShowSearch(true)
        setSearchQuery(parsed.query)
        handleSearch(parsed.query)
        setBarcode('')
        return

      case 'customer':
        setCustomerModal(true)
        setCustomerSearch(parsed.query)
        if (parsed.query) {
          try { const res = await customers.list(parsed.query); setCustomerList(res.customers) } catch (e) {}
        }
        setBarcode('')
        return

      case 'command': {
        const actionId = resolveCommand(parsed.command)
        setBarcode('')
        if (!actionId) { notify(`No conozco el comando "/${parsed.command}"`, 'error'); return }
        const run = handlersRef.current[actionId]
        if (run) run()
        else notify('Esa acción no está disponible aquí', 'error')
        return
      }

      case 'set_qty': {
        if (cart.length === 0) { notify('El ticket está vacío'); setBarcode(''); return }
        const item = cart[Math.min(activeLine, cart.length - 1)]
        pushUndo()
        updateCartItem(item.product_id, 'quantity', parsed.qty, item.is_individual)
        notify(`${item.product_name} → ${parsed.qty}`)
        setBarcode('')
        return
      }

      case 'discount_pct':
        applyLineDiscount(parsed.value)
        setBarcode('')
        return

      case 'set_price':
        setLinePrice(parsed.value)
        setBarcode('')
        return

      case 'remove': {
        const item = cart.find(i => i.barcode === parsed.code || String(i.product_id) === parsed.code)
        setBarcode('')
        if (!item) { notify('Ese producto no está en el ticket', 'error'); return }
        pushUndo()
        removeFromCart(item.product_id, item.is_individual)
        notify(`Quitado: ${item.product_name} — Ctrl+Z deshace`)
        return
      }

      case 'product': {
        let product
        try {
          product = await products.getByBarcode(parsed.code)
        } catch (e) {
          // No existe como código: se cae a búsqueda por nombre SIN borrar lo
          // escrito (regla 1 del parser). Solo si parece un código de barras
          // de verdad se pide el código de seguridad.
          const pareceCodigo = /^\d{6,}$/.test(parsed.code)
          if (pareceCodigo) {
            setSecurityBarcode(parsed.code)
            setSecurityQty(parsed.qty || 1)
            setSecurityPin('')
            setShowSecurityModal(true)
            setBarcode('')
          } else {
            setShowSearch(true)
            setSearchQuery(parsed.code)
            handleSearch(parsed.code)
          }
          return
        }

        // "$50 de jamón": la cantidad sale del importe y del precio del producto.
        let qty = parsed.qty
        if (parsed.amount) {
          const precio = parseFloat(product.sale_price) || 0
          if (precio <= 0) { notify('Ese producto no tiene precio', 'error'); setBarcode(''); return }
          qty = Math.round((parsed.amount / precio) * 1000) / 1000
        }

        pushUndo()
        if (parsed.individual) {
          if (!product.sellable_individually) {
            notify(`${product.name} no se vende por pieza suelta`, 'error')
            setBarcode('')
            return
          }
          addToCart(product, qty, true)
        } else {
          tryAddToCart(product, qty)
        }
        setFlashLine(product.id)
        setTimeout(() => setFlashLine(null), 600)
        setBarcode('')
        setError('')
        return
      }

      default:
        setBarcode('')
    }
  }, [cart, activeLine, pushUndo, notify, applyLineDiscount, setLinePrice])

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

  const addToCart = (product, qty, isIndividual = false) => {
    const quantity = qty || 1
    const unitPrice = isIndividual ? product.individual_price : product.sale_price
    setCart(prev => {
      // Una línea de venta individual (piezas sueltas) NUNCA se junta con una
      // de paquete completo del mismo producto — tienen precio y efecto en
      // stock distintos (fracción de paquete vs paquete entero).
      const existing = prev.find(i => i.product_id === product.id && !!i.is_individual === isIndividual)
      if (existing && product.unit_type !== 'kg' && product.unit_type !== 'l') {
        return prev.map(i => i === existing
          ? { ...i, quantity: i.quantity + quantity, subtotal: (i.quantity + quantity) * i.unit_price - i.discount }
          : i
        )
      }
      const itemQty = quantity
      return [...prev, {
        product_id: product.id,
        product_name: product.name,
        barcode: product.barcode,
        unit_price: unitPrice,
        quantity: itemQty,
        discount: 0,
        subtotal: itemQty * unitPrice,
        stock: product.stock,
        unit_type: product.unit_type || 'unit',
        is_individual: isIndividual
      }]
    })
  }

  // Productos vendibles por unidad individual (ej. cigarros sueltos de una
  // cajetilla) preguntan cómo se quiere vender antes de agregarlos al
  // carrito, en vez de asumir siempre paquete completo.
  const tryAddToCart = (product, qty = 1) => {
    if (product.sellable_individually) {
      setIndividualChoice({ product, qty })
      setIndividualQty('1')
    } else {
      addToCart(product, qty)
    }
  }

  const confirmIndividualChoice = (isIndividual) => {
    const { product, qty } = individualChoice
    addToCart(product, isIndividual ? (parseInt(individualQty) || 1) : qty, isIndividual)
    setIndividualChoice(null)
  }

  const updateCartItem = (id, field, value, isIndividual = false) => {
    setCart(prev => prev.map(i => {
      if (i.product_id !== id || !!i.is_individual !== isIndividual) return i
      if (user?.role === 'cashier' && (field === 'unit_price' || field === 'discount')) return i
      const updated = { ...i, [field]: value }
      updated.subtotal = (updated.quantity * updated.unit_price) - updated.discount
      return updated
    }))
  }

  const removeFromCart = (id, isIndividual = false) => setCart(prev => prev.filter(i => !(i.product_id === id && !!i.is_individual === isIndividual)))

  const handleSearch = async (q) => {
    setSearchQuery(q)
    if (q.length < 2) { setSearchResults([]); return }
    try {
      const res = await products.search(q)
      setSearchResults(res.products)
    } catch (e) {}
  }

  const selectSearchResult = (product) => {
    tryAddToCart(product)
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
    const salePayload = {
      items: cart.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        discount: i.discount,
        is_individual: !!i.is_individual
      })),
      payments: payments.map(p => ({ method: p.method, amount: parseFloat(p.amount) || 0 })),
      discount: totalDiscount,
      customer_id: selectedCustomer?.id || null,
      customer_name: selectedCustomer?.name || null
    }

    const queueOffline = () => {
      // No se pierde la venta: se guarda en la cola local y se manda sola en
      // cuanto vuelva la señal (ver offlineQueue.js). El stock/saldo real se
      // valida en el servidor al sincronizar, nunca aquí.
      enqueueSale(salePayload)
      refreshQueueState()
      setCart([])
      setTotalDiscount(0)
      setSelectedCustomer(null)
      setPaymentModal(false)
      setOfflineSaleQueued(true)
      setSaleDone({ sale: { total }, items: cart, change })
    }

    // No se usa navigator.onLine como atajo: solo refleja si el sistema
    // operativo tiene alguna red/internet, no si ESTE servidor responde. En
    // el PC principal el servidor vive en localhost, que siempre es
    // alcanzable sin importar si hay internet — usar navigator.onLine ahí
    // bloqueaba ventas sin motivo real. Se intenta la venta de verdad
    // siempre, y solo se encola si el intento en sí falla por conexión.
    try {
      const res = await sales.create(salePayload)
      setSaleDone({ sale: res.sale, items: res.items, change })
      setOfflineSaleQueued(false)
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
      if (e.message === 'Failed to fetch') {
        queueOffline()
      } else {
        setError(e.message)
      }
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

  const printTicket = (saleData, items) => {
    if (!saleData) return
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
      <div class="center total-box">
        <p><strong>SALDO PENDIENTE DE ${escapeHtml(saleData.customer_name || 'CLIENTE')}</strong></p>
        <p class="total-amount"><strong>${formatMoney(saleData.customer_balance)}</strong></p>
      </div>
    ` : ''

    const bodyHtml = `
      <div class="center">
        ${buildStoreHeader(storeInfo)}
        <p>Ticket de Venta #${saleData.id}</p>
        <p>${formatDateTime(saleData.created_at)}</p>
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
        <p>Pago: ${escapeHtml(paymentLine)}</p>
        <div class="total-box">
          <p class="total-amount">TOTAL: ${formatMoney(saleData.total)}</p>
        </div>
      </div>
      ${balanceHtml}
      <div class="line"></div>
      <div class="center">
        <p>${escapeHtml(storeInfo.ticket_footer)}</p>
      </div>
    `

    const win = openTicketWindow({ title: `Ticket - Venta #${saleData.id}`, bodyHtml })
    if (!win) setError('El navegador bloqueó la ventana de impresión')
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

  // El efectivo esperado lo calcula el backend (expectedCash en GET
  // /accounting/cash-register) — pero solo lo manda al ADMIN. Corte ciego:
  // el cajero cuenta el dinero sin conocer el esperado (si lo conociera,
  // podría "cuadrar" un faltante antes de reportarlo); el sistema guarda la
  // diferencia de todos modos y el dueño la ve en Contabilidad.
  const confirmCashAmount = async (amount) => {
    if (!registerData) return true
    if (registerData.expectedCash === undefined) {
      return confirmDialog(`Vas a registrar ${formatMoney(amount)} como efectivo contado. ¿Es correcto?`)
    }
    const expected = parseFloat(registerData.expectedCash || 0)
    if (Math.abs(amount - expected) <= 1) return true
    return confirmDialog(`El efectivo esperado en caja es ${formatMoney(expected)}, pero ingresaste ${formatMoney(amount)} (diferencia de ${formatMoney(amount - expected)}). ¿Confirmas que ese es el efectivo real contado?`)
  }

  const handleEndDaySubmit = async () => {
    const amount = parseFloat(endDayAmount) || 0
    if (!(await confirmCashAmount(amount))) return
    try {
      await accounting.updateCashRegister({ closing_amount: amount })
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
    const amount = parseFloat(cashCountAmount) || 0
    if (!(await confirmCashAmount(amount))) return
    try {
      if (currentSession) {
        try { await accounting.closeSession(currentSession.id, { closing_amount: amount }) } catch (e) { setError(e.message) }
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
          {/* El estado SIEMPRE visible: el usuario nunca adivina en qué modo está */}
          <span className={`state-badge state-${posState}`}>
            {posState === STATES.COBRO ? 'COBRO' : posState === STATES.CAMBIO ? 'CAMBIO' : 'CAPTURA'}
          </span>
          <span className="header-user">{user?.name}</span>
          <span className="header-today">{formatLiveClock(clock, { weekday: 'short', day: 'numeric', month: 'short' })} {formatLiveClock(clock, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          {registerData && (
            <span className="header-register-info">
              ${parseFloat((currentSession?.opening_amount ?? registerData.opening_amount) || 0).toFixed(0)} ini | ${parseFloat(registerData.totalExpenses || 0).toFixed(0)} gas | ${parseFloat(registerData.totalSales || 0).toFixed(0)} ven
            </span>
          )}
          {offlineQueue.length > 0 && (
            <button
              className={`btn btn-sm ${offlineQueue.some(i => i.status === 'failed') ? 'btn-danger' : 'btn-warning'}`}
              onClick={() => setShowQueueModal(true)}
              title="Ventas guardadas sin conexión"
            >
              ⏳ {offlineQueue.length} sin sincronizar
            </button>
          )}
        </div>
        <div className="pos-header-right">
          <div className="btn-group">
            {!currentSession ? (
              <button className="btn btn-sm btn-success" onClick={() => { setStartDayAmount(''); setShowStartDayModal(true) }}>Iniciar Dia</button>
            ) : (
              <>
                {registerData && registerData.status !== 'closed' && (
                  <button className="btn btn-sm btn-outline" onClick={() => { setWithdrawalAmount(''); setWithdrawalReason(''); setShowWithdrawalModal(true) }}>Retiro</button>
                )}
                <button className="btn btn-sm btn-outline" onClick={() => { loadWithdrawals(); setShowWithdrawalsList(true) }}>Retiros</button>
                {registerData && registerData.status !== 'closed' && (
                  <button className="btn btn-sm btn-warning" onClick={handleEndDayClick}>Cerrar Dia</button>
                )}
              </>
            )}
          </div>
          <div className="btn-group">
            <button className="btn btn-sm btn-outline" onClick={() => setThemeState(toggleTheme())} title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <div className="more-menu-wrapper">
              <button className="btn btn-sm btn-outline" onClick={() => setShowMoreMenu(v => !v)}>Más ▾</button>
              {showMoreMenu && (
                <>
                  <div className="more-menu-backdrop" onClick={() => setShowMoreMenu(false)} />
                  <div className="more-menu">
                    {user?.role === 'admin' && (
                      <>
                        <button onClick={() => { window.location.hash = '#/inventory'; setShowMoreMenu(false) }}>Inventario</button>
                        <button onClick={() => { window.location.hash = '#/purchases'; setShowMoreMenu(false) }}>Compras</button>
                        <button onClick={() => { window.location.hash = '#/accounting'; setShowMoreMenu(false) }}>Contabilidad</button>
                        <button onClick={() => { window.location.hash = '#/customers'; setShowMoreMenu(false) }}>Clientes</button>
                      </>
                    )}
                    {user?.role === 'cashier' && (
                      <>
                        <button onClick={() => { window.location.hash = '#/purchases'; setShowMoreMenu(false) }}>Compras</button>
                        <button onClick={() => { setCashierExpenseForm({ description: '', amount: '', category: '', notes: '' }); setShowCashierExpenseModal(true); setShowMoreMenu(false) }}>Gasto</button>
                      </>
                    )}
                    <button onClick={() => { setHistoryModal(true); setShowMoreMenu(false) }}>Historial ({keyLabel(getShortcuts().pos_history.key)})</button>
                    {user?.role === 'admin' && (
                      <button onClick={() => { window.location.hash = '#/settings'; setShowMoreMenu(false) }}>Configuración</button>
                    )}
                  </div>
                </>
              )}
            </div>
            <button className="btn btn-sm btn-outline" onClick={handleLogout}>Salir</button>
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
        <div className="input-group command-line-wrap">
          <input
            ref={barcodeRef}
            type="text"
            className="input-lg"
            placeholder="Escanea, o escribe: código · 3*código · ?nombre · /comando"
            value={barcode}
            onChange={handleBarcodeChange}
            autoFocus
            onKeyDown={(e) => {
              // Tab acepta la sugerencia fantasma del autocompletado
              if (e.key === 'Tab') {
                const ghost = ghostSuggestion(barcode)
                if (ghost) { e.preventDefault(); setBarcode(ghost); return }
              }
              if (e.key === 'Enter') { processedRef.current = true; const val = e.currentTarget.value.replace(/[\n\r]/g, '').trim(); if (val) { handleBarcode(val) }; setBarcode('') }
            }}
          />
          {/* Sugerencia en gris detrás del texto ya escrito */}
          {ghostSuggestion(barcode) && (
            <div className="command-ghost"><span className="typed">{barcode}</span>{ghostSuggestion(barcode).slice(barcode.length)}</div>
          )}
          {scanning && <span className="scanning-badge">escaneando…</span>}
          <button className="btn btn-secondary" onClick={() => { setShowSearch(!showSearch); setSearchQuery('') }}>
            Buscar
          </button>
        </div>
      </div>

      {saleDone ? (
        <div className="sale-done">
          {/* Estado CAMBIO: la cifra domina la pantalla, alto contraste, para
              leerla de reojo mientras se cuenta el dinero. Enter vuelve a
              capturar sin tocar el mouse. */}
          {saleDone.change > 0 && (
            <div className="change-hero">
              <div className="change-hero-label">CAMBIO</div>
              <div className="change-hero-amount">{formatMoney(saleDone.change)}</div>
              <div className="change-hero-hint">Enter para la siguiente venta</div>
            </div>
          )}
          <div className="sale-done-icon">{offlineSaleQueued ? '⏳' : '✓'}</div>
          <h2>{offlineSaleQueued ? 'Venta Guardada (Sin Conexión)' : 'Venta Completada'}</h2>
          {offlineSaleQueued ? (
            <p>Total: {formatMoney(saleDone.sale.total)} — se enviará sola en cuanto vuelva la señal. No se imprime ticket todavía porque el folio se asigna al sincronizar.</p>
          ) : (
            <p>Ticket #{saleDone.sale.id} - Total: {formatMoney(saleDone.sale.total)}</p>
          )}
          <div className="sale-done-actions">
            {!offlineSaleQueued && <button className="btn btn-primary" onClick={handlePrintTicket}>Imprimir Ticket ({keyLabel('P')})</button>}
            <button className="btn btn-secondary" onClick={() => { setSaleDone(null); setOfflineSaleQueued(false) }}>
              Nueva Venta (Enter)
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
                      {cart.map((item, idx) => {
                        const isWeight = item.unit_type === 'kg' || item.unit_type === 'l'
                        const unitLabel = item.unit_type === 'kg' ? 'kg' : item.unit_type === 'l' ? 'L' : ''
                        const qtyStep = isWeight ? 0.1 : 1
                        const qtyMin = isWeight ? 0.1 : 1
                        const isCashier = user?.role === 'cashier'
                        const rowClass = [
                          idx === Math.min(activeLine, cart.length - 1) ? 'line-active' : '',
                          flashLine === item.product_id ? 'line-added' : '',
                        ].filter(Boolean).join(' ')
                        return (
                        <tr key={`${item.product_id}_${item.is_individual ? 'ind' : 'pkg'}`} className={rowClass} onClick={() => setActiveLine(idx)}>
                          <td>{item.product_name}{item.is_individual && <span className="text-muted" style={{fontSize:'0.75rem'}}> (pieza)</span>}</td>
                          <td className="qty-cell">
                            <input type="number" className="qty-input" min={qtyMin} step={qtyStep} value={item.quantity} onChange={(e) => updateCartItem(item.product_id, 'quantity', parseFloat(e.target.value) || 0, item.is_individual)} />
                            {unitLabel && <span className="unit-label">{unitLabel}</span>}
                          </td>
                          <td>{isCashier ? <span className="price-display">{formatMoney(item.unit_price)}</span> : <input type="number" className="price-input" step={isWeight ? "0.01" : "1"} value={item.unit_price} onChange={(e) => updateCartItem(item.product_id, 'unit_price', parseFloat(e.target.value) || 0, item.is_individual)} />}</td>
                          <td>{isCashier ? <span className="price-display">$0.00</span> : <input type="number" className="disc-input" step="0.01" value={item.discount} disabled={isCashier} onChange={(e) => updateCartItem(item.product_id, 'discount', parseFloat(e.target.value) || 0, item.is_individual)} />}</td>
                          <td className="subtotal-cell">{formatMoney(item.subtotal)}</td>
                          <td><button className="btn btn-danger btn-sm" onClick={() => removeFromCart(item.product_id, item.is_individual)}>X</button></td>
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
        <div className="modal-overlay" onKeyDown={modalKeys(() => setPaymentModal(false), () => { if (getPaymentTotal() >= total) handleCompleteSale() })}>
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
        <div className="modal-overlay" onClick={() => setCustomerModal(false)} onKeyDown={modalKeys(() => setCustomerModal(false), null)}>
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
        <div className="modal-overlay" onClick={() => setHistoryModal(false)} onKeyDown={modalKeys(() => setHistoryModal(false), () => setHistoryModal(false))}>
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
                      <td>{formatTime(s.created_at, { hour: '2-digit', minute: '2-digit' })}</td>
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

      {individualChoice && (
        <div className="modal-overlay" onClick={() => setIndividualChoice(null)} onKeyDown={modalKeys(() => setIndividualChoice(null), null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>{individualChoice.product.name}</h3>
            <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'1rem'}}>
              Este producto se puede vender por paquete completo o por pieza suelta. ¿Cómo lo vendes?
            </p>
            <div className="modal-actions" style={{flexDirection:'column', gap:'0.5rem'}}>
              <button className="btn btn-primary btn-block" onClick={() => confirmIndividualChoice(false)}>
                Paquete completo — ${(individualChoice.product.sale_price || 0).toFixed(2)}
              </button>
              <div style={{display:'flex', gap:'0.5rem', alignItems:'center', width:'100%'}}>
                <input
                  type="number" className="input" min="1" step="1" value={individualQty}
                  onChange={e => setIndividualQty(e.target.value)}
                  style={{width:'70px'}}
                />
                <button className="btn btn-secondary" style={{flex:1}} onClick={() => confirmIndividualChoice(true)}>
                  Individual — ${(individualChoice.product.individual_price || 0).toFixed(2)} c/u
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="modal-overlay" style={{display: showSecurityModal ? 'flex' : 'none'}} onClick={e => e.preventDefault()} onKeyDown={modalKeys(null, null)}>
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
        <div className="modal-overlay" onClick={() => setNewCustomerModal(false)} onKeyDown={modalKeys(() => { setNewCustomerModal(false); setError('') }, handleNewCustomer)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Nuevo Cliente</h3>
            <div className="form-group">
              <label>Nombre del Cliente *</label>
              <input type="text" className="input-lg" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} placeholder="Nombre completo" autoFocus />
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
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)} onKeyDown={modalKeys(() => setShowLogoutConfirm(false), handleLogoutConfirm)}>
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
        <div className="modal-overlay" onKeyDown={modalKeys(null, handleStartDay)}>
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
        <div className="modal-overlay" onKeyDown={modalKeys(null, handleEndDaySubmit)}>
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
        <div className="modal-overlay" onKeyDown={modalKeys(null, handleCashCountSubmit)}>
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
        <div className="modal-overlay" onClick={() => { setShowWithdrawalModal(false); setError('') }} onKeyDown={modalKeys(() => { setShowWithdrawalModal(false); setError('') }, handleWithdrawalSubmit)}>
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
        <div className="modal-overlay" onClick={() => setShowWithdrawalsList(false)} onKeyDown={modalKeys(() => setShowWithdrawalsList(false), () => setShowWithdrawalsList(false))}>
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
                        <td>{formatTime(w.created_at, { hour: '2-digit', minute: '2-digit' })}</td>
                        <td>{'$' + parseFloat(w.amount).toFixed(2)}</td>
                        <td style={{fontSize:'0.85rem'}}>{w.description.replace(/^Retiro de efectivo[^—]*—\s*/, '')}</td>
                        <td>
                          {user?.role === 'admin' && (
                            <button className="btn btn-sm btn-danger" onClick={() => handleCancelWithdrawal(w.id)}>Cancelar</button>
                          )}
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
        <div className="modal-overlay" onClick={() => setCancelModal(null)} onKeyDown={modalKeys(() => { setCancelModal(null); setCancelReason('') }, () => handleCancelSale(cancelModal.id))}>
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

      {showQueueModal && (
        <div className="modal-overlay" onClick={() => setShowQueueModal(false)} onKeyDown={modalKeys(() => setShowQueueModal(false), () => setShowQueueModal(false))}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Ventas Sin Sincronizar</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setShowQueueModal(false)}>Cerrar</button>
            </div>
            <div className="modal-body">
              <p className="text-muted">
                Las pendientes se reintentan solas al recuperar conexión. Las que fallaron el servidor las rechazó de verdad
                (ej. ya no hay stock, o se excedió el límite de crédito) — revísalas y decide si reintentar o descartar.
              </p>
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr><th>Hecha</th><th>Total</th><th>Cliente</th><th>Estado</th><th></th></tr>
                  </thead>
                  <tbody>
                    {offlineQueue.map(item => (
                      <tr key={item.id}>
                        <td style={{fontSize:'0.8rem'}}>{formatDateTime(item.createdAt)}</td>
                        <td>{formatMoney(item.payload.items.reduce((s, i) => s + (i.unit_price * i.quantity - (i.discount || 0)), 0) - (item.payload.discount || 0))}</td>
                        <td>{item.payload.customer_name || '-'}</td>
                        <td>
                          {item.status === 'failed'
                            ? <span className="badge badge-danger" title={item.error}>Rechazada: {item.error}</span>
                            : <span className="badge badge-warning">Pendiente de enviar</span>}
                        </td>
                        <td className="actions-cell">
                          {item.status === 'failed' && (
                            <>
                              <button className="btn btn-sm btn-outline" onClick={() => { retryFailed(item.id); refreshQueueState(); trySyncQueue() }}>Reintentar</button>
                              <button className="btn btn-sm btn-danger" onClick={async () => { if (await confirmDialog('¿Descartar esta venta? No se registrará en el sistema.')) { discardFailed(item.id); refreshQueueState() } }}>Descartar</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {offlineQueue.length === 0 && <tr><td colSpan="5" className="text-center">Sin ventas pendientes</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowQueueModal(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {saleDetail && (
        <div className="modal-overlay" onClick={() => setSaleDetail(null)} onKeyDown={modalKeys(() => setSaleDetail(null), () => setSaleDetail(null))}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Detalle de Venta #{saleDetail.id}</h2>
              <button className="btn btn-sm btn-outline" onClick={() => setSaleDetail(null)}>Cerrar</button>
            </div>
            <div className="modal-body">
              <div style={{display:'flex', gap:'2rem', marginBottom:'1rem', flexWrap:'wrap'}}>
                <div><strong>Fecha:</strong> {formatDate(saleDetail.created_at)}</div>
                <div><strong>Hora:</strong> {formatTime(saleDetail.created_at)}</div>
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
        <div className="modal-overlay" onClick={() => setShowCashierExpenseModal(false)} onKeyDown={modalKeys(() => { setShowCashierExpenseModal(false); setError('') }, handleCashierExpenseSubmit)}>
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

      {/* ---------- Paleta de comandos (F10 / Ctrl+K) ---------- */}
      {showPalette && (
        <CommandPalette
          state={STATES.CAPTURA}
          role={user?.role}
          onClose={() => setShowPalette(false)}
          onRun={(action) => {
            setShowPalette(false)
            const run = handlersRef.current[action.id]
            if (run) run()
            else if (action.hash) window.location.hash = action.hash
            else notify('Esa acción no está disponible aquí', 'error')
          }}
        />
      )}

      {/* ---------- Ayuda completa (F1) ---------- */}
      {showHelpSheet && (
        <div className="modal-overlay" onClick={() => setShowHelpSheet(false)} onKeyDown={modalKeys(() => setShowHelpSheet(false), () => setShowHelpSheet(false))}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Teclas disponibles</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setShowHelpSheet(false)}>Cerrar (Esc)</button>
            </div>
            <div className="modal-body">
              {Object.entries(
                actionsFor({ state: STATES.CAPTURA, role: user?.role })
                  .filter(a => a.keys.length > 0)
                  .reduce((acc, a) => { (acc[a.group || 'Otros'] ||= []).push(a); return acc }, {})
              ).map(([grupo, acciones]) => (
                <div key={grupo} className="help-sheet-group">
                  <h4>{grupo}</h4>
                  {acciones.map(a => (
                    <div key={a.id} className="help-sheet-row">
                      <span>{a.nombre} <span className="text-muted" style={{fontSize:'0.8rem'}}>— {a.descripcion}</span></span>
                      <span className="keys">{a.keys.map(k => <kbd key={k}>{keyLabel(k)}</kbd>)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="help-sheet-group">
                <h4>Línea de comando</h4>
                {[
                  ['código', 'Agrega el producto'],
                  ['3*código', 'Agrega 3 piezas'],
                  ['$50*código', 'Vende $50 de ese producto (granel)'],
                  ['3i*código', 'Vende 3 piezas sueltas (cigarros)'],
                  ['*5', 'Cambia a 5 la cantidad de la línea actual'],
                  ['?nombre', 'Busca por nombre'],
                  ['#cliente', 'Asigna cliente'],
                  ['%10', 'Descuento del 10% en la línea actual'],
                  ['=15.50', 'Precio manual en la línea actual'],
                  ['-código', 'Quita esa línea del ticket'],
                  ['/retiro  /gasto  /corte', 'Comandos del sistema'],
                ].map(([sintaxis, desc]) => (
                  <div key={sintaxis} className="help-sheet-row">
                    <span>{desc}</span>
                    <span className="keys"><kbd>{sintaxis}</kbd></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Ventas suspendidas (F7) ---------- */}
      {showSuspendedList && (
        <div className="modal-overlay" onClick={() => setShowSuspendedList(false)} onKeyDown={modalKeys(() => setShowSuspendedList(false), () => { if (suspendedList[0]) doResumeSale(suspendedList[0].id) })}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Ventas suspendidas ({suspendedList.length})</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setShowSuspendedList(false)}>Cerrar (Esc)</button>
            </div>
            <div className="modal-body">
              <p className="text-muted" style={{fontSize:'0.85rem'}}>Enter retoma la primera. También puedes elegir cualquiera de la lista.</p>
              <table className="table">
                <thead><tr><th>Hora</th><th>Cliente</th><th>Productos</th><th>Total</th><th></th></tr></thead>
                <tbody>
                  {suspendedList.map((s, i) => (
                    <tr key={s.id} className={i === 0 ? 'line-active' : ''}>
                      <td>{formatDateTime(s.createdAt, { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{s.customer?.name || '-'}</td>
                      <td>{s.itemCount} prod.</td>
                      <td>{formatMoney(s.total)}</td>
                      <td className="actions-cell">
                        <button className="btn btn-sm btn-primary" onClick={() => doResumeSale(s.id)}>Retomar</button>
                        <button className="btn btn-sm btn-danger" onClick={async () => {
                          if (await confirmDialog('¿Descartar esta venta suspendida?')) {
                            discardSuspended(s.id)
                            setSuspendedList(listSuspended())
                          }
                        }}>X</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Aviso no bloqueante: no roba el foco y se va solo ---------- */}
      {toast && (
        <div className={`toast toast-${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>
      )}

      {/* ---------- Barra de ayuda contextual (se genera del registro) ---------- */}
      <HelpBar state={posState} role={user?.role} />
    </div>
  )
}
