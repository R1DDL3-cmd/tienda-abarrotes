import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { suppliers as suppliersApi, purchases as purchasesApi, products as productsApi, settings as settingsApi } from '../api'
import { formatDate, formatDateTime } from '../dateUtils'
import { escapeHtml, buildStoreHeader, openTicketWindow } from '../ticketPrint'
import { modalKeys } from '../modalKeys'
import { confirmDialog } from '../confirmDialog'
import { useKeyboardLayer, focusCommandLine } from '../keyboard/input.js'
import { useActiveIndex } from '../keyboard/useActiveIndex.js'
import { STATES, actionsFor } from '../keyboard/registry.js'
import { parsePurchase, resolveCommand, ghostSuggestion, normalize, PURCHASE_COMMANDS } from '../keyboard/parser.js'
import { makeSuspendStore } from '../suspendedWork'
import * as PO from '../purchaseOrder'
import HelpBar from './HelpBar'
import CommandPalette from './CommandPalette'
import CommandLine from './CommandLine'

const suspendedOrders = makeSuspendStore('suspended_orders')

function money(n) {
  return '$' + (parseFloat(n) || 0).toFixed(2)
}

// ============================================================================
// COMPRAS Y PEDIDOS A PROVEEDORES
//
// Máquina de estados equivalente a la del POS: hacer un pedido debe sentirse
// tan rápido como cobrar una venta.
//
//   PROVEEDOR ──Enter/F4──> PEDIDO ──F4──> CONFIRMAR ──Enter──> PROVEEDOR
//                             │ │
//                        F6 suspende └──Esc──> PROVEEDOR (conserva el pedido)
//
//   PROVEEDOR ──F8──> PENDIENTES ──Enter──> RECEPCIÓN ──F4──> inventariado
//   PROVEEDOR ──F9──> POR PAGAR  ──Enter──> ABONO
//
// Las teclas NO están escritas aquí: salen del registro (keyboard/registry.js).
// Este componente solo aporta el comportamiento.
// ============================================================================
export default function Purchases({ user }) {
  const esAdmin = user?.role === 'admin'

  // --- Datos ---
  const [storeInfo, setStoreInfo] = useState({ store_name: 'Tienda de Abarrotes', store_address: '', store_phone: '' })
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch] = useState('')
  const [purchases, setPurchases] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(false)

  // --- Máquina de estados ---
  const [mode, setMode] = useState(STATES.PROVEEDOR)
  const [order, setOrder] = useState(null)
  const [cmd, setCmd] = useState('')
  const [undoStack, setUndoStack] = useState([])
  const [scanning, setScanning] = useState(false)
  const [toast, setToast] = useState(null)

  // Superpuestos que cambian de estado
  const [picker, setPicker] = useState(null)        // { kind, query, results, index }
  const [reception, setReception] = useState(null)  // { purchase, rows, row, col }
  const [payable, setPayable] = useState(null)      // { total_owed, purchases }
  const [payForm, setPayForm] = useState(null)      // { purchase, amount, method, notes }

  // Modales que no cambian el vocabulario de teclas
  const [supplierForm, setSupplierForm] = useState(null)
  const [productForm, setProductForm] = useState(null)
  const [detail, setDetail] = useState(null)
  const [resumeList, setResumeList] = useState(null)
  const [showPalette, setShowPalette] = useState(false)
  const [showHelpSheet, setShowHelpSheet] = useState(false)
  const [error, setError] = useState('')

  const cmdRef = useRef(null)
  const searchRef = useRef(null)
  const pickerRef = useRef(null)
  const gridRef = useRef({})

  // Índices de las listas navegables. Van en un ref además del estado porque
  // varias teclas seguidas (autorrepetición de ↓, o un usuario rápido) llegan
  // antes de que React vuelva a renderizar: sin eso, "↓ ↓ Supr" quitaría el
  // renglón equivocado. Ver keyboard/useActiveIndex.js.
  const provIdx = useActiveIndex(suppliers.length)
  const lineIdx = useActiveIndex(order?.items.length || 0)
  const pedidoIdx = useActiveIndex(purchases.length)
  const deudaIdx = useActiveIndex(payable?.purchases?.length || 0)

  const supplierIdx = provIdx.index
  const setSupplierIdx = provIdx.setIndex
  const activeLine = lineIdx.index
  const setActiveLine = lineIdx.setIndex
  const purchaseIdx = pedidoIdx.index
  const setPurchaseIdx = pedidoIdx.setIndex
  const payableIdx = deudaIdx.index
  const setPayableIdx = deudaIdx.setIndex

  const supplier = suppliers[provIdx.current()] || null

  // ---------------------------------------------------------------
  // Avisos que no bloquean ni roban el foco (principio 7: no confirmar,
  // ofrecer deshacer).
  // ---------------------------------------------------------------
  const notify = useCallback((text, kind = 'info') => {
    setToast({ text, kind, id: Date.now() })
    setTimeout(() => setToast(t => (t && Date.now() - t.id >= 2400 ? null : t)), 2500)
  }, [])

  // ---------------------------------------------------------------
  // Carga de datos
  // ---------------------------------------------------------------
  useEffect(() => { settingsApi.getStore().then(setStoreInfo).catch(() => {}) }, [])

  const loadSuppliers = useCallback(async (q = '') => {
    try {
      const data = await suppliersApi.list(q)
      setSuppliers(data)
      // No hace falta reajustar el índice: useActiveIndex lo acota solo al
      // nuevo tamaño de la lista.
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => {
    (async () => {
      try { await suppliersApi.syncFromProducts() } catch (_) {}
      loadSuppliers()
      try { const data = await productsApi.all(); setProducts(data.products || []) } catch (e) { setError(e.message) }
    })()
  }, [loadSuppliers])

  const loadPurchases = useCallback(async (supplierId) => {
    if (!supplierId) return
    setLoading(true)
    try {
      const data = await suppliersApi.purchases(supplierId)
      setPurchases(data)
      setPurchaseIdx(0)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { if (supplier) loadPurchases(supplier.id) }, [supplier?.id, loadPurchases])

  // Búsqueda de proveedor: incremental, sin botón (latencia < 100 ms).
  useEffect(() => {
    const t = setTimeout(() => loadSuppliers(search), 120)
    return () => clearTimeout(t)
  }, [search, loadSuppliers])

  // ---------------------------------------------------------------
  // Foco: siempre hay un campo activo, y se vuelve a él tras CUALQUIER
  // operación, incluidas las que fallan (principio 1).
  // ---------------------------------------------------------------
  useEffect(() => {
    if (mode === STATES.PEDIDO) focusCommandLine(cmdRef, { delay: 30 })
    else if (mode === STATES.PROVEEDOR) setTimeout(() => searchRef.current?.focus(), 30)
    else if (mode === STATES.BUSQUEDA) setTimeout(() => pickerRef.current?.focus(), 30)
  }, [mode])

  useEffect(() => {
    if (mode !== STATES.RECEPCION || !reception) return
    const el = gridRef.current[`${reception.row}:${reception.col}`]
    if (el) { el.focus(); el.select?.() }
  }, [mode, reception?.row, reception?.col])

  // ---------------------------------------------------------------
  // Deshacer: instantánea del pedido antes de cada cambio
  // ---------------------------------------------------------------
  const pushUndo = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-19), order])
  }, [order])

  const undo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) { notify('Nada que deshacer'); return prev }
      setOrder(prev[prev.length - 1])
      notify('Deshecho')
      return prev.slice(0, -1)
    })
  }, [notify])

  // ---------------------------------------------------------------
  // Pedido
  // ---------------------------------------------------------------
  const startOrder = useCallback((prov) => {
    const destino = prov || supplier
    if (!destino) { notify('Elige primero un proveedor', 'error'); return }
    if (order && order.items.length > 0 && order.supplier_id !== destino.id) {
      notify('Tienes un pedido en curso: F6 lo suspende', 'error')
      return
    }
    setOrder(prev => (prev && prev.supplier_id === destino.id ? prev : PO.emptyOrder(destino)))
    setActiveLine(0)
    setMode(STATES.PEDIDO)
  }, [supplier, order, notify])

  const productosDelProveedor = useMemo(() => {
    if (!order) return []
    return products.filter(p => PO.suppliesProduct(p, order.supplier_id))
  }, [products, order?.supplier_id])

  const addProduct = useCallback((product, qty = 1) => {
    setOrder(prev => {
      if (!prev) return prev
      const { order: next, index } = PO.addItem(prev, product, { qty })
      setActiveLine(index)
      if (!PO.suppliesProduct(product, prev.supplier_id)) {
        // No se frena la ráfaga del lector por un dato de catálogo: se agrega
        // y se avisa. /vincular lo liga si el usuario quiere.
        notify(`${product.name} no es de este proveedor — /vincular lo liga`, 'error')
      }
      return next
    })
  }, [notify])

  const buscarProducto = useCallback((query, todoElCatalogo = false) => {
    const q = normalize(query)
    const base = todoElCatalogo ? products : productosDelProveedor
    const results = base.filter(p =>
      normalize(p.name).includes(q) || (p.barcode && p.barcode.includes(query))
    ).slice(0, 40)
    setPicker({ kind: 'producto', query, results, index: 0, todoElCatalogo })
    setMode(STATES.BUSQUEDA)
  }, [products, productosDelProveedor])

  const buscarProveedor = useCallback((query) => {
    const q = normalize(query || '')
    const results = suppliers.filter(s => normalize(s.name).includes(q)).slice(0, 40)
    setPicker({ kind: 'proveedor', query: query || '', results, index: 0 })
    setMode(STATES.BUSQUEDA)
  }, [suppliers])

  const elegirDelPicker = useCallback(() => {
    if (!picker) return
    const elegido = picker.results[picker.index]
    if (!elegido) { notify('Nada que elegir'); return }
    if (picker.kind === 'producto') {
      addProduct(elegido, 1)
      setPicker(null)
      setMode(STATES.PEDIDO)
    } else {
      const idx = suppliers.findIndex(s => s.id === elegido.id)
      if (idx >= 0) setSupplierIdx(idx)
      setPicker(null)
      if (order) {
        setOrder(prev => ({ ...prev, supplier_id: elegido.id, supplier_name: elegido.name }))
        setMode(STATES.PEDIDO)
        notify(`Proveedor: ${elegido.name}`)
      } else {
        setMode(STATES.PROVEEDOR)
      }
    }
  }, [picker, suppliers, order, addProduct, notify])

  const suspendOrder = useCallback(() => {
    if (!order || order.items.length === 0) { notify('No hay nada que suspender'); return }
    suspendedOrders.suspend(order, {
      supplier_name: order.supplier_name,
      itemCount: order.items.length,
      total: PO.totals(order).total,
      userName: user?.name || '',
    })
    setOrder(null)
    setUndoStack([])
    setMode(STATES.PROVEEDOR)
    notify('Pedido suspendido — F7 para retomarlo', 'success')
  }, [order, user, notify])

  const openResumeList = useCallback(() => {
    const list = suspendedOrders.list()
    if (list.length === 0) { notify('No hay pedidos suspendidos'); return }
    setResumeList(list)
  }, [notify])

  const doResume = useCallback((id) => {
    const found = suspendedOrders.resume(id)
    if (!found) return
    if (order && order.items.length > 0) {
      suspendedOrders.suspend(order, {
        supplier_name: order.supplier_name, itemCount: order.items.length,
        total: PO.totals(order).total, userName: user?.name || '',
      })
    }
    setOrder(found.payload)
    const idx = suppliers.findIndex(s => s.id === found.payload.supplier_id)
    if (idx >= 0) setSupplierIdx(idx)
    setResumeList(null)
    setUndoStack([])
    setActiveLine(0)
    setMode(STATES.PEDIDO)
    notify('Pedido retomado', 'success')
  }, [order, suppliers, user, notify])

  const suggest = useCallback(async () => {
    if (!order) return
    try {
      const data = await suppliersApi.suggestedOrder(order.supplier_id)
      if (!data.items || data.items.length === 0) {
        notify('Nada por reponer de este proveedor ahora mismo')
        return
      }
      pushUndo()
      setOrder(prev => {
        const existentes = new Set(prev.items.map(i => i.product_id))
        const nuevos = data.items.filter(i => !existentes.has(i.product_id)).map(i => ({
          product_id: i.product_id,
          product_name: i.product_name,
          barcode: i.barcode || '',
          quantity: i.suggested_quantity,
          unit_price: i.unit_price || 0,
          subtotal: Math.round(i.suggested_quantity * (i.unit_price || 0) * 100) / 100,
          ajeno: false,
        }))
        return { ...prev, items: [...prev.items, ...nuevos] }
      })
      notify(`${data.items.length} producto(s) por reponer — Ctrl+Z deshace`, 'success')
    } catch (e) { setError(e.message) }
  }, [order, pushUndo, notify])

  const linkActiveProduct = useCallback(async () => {
    const n = lineIdx.current()
    const item = order?.items[n]
    if (!item) { notify('No hay renglón activo'); return }
    try {
      await productsApi.addSupplier(item.product_id, { supplier_id: order.supplier_id, purchase_price: item.unit_price })
      const data = await productsApi.all()
      setProducts(data.products || [])
      setOrder(prev => ({ ...prev, items: prev.items.map((it, i) => (i === n ? { ...it, ajeno: false } : it)) }))
      notify(`${item.product_name} ligado a ${order.supplier_name}`, 'success')
    } catch (e) { notify(e.message, 'error') }
  }, [order, activeLine, notify])

  const saveOrder = useCallback(async () => {
    if (!order || order.items.length === 0) { notify('El pedido está vacío', 'error'); return }
    setMode(STATES.CONFIRMAR)
  }, [order, notify])

  const confirmOrder = useCallback(async () => {
    if (!order) return
    try {
      await purchasesApi.create({
        supplier_id: order.supplier_id,
        invoice_number: order.invoice_number,
        notes: order.notes,
        status: order.kind,
        payment_type: order.payment === 'credit' ? 'credit' : 'cash',
        due_date: order.due_date || '',
        items: order.items.map(i => ({
          product_id: i.product_id, product_name: i.product_name,
          quantity: i.quantity, unit_price: i.unit_price, subtotal: i.subtotal,
        })),
      })
      const nombre = order.supplier_name
      setOrder(null)
      setUndoStack([])
      setMode(STATES.PROVEEDOR)
      loadPurchases(order.supplier_id)
      notify(order.kind === 'pending' ? `Pedido a ${nombre} guardado` : `Compra a ${nombre} registrada e inventariada`, 'success')
    } catch (e) {
      setError(e.message)
      setMode(STATES.PEDIDO)   // el foco vuelve al pedido aunque falle
    }
  }, [order, loadPurchases, notify])

  // ---------------------------------------------------------------
  // Recepción
  // ---------------------------------------------------------------
  const openReception = useCallback(async (purchaseId) => {
    try {
      const data = await purchasesApi.get(purchaseId)
      if (data.status !== 'pending') { notify('Ese pedido ya no está pendiente', 'error'); return }
      setReception({ purchase: data, rows: PO.receptionRows(data), row: 0, col: 0 })
      setMode(STATES.RECEPCION)
    } catch (e) { setError(e.message) }
  }, [notify])

  const confirmReception = useCallback(async () => {
    if (!reception) return
    try {
      await purchasesApi.receive(reception.purchase.id, reception.rows.map(r => ({
        id: r.id,
        received_quantity: r.received_quantity,
        received_unit_price: r.received_unit_price,
      })))
      const faltantes = reception.rows.filter(r => r.received_quantity === 0).length
      setReception(null)
      setMode(STATES.PROVEEDOR)
      if (supplier) loadPurchases(supplier.id)
      notify(faltantes > 0
        ? `Recibido e inventariado — ${faltantes} producto(s) no llegaron`
        : 'Recibido e inventariado', 'success')
    } catch (e) {
      setError(e.message)   // se queda en la rejilla: nada se pierde
    }
  }, [reception, supplier, loadPurchases, notify])

  // ---------------------------------------------------------------
  // Cuentas por pagar y abonos
  // ---------------------------------------------------------------
  const openPayable = useCallback(async () => {
    if (!esAdmin) { notify('Solo el dueño registra pagos a proveedores', 'error'); return }
    try {
      const data = await purchasesApi.accountsPayable()
      setPayable(data)
      setPayableIdx(0)
      setMode(STATES.PORPAGAR)
      if (!data.purchases || data.purchases.length === 0) notify('No debes nada a ningún proveedor')
    } catch (e) { setError(e.message) }
  }, [esAdmin, notify])

  const openPayForm = useCallback(() => {
    const compra = payable?.purchases?.[deudaIdx.current()]
    if (!compra) { notify('Nada que abonar'); return }
    // El monto llega preseleccionado con el saldo total: Enter = pago completo.
    setPayForm({ purchase: compra, amount: (compra.balance || 0).toFixed(2), method: 'cash', notes: '' })
    setMode(STATES.ABONO)
  }, [payable, payableIdx, notify])

  const submitPayment = useCallback(async () => {
    if (!payForm) return
    const amount = parseFloat(payForm.amount)
    if (!amount || amount <= 0) { notify('Monto inválido', 'error'); return }
    try {
      await purchasesApi.addPayment(payForm.purchase.id, {
        amount, payment_method: payForm.method, notes: payForm.notes || null,
      })
      setPayForm(null)
      const data = await purchasesApi.accountsPayable()
      setPayable(data)
      setMode(STATES.PORPAGAR)
      if (supplier) loadPurchases(supplier.id)
      notify(`Abono de ${money(amount)} registrado`, 'success')
    } catch (e) {
      setError(e.message)   // sigue en el abono, con el monto tal cual
    }
  }, [payForm, supplier, loadPurchases, notify])

  // ---------------------------------------------------------------
  // Impresión
  // ---------------------------------------------------------------
  const printPurchase = useCallback((purchase) => {
    const itemsHtml = (purchase.items || []).map(item => `
      <tr>
        <td class="product-name">${escapeHtml(item.product_name)}</td>
        <td style="text-align:center">${item.quantity}</td>
        <td style="text-align:right">$${(item.unit_price || 0).toFixed(2)}</td>
        <td style="text-align:right">$${(item.subtotal || 0).toFixed(2)}</td>
      </tr>`).join('')
    const statusLabel = { pending: 'PEDIDO PENDIENTE', completed: 'COMPRA RECIBIDA', cancelled: 'CANCELADA' }[purchase.status] || purchase.status
    const bodyHtml = `
      <div class="center">
        ${buildStoreHeader(storeInfo)}
        <p><strong>${statusLabel}</strong></p>
        <p>Pedido #${purchase.id}${purchase.invoice_number ? ' — Factura: ' + escapeHtml(purchase.invoice_number) : ''}</p>
        <p>${formatDateTime(purchase.created_at)}</p>
        <p>Proveedor: ${escapeHtml(purchase.supplier_name)}</p>
      </div>
      <div class="line"></div>
      <table>
        <colgroup><col style="width:46%"><col style="width:16%"><col style="width:19%"><col style="width:19%"></colgroup>
        <tr><th style="text-align:left">Producto</th><th>Cant</th><th style="text-align:right">Precio</th><th style="text-align:right">Subtotal</th></tr>
        ${itemsHtml}
      </table>
      <div class="line"></div>
      <div class="right">
        <p>Subtotal: $${(purchase.subtotal || 0).toFixed(2)}</p>
        <p>IVA: $${(purchase.tax || 0).toFixed(2)}</p>
        <div class="total-box"><p class="total-amount">TOTAL: $${(purchase.total || 0).toFixed(2)}</p></div>
      </div>`
    const win = openTicketWindow({ title: `Pedido #${purchase.id}`, bodyHtml })
    if (!win) setError('El navegador bloqueó la ventana de impresión')
  }, [storeInfo])

  const printActive = useCallback(async () => {
    try {
      if (mode === STATES.PEDIDO && order) {
        const t = PO.totals(order)
        printPurchase({ id: '—', status: 'pending', created_at: new Date().toISOString(),
          supplier_name: order.supplier_name, items: order.items, ...t })
        return
      }
      const p = purchases[purchaseIdx]
      if (p) printPurchase(await purchasesApi.get(p.id))
    } catch (e) { setError(e.message) }
  }, [mode, order, purchases, purchaseIdx, printPurchase])

  // ---------------------------------------------------------------
  // CAPA DE TECLADO — el registro dice QUÉ tecla, esto dice QUÉ hace
  // ---------------------------------------------------------------
  const handlers = {
    sys_help: () => setShowHelpSheet(true),
    sys_palette: () => setShowPalette(true),

    // Estado PROVEEDOR
    compras_search_supplier: () => searchRef.current?.focus(),
    compras_pick_supplier: () => buscarProveedor(''),
    compras_new_order: () => startOrder(),
    compras_new_supplier: () => setSupplierForm({ name: '', contact: '', phone: '', email: '', address: '', notes: '' }),
    compras_orders: () => { if (purchases.length === 0) { notify('Este proveedor no tiene pedidos'); return } setMode(STATES.PENDIENTES) },
    compras_payable: () => openPayable(),
    compras_resume: () => openResumeList(),
    compras_supplier_prev: () => provIdx.move(-1),
    compras_supplier_next: () => provIdx.move(1),

    // Estado PEDIDO
    compras_search_product: () => buscarProducto(''),
    compras_save_order: () => saveOrder(),
    compras_suggest: () => suggest(),
    compras_suspend: () => suspendOrder(),
    compras_new_product: () => setProductForm({ name: '', barcode: '', purchase_price: '', sale_price: '', quantity: '1' }),
    compras_remove_line: () => {
      if (!order?.items.length) { notify('El pedido está vacío'); return }
      const n = lineIdx.current()
      const item = order.items[n]
      pushUndo()
      setOrder(prev => PO.removeItem(prev, n))
      lineIdx.move(-1)
      notify(`Quitado: ${item.product_name} — Ctrl+Z deshace`)
    },
    compras_undo: () => undo(),
    compras_qty_up: () => {
      const n = lineIdx.current()
      pushUndo(); setOrder(prev => PO.setQty(prev, n, (prev.items[n]?.quantity || 0) + 1))
    },
    compras_qty_down: () => {
      const n = lineIdx.current()
      const actual = order?.items[n]?.quantity || 0
      if (actual <= 1) { notify('Usa Supr para quitar el renglón'); return }
      pushUndo(); setOrder(prev => PO.setQty(prev, n, actual - 1))
    },
    compras_line_prev: () => lineIdx.move(-1),
    compras_line_next: () => lineIdx.move(1),
    compras_print_order: () => printActive(),
    compras_link_supplier: () => linkActiveProduct(),

    // Estado CONFIRMAR
    compras_confirm_cash: () => setOrder(prev => ({ ...prev, payment: 'cash' })),
    compras_confirm_card: () => setOrder(prev => ({ ...prev, payment: 'card' })),
    compras_confirm_transfer: () => setOrder(prev => ({ ...prev, payment: 'transfer' })),
    compras_confirm_credit: () => setOrder(prev => ({ ...prev, payment: 'credit' })),
    compras_confirm_kind_prev: () => setOrder(prev => ({ ...prev, kind: 'pending' })),
    compras_confirm_kind_next: () => setOrder(prev => ({ ...prev, kind: 'completed' })),
    compras_confirm_save: () => confirmOrder(),

    // Estado PENDIENTES
    compras_receive: () => {
      const p = purchases[pedidoIdx.current()]
      if (!p) { notify('Nada que recibir'); return }
      if (p.status !== 'pending') { notify('Ese pedido ya fue recibido o cancelado', 'error'); return }
      openReception(p.id)
    },
    compras_order_prev: () => pedidoIdx.move(-1),
    compras_order_next: () => pedidoIdx.move(1),

    // Estado RECEPCIÓN
    recepcion_confirm: () => confirmReception(),
    recepcion_all_ok: () => {
      setReception(r => ({ ...r, rows: PO.allAsOrdered(r.rows) }))
      notify('Todo marcado como llegó igual a lo pedido', 'success')
    },
    recepcion_missing: () => {
      setReception(r => ({ ...r, rows: PO.markMissing(r.rows, r.row) }))
      notify('Marcado como no llegó — Ctrl+Z deshace')
    },
    recepcion_row_prev: () => setReception(r => ({ ...r, row: Math.max(0, r.row - 1) })),
    recepcion_row_next: () => setReception(r => ({ ...r, row: Math.min(r.rows.length - 1, r.row + 1) })),
    recepcion_col_prev: () => setReception(r => ({ ...r, col: Math.max(0, r.col - 1) })),
    recepcion_col_next: () => setReception(r => ({ ...r, col: Math.min(1, r.col + 1) })),

    // Estado POR PAGAR / ABONO
    porpagar_pay: () => openPayForm(),
    porpagar_prev: () => deudaIdx.move(-1),
    porpagar_next: () => deudaIdx.move(1),
    cobro_cash: () => setPayForm(f => ({ ...f, method: 'cash' })),
    cobro_card: () => setPayForm(f => ({ ...f, method: 'card' })),
    cobro_transfer: () => setPayForm(f => ({ ...f, method: 'transfer' })),
    cobro_d20: () => addToPayment(20),
    cobro_d50: () => addToPayment(50),
    cobro_d100: () => addToPayment(100),
    cobro_d200: () => addToPayment(200),
    cobro_d500: () => addToPayment(500),
  }

  function addToPayment(amount) {
    setPayForm(f => ({ ...f, amount: ((parseFloat(f.amount) || 0) + amount).toFixed(2) }))
  }

  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const modalAbierto = !!(supplierForm || productForm || detail || resumeList || showPalette || showHelpSheet)

  useKeyboardLayer({
    state: modalAbierto ? STATES.MODAL : mode,
    role: user?.role,
    handlers,
    commandLineRef: cmdRef,
    isCommandLineEmpty: () => !cmd,
    onScanStateChange: setScanning,
  })

  // ---------------------------------------------------------------
  // "Enter avanza, Esc retrocede" — regla universal de la app, no un atajo
  // configurable: por eso vive aquí y no en el registro.
  // ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      const avanza = e.key === 'Enter'

      // Los modales tienen su propio Enter/Esc (modalKeys); aquí solo se
      // cierran los superpuestos del sistema.
      if (showPalette) { if (!avanza) { e.preventDefault(); setShowPalette(false) } return }
      if (showHelpSheet) { e.preventDefault(); setShowHelpSheet(false); return }
      if (supplierForm || productForm || detail || resumeList) return

      switch (mode) {
        case STATES.PROVEEDOR:
          if (avanza) { e.preventDefault(); startOrder() }
          else if (search) { e.preventDefault(); setSearch('') }
          break
        case STATES.PEDIDO:
          // Enter en el pedido lo consume la línea de comando; Esc conserva el
          // pedido y vuelve a proveedores (no se pierde nada).
          if (!avanza) { e.preventDefault(); setMode(STATES.PROVEEDOR); notify('Pedido guardado en curso — F4 lo retoma') }
          break
        case STATES.BUSQUEDA:
          e.preventDefault()
          if (avanza) elegirDelPicker()
          else { setPicker(null); setMode(order ? STATES.PEDIDO : STATES.PROVEEDOR) }
          break
        case STATES.CONFIRMAR:
          e.preventDefault()
          if (avanza) confirmOrder()
          else setMode(STATES.PEDIDO)
          break
        case STATES.PENDIENTES:
          e.preventDefault()
          if (avanza) handlersRef.current.compras_receive()
          else setMode(STATES.PROVEEDOR)
          break
        case STATES.RECEPCION:
          e.preventDefault()
          if (avanza) {
            // Enter confirma la celda y baja al siguiente renglón (Excel).
            setReception(r => (r.row >= r.rows.length - 1 ? r : { ...r, row: r.row + 1 }))
          } else {
            const salir = async () => {
              if (PO.hasAdjustments(reception.rows) && !(await confirmDialog('Hay ajustes sin guardar. ¿Salir de la recepción?'))) return
              setReception(null); setMode(STATES.PROVEEDOR)
            }
            salir()
          }
          break
        case STATES.PORPAGAR:
          e.preventDefault()
          if (avanza) openPayForm()
          else { setPayable(null); setMode(STATES.PROVEEDOR) }
          break
        case STATES.ABONO:
          e.preventDefault()
          if (avanza) submitPayment()
          else { setPayForm(null); setMode(STATES.PORPAGAR) }
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, search, order, reception, showPalette, showHelpSheet, supplierForm, productForm, detail,
      resumeList, startOrder, elegirDelPicker, confirmOrder, openPayForm, submitPayment, notify])

  // Navegación con flechas dentro del buscador superpuesto (clase lista).
  useEffect(() => {
    if (mode !== STATES.BUSQUEDA) return
    const onKey = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      e.preventDefault()
      setPicker(p => p && ({ ...p, index: e.key === 'ArrowDown'
        ? Math.min(p.results.length - 1, p.index + 1)
        : Math.max(0, p.index - 1) }))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode])

  // ---------------------------------------------------------------
  // LÍNEA DE COMANDO — el parser decide la intención; esto la ejecuta
  // ---------------------------------------------------------------
  const runCommand = useCallback(async (texto) => {
    const parsed = parsePurchase(texto)

    switch (parsed.type) {
      case 'empty':
        return

      case 'invalid':
        notify(parsed.reason, 'error')
        return

      case 'search':
        buscarProducto(parsed.query, !!parsed.all)
        return

      case 'supplier':
        buscarProveedor(parsed.query)
        return

      case 'set_qty': {
        if (!order?.items.length) { notify('El pedido está vacío'); return }
        pushUndo()
        const n = lineIdx.current()
        setOrder(prev => PO.setQty(prev, n, parsed.qty))
        notify(`${order.items[n]?.product_name} → ${parsed.qty}`)
        return
      }

      case 'set_cost': {
        if (!order?.items.length) { notify('El pedido está vacío'); return }
        pushUndo()
        setOrder(prev => PO.setCost(prev, lineIdx.current(), parsed.value))
        notify(`Costo: ${money(parsed.value)}`)
        return
      }

      case 'remove': {
        const idx = order?.items.findIndex(i => i.barcode === parsed.code || String(i.product_id) === parsed.code)
        if (idx == null || idx < 0) { notify('Ese producto no está en el pedido', 'error'); return }
        pushUndo()
        setOrder(prev => PO.removeItem(prev, idx))
        notify('Renglón quitado — Ctrl+Z deshace')
        return
      }

      case 'command': {
        const actionId = resolveCommand(parsed.command, PURCHASE_COMMANDS)
        if (!actionId) { notify(`No conozco el comando "/${parsed.command}"`, 'error'); return }
        const accion = actionsFor({ state: mode, role: user?.role }).find(a => a.id === actionId)
        if (accion?.hash) { window.location.hash = accion.hash; return }
        const run = handlersRef.current[actionId]
        if (run) run()
        else notify('Esa acción no está disponible aquí', 'error')
        return
      }

      case 'product': {
        const code = parsed.code
        let product = products.find(p => p.barcode === code || String(p.id) === code)
        if (!product) {
          try { product = await productsApi.getByBarcode(code) } catch (e) { product = null }
        }
        if (!product) {
          // No existe como código: se cae a búsqueda por nombre sin perder lo
          // escrito (misma regla que el POS).
          buscarProducto(code, false)
          return
        }
        let qty = parsed.qty
        if (parsed.amount) {
          const costo = PO.costFor(product, order.supplier_id)
          if (costo <= 0) { notify('Ese producto no tiene costo: usa =costo', 'error'); return }
          qty = Math.round((parsed.amount / costo) * 1000) / 1000
        }
        pushUndo()
        addProduct(product, qty || 1)
        return
      }

      default:
        return
    }
  }, [order, activeLine, products, mode, user, pushUndo, addProduct, buscarProducto, buscarProveedor, notify])

  // Atajo desde otras secciones: #/purchases?nuevo=1 abre un pedido listo.
  useEffect(() => {
    if (!window.location.hash.includes('nuevo=1')) return
    if (suppliers.length === 0) return
    startOrder(suppliers[0])
    window.location.hash = '#/purchases'
  }, [suppliers.length])   // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------
  // Vista
  // ---------------------------------------------------------------
  const t = order ? PO.totals(order) : { subtotal: 0, tax: 0, total: 0 }
  const etiquetaModo = {
    [STATES.PROVEEDOR]: 'PROVEEDOR', [STATES.PEDIDO]: 'PEDIDO', [STATES.CONFIRMAR]: 'CONFIRMAR',
    [STATES.PENDIENTES]: 'PEDIDOS', [STATES.RECEPCION]: 'RECEPCIÓN', [STATES.PORPAGAR]: 'POR PAGAR',
    [STATES.ABONO]: 'ABONO', [STATES.BUSQUEDA]: 'BUSCAR',
  }[mode] || 'COMPRAS'

  return (
    <div className="purchases-container">
      <div className="page-header">
        <h2>
          Compras y Pedidos
          {/* El estado SIEMPRE visible: el usuario nunca adivina dónde está */}
          <span className={`state-badge state-${mode}`} style={{marginLeft:'0.6rem'}}>{etiquetaModo}</span>
        </h2>
        <div style={{display:'flex', gap:'0.5rem'}}>
          {esAdmin && <button className="btn btn-outline" onClick={openPayable}>Por Pagar <kbd>F9</kbd></button>}
          <button className="btn btn-outline" onClick={() => setSupplierForm({ name: '', contact: '', phone: '', email: '', address: '', notes: '' })}>Nuevo Proveedor <kbd>Ins</kbd></button>
          <button className="btn btn-primary" onClick={() => startOrder()}>Nuevo Pedido <kbd>F4</kbd></button>
        </div>
      </div>

      {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}

      {/* ---------- PEDIDO / CONFIRMAR: espacio de trabajo a pantalla completa ---------- */}
      {(mode === STATES.PEDIDO || mode === STATES.CONFIRMAR || mode === STATES.BUSQUEDA) && order ? (
        <div className="order-workspace">
          <div className="order-main">
            <CommandLine
              inputRef={cmdRef}
              value={cmd}
              onChange={setCmd}
              onSubmit={runCommand}
              suggest={(v) => ghostSuggestion(v, PURCHASE_COMMANDS)}
              scanning={scanning}
              placeholder={`Pedido a ${order.supplier_name} — escanea, o escribe: código · 3*código · ?nombre · =costo · /comando`}
            />

            <div className="cart-section" style={{marginTop:'0.5rem'}}>
              <div className="cart-header">
                <h3>{order.supplier_name}</h3>
                <span className="text-muted">{order.items.length} renglón(es)</span>
              </div>
              {order.items.length === 0 ? (
                <div className="cart-empty">Escanea o teclea un código. F5 llena el pedido con lo que se está acabando.</div>
              ) : (
                <div className="cart-table-wrap">
                  <table className="cart-table">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th style={{width:90}}>Cantidad</th>
                        <th style={{width:110}}>Costo</th>
                        <th style={{width:110}}>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item, idx) => (
                        <tr key={`${item.product_id}_${idx}`}
                            className={idx === Math.min(activeLine, order.items.length - 1) ? 'line-active' : ''}
                            onClick={() => setActiveLine(idx)}>
                          <td>
                            {item.product_name}
                            {item.ajeno && <span className="badge badge-warning" style={{marginLeft:'0.35rem'}} title="No está ligado a este proveedor — /vincular lo liga">ajeno</span>}
                          </td>
                          <td className="money">{item.quantity}</td>
                          <td className="price-cell money">{money(item.unit_price)}</td>
                          <td className="subtotal-cell money">{money(item.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="pos-right">
            <div className="pos-summary">
              <div className="summary-row"><span>Subtotal</span><span className="money money-sub">{money(t.subtotal)}</span></div>
              <div className="summary-row"><span>IVA (16%)</span><span className="money money-sub">{money(t.tax)}</span></div>
              <div className="summary-total">
                <span className="summary-total-label">Total del pedido</span>
                <span className="money money-total">{money(t.total)}</span>
              </div>
            </div>

            {mode === STATES.CONFIRMAR ? (
              <div className="card confirm-panel">
                <h3>Confirmar</h3>
                <div className="confirm-row">
                  <span>Tipo</span>
                  <strong>{order.kind === 'pending' ? 'Pedido pendiente' : 'Compra recibida ahora'}</strong>
                </div>
                <div className="text-muted" style={{fontSize:'0.78rem'}}>← → cambia el tipo</div>
                <div className="confirm-row" style={{marginTop:'0.5rem'}}>
                  <span>Pago</span>
                  <strong>{{ cash: 'Contado · efectivo', card: 'Contado · tarjeta', transfer: 'Contado · transferencia', credit: 'A crédito (queda a deber)' }[order.payment]}</strong>
                </div>
                <div className="text-muted" style={{fontSize:'0.78rem'}}>F1 efectivo · F2 tarjeta · F3 transferencia · F9 crédito</div>
                {order.payment === 'credit' && (
                  <div className="form-group" style={{marginTop:'0.5rem'}}>
                    <label>Fecha límite de pago</label>
                    <input type="date" className="input" value={order.due_date}
                      onChange={e => setOrder(prev => ({ ...prev, due_date: e.target.value }))} />
                  </div>
                )}
                <div className="form-group">
                  <label>Factura / folio</label>
                  <input type="text" className="input" value={order.invoice_number}
                    onChange={e => setOrder(prev => ({ ...prev, invoice_number: e.target.value }))} />
                </div>
                <button className="btn btn-primary btn-lg btn-block btn-cobrar" onClick={confirmOrder}>
                  <span>Confirmar</span><span className="money money-sub">{money(t.total)}</span>
                </button>
                <div className="text-muted" style={{fontSize:'0.78rem', marginTop:'0.35rem'}}>Enter confirma · Esc regresa al pedido</div>
              </div>
            ) : (
              <div className="pos-actions">
                <button className="btn btn-outline btn-block" onClick={suggest}>Sugerir reposición <kbd>F5</kbd></button>
                <button className="btn btn-secondary btn-block" onClick={suspendOrder}>Suspender <kbd>F6</kbd></button>
                <button className="btn btn-primary btn-lg btn-block btn-cobrar" onClick={saveOrder}>
                  <span>Guardar pedido</span><span className="money money-sub">{money(t.total)}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : mode === STATES.RECEPCION && reception ? (
        /* ---------- RECEPCIÓN: rejilla tipo hoja de cálculo ---------- */
        <div className="card">
          <div className="card-header">
            <h3>Recibir pedido #{reception.purchase.id} — {reception.purchase.supplier_name}</h3>
            <span className="text-muted">↑↓ renglón · Tab/→ columna · escribe para corregir · Enter baja</span>
          </div>
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th><th>Pedido</th>
                  <th style={{width:130}}>Cantidad recibida</th>
                  <th style={{width:130}}>Costo recibido</th>
                  <th style={{width:120}}>Importe</th>
                </tr>
              </thead>
              <tbody>
                {reception.rows.map((r, idx) => (
                  <tr key={r.id} className={idx === reception.row ? 'row-selected' : ''}
                      onClick={() => setReception(x => ({ ...x, row: idx }))}>
                    <td>{r.product_name}</td>
                    <td className="text-muted money">{r.ordered_quantity} × {money(r.ordered_unit_price)}</td>
                    <td>
                      <input
                        ref={el => { gridRef.current[`${idx}:0`] = el }}
                        type="number" min="0" step="0.01" className="qty-input"
                        value={r.received_quantity}
                        onChange={e => setReception(x => ({ ...x, rows: PO.setCell(x.rows, idx, 'received_quantity', e.target.value) }))}
                        onFocus={() => setReception(x => (x.row === idx && x.col === 0 ? x : { ...x, row: idx, col: 0 }))}
                      />
                    </td>
                    <td>
                      <input
                        ref={el => { gridRef.current[`${idx}:1`] = el }}
                        type="number" min="0" step="0.01" className="price-input"
                        value={r.received_unit_price}
                        onChange={e => setReception(x => ({ ...x, rows: PO.setCell(x.rows, idx, 'received_unit_price', e.target.value) }))}
                        onFocus={() => setReception(x => (x.row === idx && x.col === 1 ? x : { ...x, row: idx, col: 1 }))}
                      />
                    </td>
                    <td className="subtotal-cell money">
                      {r.received_quantity === 0
                        ? <span className="badge badge-danger">no llegó</span>
                        : money(r.received_quantity * r.received_unit_price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="purchase-totals">
            <div className="total-row"><span>Subtotal:</span><span className="money">{money(PO.receptionTotal(reception.rows).subtotal)}</span></div>
            <div className="total-row"><span>IVA (16%):</span><span className="money">{money(PO.receptionTotal(reception.rows).tax)}</span></div>
            <div className="total-row total-final"><span>Total:</span><span className="money money-sub">{money(PO.receptionTotal(reception.rows).total)}</span></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-outline" onClick={() => handlers.recepcion_all_ok()}>Todo llegó igual <kbd>F5</kbd></button>
            <button className="btn btn-primary" onClick={confirmReception}>Confirmar recepción <kbd>F4</kbd></button>
          </div>
        </div>
      ) : mode === STATES.PORPAGAR || mode === STATES.ABONO ? (
        /* ---------- CUENTAS POR PAGAR ---------- */
        <div className="card">
          <div className="card-header">
            <h3>Cuentas por pagar</h3>
            <span className="money money-sub">{money(payable?.total_owed || 0)}</span>
          </div>
          {!payable ? <div className="loading">Cargando...</div> : payable.purchases.length === 0 ? (
            <p className="text-muted">No debes nada a ningún proveedor.</p>
          ) : (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr><th>Proveedor</th><th>Compra</th><th>Total</th><th>Pagado</th><th>Debe</th><th>Límite</th></tr>
                </thead>
                <tbody>
                  {payable.purchases.map((p, idx) => (
                    <tr key={p.id} className={idx === payableIdx ? 'row-selected' : ''} onClick={() => setPayableIdx(idx)}>
                      <td>{p.supplier_name}</td>
                      <td>#{p.id}{p.invoice_number ? ` (${p.invoice_number})` : ''}</td>
                      <td className="money">{money(p.total)}</td>
                      <td className="money">{money(p.amount_paid)}</td>
                      <td className="money"><strong>{money(p.balance)}</strong></td>
                      <td>{p.due_date ? <span className={p.overdue ? 'badge badge-error' : ''}>{formatDate(p.due_date)}{p.overdue ? ' ¡Vencida!' : ''}</span> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => { setPayable(null); setMode(STATES.PROVEEDOR) }}>Cerrar <kbd>Esc</kbd></button>
            <button className="btn btn-primary" onClick={openPayForm}>Abonar <kbd>Enter</kbd></button>
          </div>
        </div>
      ) : (
        /* ---------- PROVEEDOR / PENDIENTES: estado base ---------- */
        <div className="purchases-layout">
          <div className="suppliers-panel">
            <div className="form-group">
              <input ref={searchRef} type="text" className="input" placeholder="Buscar proveedor... (F2)"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="suppliers-list">
              {suppliers.map((s, idx) => (
                <div key={s.id}
                     className={`supplier-card ${idx === supplierIdx ? 'active' : ''}`}
                     onClick={() => { setSupplierIdx(idx); setMode(STATES.PROVEEDOR) }}
                     onDoubleClick={() => startOrder(s)}>
                  <div className="supplier-card-header">
                    <strong>{s.name}</strong>
                    <button className="btn btn-sm btn-outline" onClick={e => { e.stopPropagation(); setSupplierForm({ ...s }) }}>Editar</button>
                  </div>
                  {s.contact && <div className="supplier-card-info">{s.contact}</div>}
                  {s.phone && <div className="supplier-card-info">{s.phone}</div>}
                </div>
              ))}
              {suppliers.length === 0 && <p className="text-muted">No hay proveedores. Ins da de alta uno.</p>}
            </div>
          </div>

          <div className="purchases-panel">
            {supplier ? (
              <>
                <div className="purchases-panel-header">
                  <h3>{supplier.name}</h3>
                  <div style={{display:'flex', gap:'0.4rem'}}>
                    {order && order.items.length > 0 && (
                      <button className="btn btn-warning btn-sm" onClick={() => setMode(STATES.PEDIDO)}>
                        Pedido en curso: {order.items.length} renglón(es)
                      </button>
                    )}
                    <button className="btn btn-primary" onClick={() => startOrder(supplier)}>Nuevo Pedido <kbd>Enter</kbd></button>
                  </div>
                </div>
                {loading ? <div className="loading">Cargando...</div> : (
                  <table className="table">
                    <thead>
                      <tr><th>Folio</th><th>Factura</th><th>Total</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr>
                    </thead>
                    <tbody>
                      {purchases.map((p, idx) => (
                        <tr key={p.id}
                            className={mode === STATES.PENDIENTES && idx === purchaseIdx ? 'row-selected' : ''}
                            onClick={() => { setPurchaseIdx(idx); setMode(STATES.PENDIENTES) }}>
                          <td>#{p.id}</td>
                          <td>{p.invoice_number || '-'}</td>
                          <td className="money">
                            {money(p.total)}
                            {p.payment_type === 'credit' && p.status === 'completed' && (
                              (p.total - (p.amount_paid || 0)) > 0.009
                                ? <span className="badge badge-warning" style={{marginLeft:'0.35rem'}}>Debe {money(p.total - (p.amount_paid || 0))}</span>
                                : <span className="badge badge-success" style={{marginLeft:'0.35rem'}}>Pagada</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${{ pending: 'badge-warning', completed: 'badge-success', cancelled: 'badge-error' }[p.status] || ''}`}>
                              {{ pending: 'Pendiente', completed: 'Completada', cancelled: 'Cancelada' }[p.status] || p.status}
                            </span>
                          </td>
                          <td>{formatDate(p.created_at, { day: 'numeric', month: 'short' })}</td>
                          <td className="actions-cell">
                            <button className="btn btn-sm btn-outline" onClick={async e => { e.stopPropagation(); try { setDetail(await purchasesApi.get(p.id)) } catch (err) { setError(err.message) } }}>Ver</button>
                            {p.status === 'pending' && <button className="btn btn-sm btn-success" onClick={e => { e.stopPropagation(); openReception(p.id) }}>Recibir</button>}
                          </td>
                        </tr>
                      ))}
                      {purchases.length === 0 && <tr><td colSpan="6" className="text-muted">Sin movimientos</td></tr>}
                    </tbody>
                  </table>
                )}
              </>
            ) : (
              <div className="purchases-empty"><p>Elige un proveedor con ↑↓ y pulsa Enter para empezar un pedido</p></div>
            )}
          </div>
        </div>
      )}

      {/* ---------- Buscador superpuesto (productos o proveedores) ---------- */}
      {mode === STATES.BUSQUEDA && picker && (
        <div className="modal-overlay palette-overlay" onClick={() => { setPicker(null); setMode(order ? STATES.PEDIDO : STATES.PROVEEDOR) }}>
          <div className="palette" onClick={e => e.stopPropagation()}>
            <input
              ref={pickerRef}
              className="palette-input"
              value={picker.query}
              placeholder={picker.kind === 'producto'
                ? (picker.todoElCatalogo ? 'Buscar en TODO el catálogo...' : 'Buscar producto de este proveedor...')
                : 'Buscar proveedor...'}
              onChange={e => {
                const q = e.target.value
                if (picker.kind === 'producto') buscarProducto(q, picker.todoElCatalogo)
                else buscarProveedor(q)
              }}
            />
            <div className="palette-list">
              {picker.results.map((r, i) => (
                <div key={r.id} className={`palette-item ${i === picker.index ? 'active' : ''}`}
                     onMouseEnter={() => setPicker(p => ({ ...p, index: i }))}
                     onClick={elegirDelPicker}>
                  <div className="palette-item-main">
                    <span className="palette-item-name">{r.name}</span>
                    <span className="palette-item-desc">
                      {picker.kind === 'producto'
                        ? `${r.barcode || 'sin código'} · costo ${money(PO.costFor(r, order?.supplier_id))} · stock ${r.stock}`
                        : [r.contact, r.phone].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </div>
              ))}
              {picker.results.length === 0 && (
                <div className="palette-empty">
                  Nada coincide{picker.kind === 'producto' && !picker.todoElCatalogo ? ' entre los productos de este proveedor — usa ??texto para buscar en todo el catálogo' : ''}
                </div>
              )}
            </div>
            <div className="palette-footer"><kbd>↑</kbd><kbd>↓</kbd> moverse · <kbd>Enter</kbd> elegir · <kbd>Esc</kbd> cerrar</div>
          </div>
        </div>
      )}

      {/* ---------- Abono ---------- */}
      {mode === STATES.ABONO && payForm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Abonar a compra #{payForm.purchase.id}</h3>
            <p>{payForm.purchase.supplier_name} — saldo <strong className="money">{money(payForm.purchase.balance)}</strong></p>
            <div className="form-group">
              <label>Monto (Enter = pago completo)</label>
              <input autoFocus type="number" min="0.01" step="0.01" className="input-money"
                value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Forma de pago</label>
              <div style={{display:'flex', gap:'0.35rem'}}>
                {[['cash','F1 Efectivo'], ['card','F2 Tarjeta'], ['transfer','F3 Transferencia']].map(([v, l]) => (
                  <button key={v} className={`btn btn-sm ${payForm.method === v ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => setPayForm(f => ({ ...f, method: v }))}>{l}</button>
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setPayForm(null); setMode(STATES.PORPAGAR) }}>Cancelar <kbd>Esc</kbd></button>
              <button className="btn btn-primary" onClick={submitPayment}>Registrar <kbd>Enter</kbd></button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Alta / edición de proveedor ---------- */}
      {supplierForm && (
        <div className="modal-overlay" onKeyDown={modalKeys(() => setSupplierForm(null), async () => {
          if (!supplierForm.name.trim()) { setError('El nombre es obligatorio'); return }
          try {
            if (supplierForm.id) await suppliersApi.update(supplierForm.id, supplierForm)
            else await suppliersApi.create(supplierForm)
            setSupplierForm(null)
            loadSuppliers(search)
            notify(supplierForm.id ? 'Proveedor actualizado' : 'Proveedor creado', 'success')
          } catch (e) { setError(e.message) }
        })}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>{supplierForm.id ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
            {['name', 'contact', 'phone', 'email', 'address'].map((campo, i) => (
              <div className="form-group" key={campo}>
                <label>{{ name: 'Nombre *', contact: 'Contacto', phone: 'Teléfono', email: 'Email', address: 'Dirección' }[campo]}</label>
                <input type="text" className="input" autoFocus={i === 0} value={supplierForm[campo] || ''}
                  onChange={e => setSupplierForm(f => ({ ...f, [campo]: e.target.value }))} />
              </div>
            ))}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSupplierForm(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={async () => {
                if (!supplierForm.name.trim()) { setError('El nombre es obligatorio'); return }
                try {
                  if (supplierForm.id) await suppliersApi.update(supplierForm.id, supplierForm)
                  else await suppliersApi.create(supplierForm)
                  setSupplierForm(null)
                  loadSuppliers(search)
                  notify(supplierForm.id ? 'Proveedor actualizado' : 'Proveedor creado', 'success')
                } catch (e) { setError(e.message) }
              }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Alta rápida de producto desde el pedido ---------- */}
      {productForm && (
        <div className="modal-overlay" onKeyDown={modalKeys(() => setProductForm(null), null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>Alta rápida — se liga a {order?.supplier_name}</h3>
            <div className="form-group"><label>Nombre *</label>
              <input autoFocus className="input" value={productForm.name} onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="form-group"><label>Código de barras</label>
              <input className="input" value={productForm.barcode} onChange={e => setProductForm(f => ({ ...f, barcode: e.target.value }))} /></div>
            <div className="form-grid">
              <div className="form-group"><label>Costo</label>
                <input type="number" step="0.01" className="input" value={productForm.purchase_price} onChange={e => setProductForm(f => ({ ...f, purchase_price: e.target.value }))} /></div>
              <div className="form-group"><label>Precio de venta *</label>
                <input type="number" step="0.01" className="input" value={productForm.sale_price} onChange={e => setProductForm(f => ({ ...f, sale_price: e.target.value }))} /></div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setProductForm(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={async () => {
                if (!productForm.name.trim() || !productForm.sale_price) { setError('Nombre y precio de venta son obligatorios'); return }
                try {
                  const creado = await productsApi.create({
                    name: productForm.name, barcode: productForm.barcode || null,
                    purchase_price: parseFloat(productForm.purchase_price) || 0,
                    sale_price: parseFloat(productForm.sale_price), stock: 0, min_stock: 0,
                    supplier_id: order.supplier_id,
                  })
                  const data = await productsApi.all()
                  setProducts(data.products || [])
                  addProduct({ ...creado, supplier_ids: String(order.supplier_id) }, parseFloat(productForm.quantity) || 1)
                  setProductForm(null)
                  notify(`${creado.name} creado y agregado`, 'success')
                } catch (e) { setError(e.message) }
              }}>Crear y agregar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Pedidos suspendidos ---------- */}
      {resumeList && (
        <div className="modal-overlay" onClick={() => setResumeList(null)} onKeyDown={modalKeys(() => setResumeList(null), null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Pedidos suspendidos</h3>
            <table className="table">
              <thead><tr><th>Proveedor</th><th>Renglones</th><th>Total</th><th>Cuándo</th><th></th></tr></thead>
              <tbody>
                {resumeList.map(s => (
                  <tr key={s.id}>
                    <td>{s.supplier_name}</td>
                    <td>{s.itemCount}</td>
                    <td className="money">{money(s.total)}</td>
                    <td>{formatDateTime(s.createdAt)}</td>
                    <td><button className="btn btn-sm btn-primary" onClick={() => doResume(s.id)}>Retomar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setResumeList(null)}>Cerrar</button></div>
          </div>
        </div>
      )}

      {/* ---------- Detalle de compra ---------- */}
      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)} onKeyDown={modalKeys(() => setDetail(null), () => setDetail(null))}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <h3>Compra #{detail.id} — {detail.supplier_name}</h3>
            <table className="table">
              <thead><tr><th>Producto</th><th>Pedido</th><th>Costo</th>{detail.status === 'completed' && <><th>Recibido</th><th>Costo recibido</th></>}</tr></thead>
              <tbody>
                {detail.items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.product_name}</td>
                    <td className="money">{item.quantity}</td>
                    <td className="money">{money(item.unit_price)}</td>
                    {detail.status === 'completed' && (
                      <>
                        <td className="money">{item.received_quantity != null ? item.received_quantity : item.quantity}</td>
                        <td className="money">{money(item.received_unit_price != null ? item.received_unit_price : item.unit_price)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="purchase-totals">
              <div className="total-row total-final"><span>Total:</span><span className="money money-sub">{money(detail.total)}</span></div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDetail(null)}>Cerrar</button>
              <button className="btn btn-primary" onClick={() => printPurchase(detail)}>Imprimir</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Paleta y hoja de ayuda ---------- */}
      {showPalette && (
        <CommandPalette
          state={modalAbierto ? mode : mode}
          role={user?.role}
          onRun={(action) => {
            setShowPalette(false)
            if (action.hash) { window.location.hash = action.hash; return }
            const run = handlersRef.current[action.id]
            if (run) run()
            else notify('Esa acción no está disponible aquí', 'error')
          }}
          onClose={() => setShowPalette(false)}
        />
      )}

      {showHelpSheet && (
        <div className="modal-overlay" onClick={() => setShowHelpSheet(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <h3>Teclas de Compras — {etiquetaModo}</h3>
            {Object.entries(
              actionsFor({ state: mode, role: user?.role }).reduce((groups, a) => {
                const g = a.group || 'Otros'
                groups[g] = groups[g] || []
                groups[g].push(a)
                return groups
              }, {})
            ).map(([grupo, acciones]) => (
              <div className="help-sheet-group" key={grupo}>
                <h4>{grupo}</h4>
                {acciones.map(a => (
                  <div className="help-sheet-row" key={a.id}>
                    <span>{a.nombre}</span>
                    <span className="keys">{a.keys.length ? a.keys.map(k => <kbd key={k}>{k}</kbd>) : <span className="palette-nokey">sin tecla</span>}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowHelpSheet(false)}>Cerrar</button></div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}

      <HelpBar state={modalAbierto ? STATES.MODAL : mode} role={user?.role} />
    </div>
  )
}
