import React, { useState, useEffect, useCallback, useRef } from 'react'
import { products, accounting, suppliers as suppliersApi } from '../api'
import { formatDateTime, formatDate, formatCalendarDate } from '../dateUtils'
import { getTheme, toggleTheme } from '../theme'
import { modalKeys } from '../modalKeys'
import { confirmDialog } from '../confirmDialog'
import { barcodeSVG } from '../barcode'

function formatMoney(n) {
  return '$' + parseFloat(n || 0).toFixed(2)
}

export default function Inventory({ user, onLogout }) {
  // Cuando el rol es 'inventory', esta pantalla se usa SOLA (App.jsx no la
  // envuelve en AdminLayout, que es donde normalmente viven el botón de tema
  // y el de salir). Antes esto dejaba a ese rol sin forma de cambiar de tema
  // ni de cerrar sesión desde la interfaz.
  const isStandalone = user?.role === 'inventory'
  const [theme, setThemeState] = useState(getTheme())
  const [productList, setProductList] = useState([])
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [categories, setCategories] = useState([])
  const [supplierList, setSupplierList] = useState([])
  const [filterCat, setFilterCat] = useState('')
  const [showLowStock, setShowLowStock] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [form, setForm] = useState({ name: '', barcode: '', category_id: '', purchase_price: '', sale_price: '', stock: '', min_stock: '', supplier: '', expiry_date: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [kardexProduct, setKardexProduct] = useState(null)
  const [kardexData, setKardexData] = useState([])
  const [priceHistory, setPriceHistory] = useState([])
  // Impresión de etiquetas de código de barras (B3)
  const [showLabelsModal, setShowLabelsModal] = useState(false)
  const [labelItems, setLabelItems] = useState([])
  const [batchProduct, setBatchProduct] = useState(null)
  const [batches, setBatches] = useState([])
  const [batchForm, setBatchForm] = useState({ batch_code: '', quantity: '', expiry_date: '' })
  const [barcodeProduct, setBarcodeProduct] = useState(null)
  const [productBarcodes, setProductBarcodes] = useState([])
  const [newBarcode, setNewBarcode] = useState('')
  const [showWasteModal, setShowWasteModal] = useState(false)
  const [wasteForm, setWasteForm] = useState({ product_id: '', product_name: '', quantity: '', reason: '', waste_type: 'waste', notes: '' })
  const [showWasteList, setShowWasteList] = useState(false)
  const [wasteList, setWasteList] = useState([])
  const [allProducts, setAllProducts] = useState([])
  const [showCategoriesModal, setShowCategoriesModal] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCategory, setEditingCategory] = useState(null)
  const [showObsoleteModal, setShowObsoleteModal] = useState(false)
  const [obsoleteDays, setObsoleteDays] = useState(90)
  const [obsoleteProducts, setObsoleteProducts] = useState([])
  const [obsoleteLoading, setObsoleteLoading] = useState(false)
  const [selectedObsolete, setSelectedObsolete] = useState(new Set())
  const importExcelRef = useRef(null)
  // Dudas del import de Excel (venta individual por stock decimal, nombres
  // repetidos con precio distinto): se resuelven todas en una sola ventana
  // al terminar la importación. null = sin pendientes.
  const [importPending, setImportPending] = useState(null)
  const [importSaving, setImportSaving] = useState(false)

  const loadProducts = useCallback(async () => {
    try {
      const params = { page, limit: 25, search, lowStock: showLowStock.toString() }
      if (filterCat) params.category = filterCat
      const res = await products.list(params)
      setProductList(res.products)
      setTotalPages(res.totalPages)
    } catch (e) { setError(e.message) }
  }, [page, search, filterCat, showLowStock])

  const loadCategories = async () => {
    try { const res = await products.categories(); setCategories(res.categories) } catch (e) {}
  }
  const loadSuppliers = async () => {
    try { const res = await suppliersApi.list(); setSupplierList(res) } catch (e) {}
  }
  useEffect(() => { loadProducts(); const interval = setInterval(loadProducts, 30000); return () => clearInterval(interval) }, [loadProducts])

  useEffect(() => { loadCategories(); loadSuppliers() }, [])

  const handleExportExcel = async () => {
    try { await products.exportExcel() } catch (e) { setError(e.message) }
  }

  const handleImportExcel = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!(await confirmDialog(`¿Importar "${file.name}"? Se actualizarán los productos existentes, se crearán los nuevos y se desactivará cualquier producto activo que no aparezca en el archivo.`))) {
      e.target.value = ''
      return
    }
    try {
      const res = await products.importExcel(file)
      const extras = []
      if (res.merged) extras.push(`${res.merged} fila(s) repetidas fundidas en su producto`)
      if (res.extraBarcodes) extras.push(`${res.extraBarcodes} código(s) adicionales registrados`)
      if (res.skipped) extras.push(`${res.skipped} filas sin nombre omitidas`)
      setSuccess(`Importación completa: ${res.inserted} nuevos, ${res.updated} actualizados, ${res.deactivated} desactivados${extras.length ? ', ' + extras.join(', ') : ''}${res.needsReview ? `. ${res.needsReview} producto(s) quedaron con datos incompletos — aparecen hasta arriba de la lista.` : ''}`)
      if (res.warnings?.length) setError(res.warnings.join(' · '))
      loadProducts()
      loadCategories()
      // Abrir la ventana de dudas con valores de resolución por defecto
      if (res.pending?.length) {
        setImportPending(res.pending.map(p => p.type === 'individual'
          ? { ...p, resolution: 'apply', units_per_package: '', individual_price: '' }
          : { ...p, resolution: 'add_code' }
        ))
      }
    } catch (e) { setError(e.message) }
    e.target.value = ''
  }

  const updatePendingItem = (index, patch) => {
    setImportPending(prev => prev.map((it, i) => i === index ? { ...it, ...patch } : it))
  }

  const handleResolvePending = async () => {
    for (const it of importPending) {
      if (it.type === 'individual' && it.resolution === 'apply' && (!it.units_per_package || !it.individual_price)) {
        setError(`Completa unidades por paquete y precio por pieza de "${it.name}", o márcalo como "No aplica"`)
        return
      }
    }
    setImportSaving(true)
    setError('')
    let done = 0
    try {
      for (const it of importPending) {
        if (it.type === 'individual' && it.resolution === 'apply') {
          await products.update(it.product_id, {
            sellable_individually: true,
            units_per_package: parseInt(it.units_per_package),
            individual_price: parseFloat(it.individual_price)
          })
          done++
        } else if (it.type === 'name_conflict') {
          if (it.resolution === 'add_code') {
            await products.addBarcode(it.existing_product_id, it.barcode)
            const newStock = (parseFloat(it.existing_stock) || 0) + (parseFloat(it.stock) || 0)
            await products.update(it.existing_product_id, { stock: newStock })
            done++
          } else if (it.resolution === 'create') {
            await products.create({
              name: it.name, barcode: it.barcode,
              sale_price: it.sale_price, purchase_price: it.purchase_price,
              stock: it.stock, min_stock: it.min_stock,
              category_id: it.category_id
            })
            done++
          }
        }
      }
      setImportPending(null)
      setSuccess(`${done} pendiente(s) de importación resueltos`)
      setTimeout(() => setSuccess(''), 4000)
      loadProducts()
    } catch (e) { setError(e.message) }
    setImportSaving(false)
  }

  const openCategoriesModal = () => {
    loadCategories()
    setNewCategoryName('')
    setEditingCategory(null)
    setShowCategoriesModal(true)
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    try {
      if (editingCategory) {
        await products.updateCategory(editingCategory.id, newCategoryName.trim())
      } else {
        await products.createCategory(newCategoryName.trim())
      }
      setNewCategoryName('')
      setEditingCategory(null)
      await loadCategories()
      setSuccess(editingCategory ? 'Categoría actualizada' : 'Categoría creada')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const handleDeleteCategory = async (id) => {
    if (!(await confirmDialog('¿Eliminar esta categoría? Los productos asociados quedarán sin categoría.'))) return
    try {
      await products.deleteCategory(id)
      await loadCategories()
      setSuccess('Categoría eliminada')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const openNew = () => {
    setEditingProduct(null)
    setForm({ name: '', barcode: '', category_id: '', purchase_price: '', sale_price: '', stock: '', min_stock: '', supplier_id: '', unit_type: 'unit', sellable_individually: false, units_per_package: '', individual_price: '' })
    setError('')
    setShowForm(true)
  }

  const openEdit = (p) => {
    setEditingProduct(p)
    setForm({
      name: p.name, barcode: p.barcode || '',
      category_id: p.category_id?.toString() || '',
      purchase_price: p.purchase_price?.toString() || '',
      sale_price: p.sale_price?.toString() || '',
      stock: p.stock?.toString() || '',
      min_stock: p.min_stock?.toString() || '',
      supplier_id: p.supplier_id?.toString() || '',
      unit_type: p.unit_type || 'unit',
      sellable_individually: !!p.sellable_individually,
      units_per_package: p.units_per_package?.toString() || '',
      individual_price: p.individual_price?.toString() || ''
    })
    setError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.sale_price) { setError('Nombre y precio de venta requeridos'); return }
    if (form.sellable_individually && (!form.units_per_package || !form.individual_price)) {
      setError('Indica unidades por paquete y precio individual')
      return
    }
    setError('')
    try {
      const data = {
        name: form.name,
        barcode: form.barcode || null,
        category_id: form.category_id ? parseInt(form.category_id) : null,
        purchase_price: parseFloat(form.purchase_price) || 0,
        sale_price: parseFloat(form.sale_price) || 0,
        stock: parseFloat(form.stock) || 0,
        min_stock: parseFloat(form.min_stock) || 0,
        supplier_id: form.supplier_id ? parseInt(form.supplier_id) : null,
        unit_type: form.unit_type || 'unit',
        sellable_individually: !!form.sellable_individually,
        units_per_package: form.sellable_individually ? parseInt(form.units_per_package) || null : null,
        individual_price: form.sellable_individually ? parseFloat(form.individual_price) || null : null
      }
      if (editingProduct) {
        await products.update(editingProduct.id, data)
        setSuccess('Producto actualizado')
      } else {
        await products.create(data)
        setSuccess(`Producto "${data.name}" creado`)
      }
      setShowForm(false)
      setEditingProduct(null)
      loadProducts()
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDelete = async (id) => {
    if (!(await confirmDialog('Desactivar este producto?'))) return
    try { await products.remove(id); loadProducts(); setSuccess('Producto desactivado'); setTimeout(() => setSuccess(''), 3000) }
    catch (e) { setError(e.message) }
  }

  // Etiquetas: parte de los productos visibles en la lista actual (misma
  // búsqueda/filtros); cada uno con cuántas copias imprimir.
  const openLabelsModal = () => {
    setLabelItems(productList.map(p => ({ id: p.id, name: p.name, barcode: p.barcode, sale_price: p.sale_price, copies: 0 })))
    setShowLabelsModal(true)
  }

  const printLabels = () => {
    const toPrint = labelItems.filter(i => i.copies > 0)
    if (toPrint.length === 0) { setError('Indica cuántas etiquetas quieres de al menos un producto'); return }
    const labels = []
    for (const item of toPrint) {
      const svg = barcodeSVG(item.barcode || '', { height: 40, moduleWidth: 2 })
      for (let c = 0; c < item.copies; c++) {
        labels.push(`
          <div class="label">
            <div class="label-name">${(item.name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').substring(0, 40)}</div>
            <div class="label-price">$${parseFloat(item.sale_price || 0).toFixed(2)}</div>
            <div class="label-barcode">${svg || `<span class="no-code">${item.barcode || 'sin código'}</span>`}</div>
          </div>`)
      }
    }
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) { setError('El navegador bloqueó la ventana de impresión'); return }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>
      @page { size: letter; margin: 1cm; }
      body { font-family: Arial, sans-serif; margin: 0; }
      .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
      .label { width: 60mm; height: 30mm; border: 1px dashed #bbb; box-sizing: border-box;
               padding: 2mm; display: flex; flex-direction: column; align-items: center;
               justify-content: space-between; overflow: hidden; page-break-inside: avoid; }
      .label-name { font-size: 9pt; font-weight: bold; text-align: center; line-height: 1.1; }
      .label-price { font-size: 12pt; font-weight: bold; }
      .label-barcode svg { max-width: 54mm; height: auto; }
      .no-code { font-size: 8pt; color: #666; }
      @media print { .label { border: none; } }
    </style></head><body><div class="sheet">${labels.join('')}</div>
    <script>window.onload = () => { window.print(); }<\/script></body></html>`)
    win.document.close()
    setShowLabelsModal(false)
  }

  const openKardex = async (p) => {
    setKardexProduct(p)
    setPriceHistory([])
    try {
      const ph = await products.priceHistory(p.id)
      setPriceHistory(ph.history || [])
    } catch (e) {}
    try {
      const res = await products.kardex(p.id, { page: 1, limit: 50 })
      setKardexData(res.movements)
    } catch (e) { setError(e.message) }
  }

  const openBatches = async (p) => {
    setBatchProduct(p)
    try {
      const res = await products.batches(p.id)
      setBatches(res.batches)
      setBatchForm({ batch_code: '', quantity: '', expiry_date: '' })
    } catch (e) { setError(e.message) }
  }

  const handleAddBatch = async () => {
    const qty = parseFloat(batchForm.quantity)
    if (!qty || qty <= 0) { setError('Cantidad inválida'); return }
    try {
      await products.addBatch(batchProduct.id, { batch_code: batchForm.batch_code || null, quantity: qty, expiry_date: batchForm.expiry_date || null })
      setBatchForm({ batch_code: '', quantity: '', expiry_date: '' })
      const res = await products.batches(batchProduct.id)
      setBatches(res.batches)
      loadProducts()
      setSuccess('Lote agregado')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const handleDeleteBatch = async (batchId) => {
    if (!(await confirmDialog('Eliminar este lote?'))) return
    try {
      await products.deleteBatch(batchId)
      const res = await products.batches(batchProduct.id)
      setBatches(res.batches)
      loadProducts()
      setSuccess('Lote eliminado')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const openBarcodes = async (p) => {
    setBarcodeProduct(p)
    setNewBarcode('')
    try {
      const res = await products.barcodes(p.id)
      setProductBarcodes(res.barcodes)
    } catch (e) { setError(e.message) }
  }

  const handleAddBarcode = async () => {
    const code = newBarcode.trim()
    if (!code) { setError('Ingresa un código'); return }
    try {
      await products.addBarcode(barcodeProduct.id, code)
      setNewBarcode('')
      const res = await products.barcodes(barcodeProduct.id)
      setProductBarcodes(res.barcodes)
      setSuccess('Código agregado')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const handleDeleteBarcode = async (barcodeId) => {
    if (!(await confirmDialog('Eliminar este código?'))) return
    try {
      await products.deleteBarcode(barcodeId)
      const res = await products.barcodes(barcodeProduct.id)
      setProductBarcodes(res.barcodes)
      setSuccess('Código eliminado')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const openObsoleteModal = async () => {
    setShowObsoleteModal(true)
    setSelectedObsolete(new Set())
    try {
      const settings = await products.getObsoleteSettings()
      setObsoleteDays(settings.days)
      await loadObsolete(settings.days)
    } catch (e) { setError(e.message) }
  }

  const loadObsolete = async (days) => {
    setObsoleteLoading(true)
    try {
      const res = await products.obsolete(days)
      setObsoleteProducts(res.products)
    } catch (e) { setError(e.message) }
    setObsoleteLoading(false)
  }

  const handleSaveObsoleteDays = async () => {
    try {
      await products.setObsoleteSettings(obsoleteDays)
      await loadObsolete(obsoleteDays)
      setSuccess('Periodo actualizado')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const toggleObsoleteSelected = (id) => {
    setSelectedObsolete(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleDeactivateSelected = async () => {
    if (selectedObsolete.size === 0) return
    if (!(await confirmDialog(`¿Desactivar ${selectedObsolete.size} producto(s)? Podrás reactivarlos manualmente después si hace falta.`))) return
    try {
      for (const id of selectedObsolete) {
        await products.remove(id)
      }
      setSuccess(`${selectedObsolete.size} producto(s) desactivado(s)`)
      setTimeout(() => setSuccess(''), 3000)
      setSelectedObsolete(new Set())
      await loadObsolete(obsoleteDays)
      loadProducts()
    } catch (e) { setError(e.message) }
  }

  const openWasteModal = (product) => {
    setWasteForm({ product_id: product?.id?.toString() || '', product_name: product?.name || '', quantity: '', reason: '', waste_type: 'waste', notes: '' })
    if (!product) {
      products.all().then(res => setAllProducts(res.products.filter(p => p.active !== 0))).catch(() => {})
    }
    setShowWasteModal(true)
  }

  const loadWasteList = async () => {
    try {
      const res = await accounting.listWaste({ limit: 100 })
      setWasteList(res.waste)
    } catch (e) {}
  }

  const handleWasteSubmit = async () => {
    if (!wasteForm.product_id) { setError('Seleccione un producto'); return }
    if (!wasteForm.quantity || parseFloat(wasteForm.quantity) <= 0) { setError('Cantidad inválida'); return }
    if (!wasteForm.reason.trim()) { setError('El motivo es obligatorio'); return }
    setError('')
    try {
      await accounting.addWaste({
        product_id: parseInt(wasteForm.product_id),
        quantity: parseFloat(wasteForm.quantity),
        reason: wasteForm.reason.trim(),
        waste_type: wasteForm.waste_type,
        notes: wasteForm.notes || null
      })
      setShowWasteModal(false)
      setSuccess('Merma registrada')
      loadProducts()
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  return (
    <div className="inventory-page">
      <div className="page-header">
        <h2>Inventario</h2>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={openNew}>+ Nuevo Producto</button>
          {user?.role === 'admin' && (
            <>
              <button className="btn btn-sm btn-outline" onClick={() => { openWasteModal(null); setShowWasteList(false); loadWasteList(); setShowWasteList(true) }}>
                Mermas
              </button>
            </>
          )}
          {(user?.role === 'admin' || user?.role === 'inventory') && (
            <button className="btn btn-sm btn-outline" onClick={openObsoleteModal}>
              Inventario Obsoleto
            </button>
          )}
          <button className="btn btn-sm btn-outline" onClick={openCategoriesModal}>Categorías</button>
          <button className="btn btn-sm btn-outline" onClick={handleExportExcel}>Exportar Excel</button>
          <button className="btn btn-sm btn-outline" onClick={() => importExcelRef.current?.click()}>Importar Excel</button>
          <button className="btn btn-sm btn-outline" onClick={openLabelsModal}>Etiquetas</button>
          <input ref={importExcelRef} type="file" accept=".xlsx,.xls" style={{display:'none'}} onChange={handleImportExcel} />
          {isStandalone && (
            <>
              <button className="btn btn-sm btn-outline" onClick={() => setThemeState(toggleTheme())} title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}>
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              <button className="btn btn-sm btn-outline" onClick={onLogout}>Salir</button>
            </>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}
      {success && <div className="alert alert-success" onClick={() => setSuccess('')}>{success}</div>}

      <section className="products-section">
        <div className="section-header" style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem'}}>
          <h3 style={{margin:0}}>Productos</h3>
        </div>
        <div className="filters">
            <input type="text" className="input" placeholder="Buscar por nombre o código..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
            <select value={filterCat} onChange={(e) => { setFilterCat(e.target.value); setPage(1) }}>
              <option value="">Todas las categorías</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className={`btn btn-sm ${showLowStock ? 'btn-warning' : 'btn-outline'}`} onClick={() => { setShowLowStock(!showLowStock); setPage(1) }}>
              {showLowStock ? 'Mostrar todos' : 'Stock Bajo'}
            </button>
          </div>

          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Categoría</th>
                  <th>P. Compra</th>
                  <th>P. Venta</th>
                  <th>Stock</th>
                  <th>Stock Min</th>
                  <th>Proveedor</th>
                  <th>Tipo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {productList.map(p => (
                  <tr key={p.id} className={p.stock <= p.min_stock ? 'row-warning' : ''}>
                    <td style={{fontSize:'0.8rem'}}>{p.barcode || '-'}</td>
                    <td>
                      <strong>{p.name}</strong>
                      {!!p.needs_review && (
                        <span className="badge badge-warning" style={{marginLeft:'0.4rem'}} title="Le faltó algún dato al importarlo (precio y/o categoría) — edítalo y guarda para quitar este aviso">
                          Faltan datos
                        </span>
                      )}
                    </td>
                    <td>{p.category_name || '-'}</td>
                    <td>{formatMoney(p.purchase_price)}</td>
                    <td>{formatMoney(p.sale_price)}</td>
                    <td className={p.stock <= p.min_stock ? 'text-danger' : ''}>{p.stock} {p.unit_type === 'kg' ? 'kg' : p.unit_type === 'l' ? 'L' : ''}</td>
                    <td>{p.min_stock}</td>
                    <td>{p.supplier || '-'}</td>
                    <td>{p.unit_type === 'kg' ? 'Peso' : p.unit_type === 'l' ? 'Vol' : 'Unidad'}</td>
                    <td className="actions-cell">
                      <button className="btn btn-sm btn-outline" onClick={() => openKardex(p)}>Kardex</button>
                      <button className="btn btn-sm btn-outline" onClick={() => openBatches(p)}>Lotes</button>
                      <button className="btn btn-sm btn-outline" onClick={() => openBarcodes(p)}>Códigos</button>
                      <button className="btn btn-sm btn-outline" onClick={() => openWasteModal(p)}>Merma</button>
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(p)}>Editar</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p.id)}>X</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
              <span>Página {page} de {totalPages}</span>
              <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</button>
            </div>
          )}
      </section>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)} onKeyDown={modalKeys(() => { setShowForm(false); setError('') }, handleSave)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editingProduct ? 'Editar Producto' : 'Nuevo Producto'}</h3>
            <div className="form-grid">
              <div className="form-group">
                <label>Nombre *</label>
                <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus />
              </div>
              <div className="form-group">
                <label>Código de Barras</label>
                <input type="text" value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} placeholder="Dejar vacío para generar automático" />
              </div>
              <div className="form-group">
                <label>Categoría</label>
                <select value={form.category_id} onChange={e => setForm({...form, category_id: e.target.value})}>
                  <option value="">Sin categoría</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Precio de Compra</label>
                <input type="number" step="0.01" value={form.purchase_price} onChange={e => setForm({...form, purchase_price: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Precio de Venta *</label>
                <input type="number" step="0.01" value={form.sale_price} onChange={e => setForm({...form, sale_price: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Stock</label>
                <input type="number" step="0.5" value={form.stock} onChange={e => setForm({...form, stock: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Stock Mínimo</label>
                <input type="number" step="0.5" value={form.min_stock} onChange={e => setForm({...form, min_stock: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Proveedor</label>
                <select value={form.supplier_id} onChange={e => setForm({...form, supplier_id: e.target.value})}>
                  <option value="">Sin proveedor</option>
                  {supplierList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Tipo de Venta</label>
                <select value={form.unit_type} onChange={e => setForm({...form, unit_type: e.target.value})}>
                  <option value="unit">Unidad</option>
                  <option value="kg">Peso (kg)</option>
                  <option value="l">Volumen (L)</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{marginTop:'0.5rem'}}>
              <label style={{display:'flex', alignItems:'center', gap:'0.5rem', fontWeight:'normal'}}>
                <input type="checkbox" checked={form.sellable_individually} onChange={e => setForm({...form, sellable_individually: e.target.checked})} />
                Se puede vender por unidad individual (ej. cigarros sueltos de una cajetilla)
              </label>
            </div>
            {form.sellable_individually && (
              <div className="form-grid">
                <div className="form-group">
                  <label>Unidades individuales por paquete</label>
                  <input type="number" min="1" step="1" value={form.units_per_package} onChange={e => setForm({...form, units_per_package: e.target.value})} placeholder="Ej. 20" />
                </div>
                <div className="form-group">
                  <label>Precio por unidad individual</label>
                  <input type="number" min="0" step="0.01" value={form.individual_price} onChange={e => setForm({...form, individual_price: e.target.value})} placeholder="Ej. 3.00" />
                </div>
              </div>
            )}
            {error && <div className="alert alert-error" style={{marginTop:'0.5rem'}}>{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowForm(false); setError('') }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>{editingProduct ? 'Actualizar' : 'Crear'}</button>
            </div>
          </div>
        </div>
      )}

      {kardexProduct && (
        <div className="modal-overlay" onClick={() => setKardexProduct(null)} onKeyDown={modalKeys(() => setKardexProduct(null), () => setKardexProduct(null))}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <h3>Kardex: {kardexProduct.name}</h3>
            <p>Stock actual: {kardexProduct.stock}</p>
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Stock Antes</th><th>Stock Después</th><th>Referencia</th><th>Notas</th><th>Usuario</th></tr>
                </thead>
                <tbody>
                  {kardexData.map(m => (
                    <tr key={m.id}>
                      <td>{formatDateTime(m.created_at)}</td>
                      <td>{m.type === 'in' ? 'Entrada' : m.type === 'out' ? 'Salida' : 'Ajuste'}</td>
                      <td className={m.type === 'in' ? 'text-success' : 'text-danger'}>{m.type === 'in' ? '+' : '-'}{m.quantity}</td>
                      <td>{m.stock_before}</td>
                      <td>{m.stock_after}</td>
                      <td style={{fontSize:'0.8rem'}}>{m.reference_type || '-'}</td>
                      <td style={{fontSize:'0.8rem'}}>{m.notes || '-'}</td>
                      <td style={{fontSize:'0.8rem'}}>{m.created_by_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {priceHistory.length > 0 && (
              <>
                <h4 style={{marginTop:'1rem'}}>Cambios de precio</h4>
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr><th>Fecha</th><th>Precio</th><th>Antes</th><th>Después</th><th>Origen</th><th>Usuario</th></tr>
                    </thead>
                    <tbody>
                      {priceHistory.map(h => (
                        <tr key={h.id}>
                          <td>{formatDateTime(h.created_at)}</td>
                          <td>{h.field === 'sale_price' ? 'Venta' : h.field === 'purchase_price' ? 'Compra' : 'Pieza'}</td>
                          <td>${(h.old_value ?? 0).toFixed(2)}</td>
                          <td><strong>${(h.new_value ?? 0).toFixed(2)}</strong></td>
                          <td style={{fontSize:'0.8rem'}}>{h.source || '-'}</td>
                          <td style={{fontSize:'0.8rem'}}>{h.changed_by_name || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setKardexProduct(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {showLabelsModal && (
        <div className="modal-overlay" onClick={() => setShowLabelsModal(false)} onKeyDown={modalKeys(() => setShowLabelsModal(false), printLabels)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <h3>Imprimir etiquetas de precio</h3>
            <p style={{fontSize:'0.85rem', color:'var(--text-muted)'}}>
              Escribe cuántas etiquetas quieres de cada producto (los de la lista actual). Se imprimen en hoja tamaño carta.
            </p>
            <div style={{maxHeight:'50vh', overflowY:'auto'}}>
              <table className="table">
                <thead>
                  <tr><th>Producto</th><th>Código</th><th>Precio</th><th style={{width:'110px'}}>Etiquetas</th></tr>
                </thead>
                <tbody>
                  {labelItems.map((item, i) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td style={{fontSize:'0.8rem'}}>{item.barcode || '-'}</td>
                      <td>${parseFloat(item.sale_price || 0).toFixed(2)}</td>
                      <td>
                        <input type="number" min="0" step="1" className="input" style={{width:'80px'}}
                          value={item.copies}
                          onChange={e => setLabelItems(prev => prev.map((it, j) => j === i ? { ...it, copies: Math.max(0, parseInt(e.target.value) || 0) } : it))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <div className="alert alert-error" style={{marginTop:'0.5rem'}}>{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowLabelsModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={printLabels}>Imprimir</button>
            </div>
          </div>
        </div>
      )}

      {importPending && (
        <div className="modal-overlay" onKeyDown={modalKeys(null, null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <h3>Dudas de la importación ({importPending.length})</h3>
            <p style={{fontSize:'0.85rem', color:'var(--text-muted)', marginBottom:'0.75rem'}}>
              El resto del inventario ya se importó. Solo falta decidir estos casos — revisa cada uno y presiona "Guardar todo".
            </p>
            <div style={{maxHeight:'55vh', overflowY:'auto', display:'flex', flexDirection:'column', gap:'0.75rem'}}>
              {importPending.map((it, i) => it.type === 'individual' ? (
                <div key={i} style={{border:'1px solid var(--border)', borderRadius:'8px', padding:'0.75rem'}}>
                  <strong>{it.name}</strong>
                  <p style={{fontSize:'0.85rem', color:'var(--text-muted)', margin:'0.25rem 0 0.5rem'}}>
                    Su stock tiene decimales ({it.stock}) — parece que se vende por pieza suelta (como los cigarros: 3.5 = 3 paquetes y medio). Indica cómo se vende:
                  </p>
                  <div style={{display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap'}}>
                    <label style={{display:'flex', alignItems:'center', gap:'0.35rem', fontWeight:'normal'}}>
                      <input type="radio" checked={it.resolution === 'apply'} onChange={() => updatePendingItem(i, { resolution: 'apply' })} />
                      Sí, se vende por pieza:
                    </label>
                    <input type="number" min="1" step="1" placeholder="Piezas por paquete" style={{width:'140px'}} disabled={it.resolution !== 'apply'}
                      value={it.units_per_package} onChange={e => updatePendingItem(i, { units_per_package: e.target.value })} />
                    <input type="number" min="0" step="0.01" placeholder="Precio por pieza" style={{width:'130px'}} disabled={it.resolution !== 'apply'}
                      value={it.individual_price} onChange={e => updatePendingItem(i, { individual_price: e.target.value })} />
                    <label style={{display:'flex', alignItems:'center', gap:'0.35rem', fontWeight:'normal'}}>
                      <input type="radio" checked={it.resolution === 'skip'} onChange={() => updatePendingItem(i, { resolution: 'skip' })} />
                      No aplica (dejar como está)
                    </label>
                  </div>
                </div>
              ) : (
                <div key={i} style={{border:'1px solid var(--border)', borderRadius:'8px', padding:'0.75rem'}}>
                  <strong>{it.name}</strong>
                  <p style={{fontSize:'0.85rem', color:'var(--text-muted)', margin:'0.25rem 0 0.5rem'}}>
                    El archivo trae este nombre dos veces con código y precio distintos: ya existe con precio ${(it.existing_price || 0).toFixed(2)} y esta fila trae el código {it.barcode} a ${(it.sale_price || 0).toFixed(2)}. ¿Qué es?
                  </p>
                  <div style={{display:'flex', flexDirection:'column', gap:'0.35rem'}}>
                    <label style={{display:'flex', alignItems:'center', gap:'0.35rem', fontWeight:'normal'}}>
                      <input type="radio" checked={it.resolution === 'add_code'} onChange={() => updatePendingItem(i, { resolution: 'add_code' })} />
                      Es el mismo producto — agregar {it.barcode} como código adicional y sumar su stock (+{it.stock || 0})
                    </label>
                    <label style={{display:'flex', alignItems:'center', gap:'0.35rem', fontWeight:'normal'}}>
                      <input type="radio" checked={it.resolution === 'create'} onChange={() => updatePendingItem(i, { resolution: 'create' })} />
                      Es un producto distinto — crearlo aparte con su precio de ${(it.sale_price || 0).toFixed(2)}
                    </label>
                    <label style={{display:'flex', alignItems:'center', gap:'0.35rem', fontWeight:'normal'}}>
                      <input type="radio" checked={it.resolution === 'skip'} onChange={() => updatePendingItem(i, { resolution: 'skip' })} />
                      Omitir esta fila
                    </label>
                  </div>
                </div>
              ))}
            </div>
            {error && <div className="alert alert-error" style={{marginTop:'0.5rem'}}>{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" disabled={importSaving} onClick={async () => {
                if (await confirmDialog('¿Cerrar sin resolver? Los productos con dudas quedaron importados tal cual (sin venta individual ni códigos extra); puedes editarlos a mano después.')) {
                  setImportPending(null)
                  setError('')
                }
              }}>Después</button>
              <button className="btn btn-primary" disabled={importSaving} onClick={handleResolvePending}>
                {importSaving ? 'Guardando...' : 'Guardar todo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {batchProduct && (
        <div className="modal-overlay" onClick={() => setBatchProduct(null)} onKeyDown={modalKeys(() => setBatchProduct(null), null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Lotes: {batchProduct.name}</h3>
            <div className="form-inline">
              <input type="text" className="input" placeholder="Código lote" value={batchForm.batch_code} onChange={e => setBatchForm({...batchForm, batch_code: e.target.value})} />
              <input type="number" className="input" step="0.01" placeholder="Cantidad" value={batchForm.quantity} onChange={e => setBatchForm({...batchForm, quantity: e.target.value})} />
              <input type="date" className="input" value={batchForm.expiry_date} onChange={e => setBatchForm({...batchForm, expiry_date: e.target.value})} />
              <button className="btn btn-primary" onClick={handleAddBatch}>Agregar</button>
            </div>
            <div className="table-responsive" style={{marginTop:'0.5rem'}}>
              <table className="table">
                <thead>
                  <tr><th>Código</th><th>Cantidad</th><th>Caduca</th><th></th></tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr key={b.id}>
                      <td>{b.batch_code || '-'}</td>
                      <td>{b.quantity}</td>
                      <td style={{fontSize:'0.8rem'}}>{b.expiry_date ? formatCalendarDate(b.expiry_date) : '-'}</td>
                      <td><button className="btn btn-sm btn-danger" onClick={() => handleDeleteBatch(b.id)}>X</button></td>
                    </tr>
                  ))}
                  {batches.length === 0 && <tr><td colSpan="4" className="text-center">Sin lotes</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setBatchProduct(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {barcodeProduct && (
        <div className="modal-overlay" onClick={() => setBarcodeProduct(null)} onKeyDown={modalKeys(() => { setBarcodeProduct(null); setError('') }, null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Códigos de Barras: {barcodeProduct.name}</h3>
            <p className="text-muted">Código principal: <strong>{barcodeProduct.barcode || '-'}</strong>. Agrega aquí códigos adicionales (otras presentaciones, báscula, etc.) que deban reconocer el mismo producto al escanear.</p>
            <div className="form-inline">
              <input type="text" className="input" placeholder="Nuevo código adicional" value={newBarcode} onChange={e => setNewBarcode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddBarcode() }} autoFocus />
              <button className="btn btn-primary" onClick={handleAddBarcode}>Agregar</button>
            </div>
            <div className="table-responsive" style={{marginTop:'0.5rem'}}>
              <table className="table">
                <thead>
                  <tr><th>Código</th><th></th></tr>
                </thead>
                <tbody>
                  {productBarcodes.map(b => (
                    <tr key={b.id}>
                      <td>{b.barcode}</td>
                      <td><button className="btn btn-sm btn-danger" onClick={() => handleDeleteBarcode(b.id)}>X</button></td>
                    </tr>
                  ))}
                  {productBarcodes.length === 0 && <tr><td colSpan="2" className="text-center">Sin códigos adicionales</td></tr>}
                </tbody>
              </table>
            </div>
            {error && <div className="alert alert-error" style={{marginTop:'0.5rem'}}>{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setBarcodeProduct(null); setError('') }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {showObsoleteModal && (
        <div className="modal-overlay" onClick={() => setShowObsoleteModal(false)} onKeyDown={modalKeys(() => setShowObsoleteModal(false), null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Inventario Obsoleto</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setShowObsoleteModal(false)}>Cerrar</button>
            </div>
            <div className="modal-body">
              <p className="text-muted">Productos activos que no se han vuelto a surtir (compra, lote o ajuste de entrada) en el periodo configurado. No significa que no se vendan — puede que el proveedor ya no los surta y convenga descontinuarlos.</p>
              <div className="form-inline">
                <label>Periodo (días):</label>
                <input type="number" className="input" style={{width: '90px'}} min="1" value={obsoleteDays} onChange={e => setObsoleteDays(parseInt(e.target.value) || 1)} />
                <button className="btn btn-sm btn-outline" onClick={handleSaveObsoleteDays}>Guardar periodo</button>
                <button className="btn btn-sm btn-outline" onClick={() => loadObsolete(obsoleteDays)}>Actualizar lista</button>
              </div>
              {obsoleteLoading ? <div className="loading">Cargando...</div> : (
                <div className="table-responsive" style={{marginTop: '0.5rem'}}>
                  <table className="table">
                    <thead>
                      <tr><th></th><th>Producto</th><th>Stock</th><th>Último surtido</th></tr>
                    </thead>
                    <tbody>
                      {obsoleteProducts.map(p => (
                        <tr key={p.id}>
                          <td><input type="checkbox" checked={selectedObsolete.has(p.id)} onChange={() => toggleObsoleteSelected(p.id)} /></td>
                          <td>{p.name} {p.barcode ? `(${p.barcode})` : ''}</td>
                          <td>{p.stock} {p.unit_type === 'kg' ? 'kg' : p.unit_type === 'l' ? 'L' : ''}</td>
                          <td style={{fontSize: '0.85rem'}}>{p.last_restocked_at ? formatDate(p.last_restocked_at) : 'Nunca'}</td>
                        </tr>
                      ))}
                      {obsoleteProducts.length === 0 && <tr><td colSpan="4" className="text-center">No hay productos obsoletos con este criterio</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowObsoleteModal(false)}>Cerrar</button>
              <button className="btn btn-danger" disabled={selectedObsolete.size === 0} onClick={handleDeactivateSelected}>Desactivar seleccionados ({selectedObsolete.size})</button>
            </div>
          </div>
        </div>
      )}

      {showWasteModal && (
        <div className="modal-overlay" onClick={() => setShowWasteModal(false)} onKeyDown={modalKeys(() => { setShowWasteModal(false); setError('') }, handleWasteSubmit)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Registrar Merma</h3>
            <div className="form-group">
              <label>Producto</label>
              {wasteForm.product_id ? (
                <p><strong>{wasteForm.product_name}</strong></p>
              ) : (
                <select value={wasteForm.product_id} onChange={e => setWasteForm({...wasteForm, product_id: e.target.value, product_name: e.target.selectedOptions[0].text})}>
                  <option value="">Seleccionar producto...</option>
                  {allProducts.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</option>)}
                </select>
              )}
            </div>
            <div className="form-group">
              <label>Cantidad *</label>
              <input type="number" step="0.01" value={wasteForm.quantity} onChange={e => setWasteForm({...wasteForm, quantity: e.target.value})} autoFocus />
            </div>
            <div className="form-group">
              <label>Tipo</label>
              <select value={wasteForm.waste_type} onChange={e => setWasteForm({...wasteForm, waste_type: e.target.value})}>
                <option value="waste">Merma (pérdida)</option>
                <option value="return_to_supplier">Devolución a proveedor</option>
              </select>
            </div>
            <div className="form-group">
              <label>Motivo *</label>
              <textarea value={wasteForm.reason} onChange={e => setWasteForm({...wasteForm, reason: e.target.value})} rows="2" placeholder="Ej: Producto caducado, dañado, robo..." required></textarea>
            </div>
            <div className="form-group">
              <label>Notas</label>
              <input type="text" value={wasteForm.notes} onChange={e => setWasteForm({...wasteForm, notes: e.target.value})} placeholder="Opcional" />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowWasteModal(false); setError('') }}>Cancelar</button>
              <button className="btn btn-warning" onClick={handleWasteSubmit}>Registrar Merma</button>
            </div>
          </div>
        </div>
      )}

      {showCategoriesModal && (
        <div className="modal-overlay" onClick={() => setShowCategoriesModal(false)} onKeyDown={modalKeys(() => setShowCategoriesModal(false), handleCreateCategory)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Categorías</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setShowCategoriesModal(false)} tabIndex="0">Cerrar</button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{display:'flex', gap:'0.5rem'}}>
                <input type="text" className="input-lg" placeholder="Nombre de categoría" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} autoFocus />
                <button className="btn btn-primary" onClick={handleCreateCategory} tabIndex="0">{editingCategory ? 'Actualizar' : 'Agregar'}</button>
              </div>
              <div className="table-responsive" style={{marginTop:'1rem'}}>
                <table className="table">
                  <thead>
                    <tr><th>Nombre</th><th>Productos</th><th></th></tr>
                  </thead>
                  <tbody>
                    {categories.map(c => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td style={{fontSize:'0.85rem', color:'#666'}}>{c.product_count || 0}</td>
                        <td className="actions-cell">
                          <button className="btn btn-sm btn-outline" onClick={() => { setNewCategoryName(c.name); setEditingCategory(c) }} tabIndex="0">Editar</button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteCategory(c.id)} tabIndex="0">X</button>
                        </td>
                      </tr>
                    ))}
                    {categories.length === 0 && <tr><td colSpan="3" className="text-center">Sin categorías</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWasteList && (
        <div className="modal-overlay" onClick={() => setShowWasteList(false)} onKeyDown={modalKeys(() => setShowWasteList(false), () => setShowWasteList(false))}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Historial de Mermas y Devoluciones</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setShowWasteList(false)}>Cerrar</button>
            </div>
            <div className="modal-body">
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Pérdida</th><th>Motivo</th><th>Registró</th></tr>
                  </thead>
                  <tbody>
                    {wasteList.map(w => (
                      <tr key={w.id}>
                        <td style={{fontSize:'0.8rem'}}>{formatDateTime(w.created_at)}</td>
                        <td>{w.product_name || '-'}</td>
                        <td>{w.waste_type === 'return_to_supplier' ? 'Devolución' : 'Merma'}</td>
                        <td>{w.quantity} {w.unit_type || ''}</td>
                        <td className="text-danger">{formatMoney(w.total_loss)}</td>
                        <td style={{fontSize:'0.8rem'}}>{w.reason}</td>
                        <td style={{fontSize:'0.8rem'}}>{w.created_by_name || '-'}</td>
                      </tr>
                    ))}
                    {wasteList.length === 0 && <tr><td colSpan="7" className="text-center">Sin registros</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowWasteList(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
