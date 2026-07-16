import React, { useState, useEffect, useCallback } from 'react'
import { products, accounting } from '../api'
import { formatDateTime, formatDate, formatCalendarDate } from '../dateUtils'

function formatMoney(n) {
  return '$' + parseFloat(n || 0).toFixed(2)
}

export default function Inventory({ user, onLogout }) {
  const [productList, setProductList] = useState([])
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [categories, setCategories] = useState([])
  const [filterCat, setFilterCat] = useState('')
  const [showLowStock, setShowLowStock] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [form, setForm] = useState({ name: '', barcode: '', category_id: '', purchase_price: '', sale_price: '', stock: '', min_stock: '', supplier: '', expiry_date: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [kardexProduct, setKardexProduct] = useState(null)
  const [kardexData, setKardexData] = useState([])
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
  useEffect(() => { loadProducts(); const interval = setInterval(loadProducts, 30000); return () => clearInterval(interval) }, [loadProducts])

  useEffect(() => { loadCategories() }, [])

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
    if (!confirm('¿Eliminar esta categoría? Los productos asociados quedarán sin categoría.')) return
    try {
      await products.deleteCategory(id)
      await loadCategories()
      setSuccess('Categoría eliminada')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) { setError(e.message) }
  }

  const openNew = () => {
    setEditingProduct(null)
    setForm({ name: '', barcode: '', category_id: '', purchase_price: '', sale_price: '', stock: '', min_stock: '', supplier: '', unit_type: 'unit' })
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
      supplier: p.supplier || '',
      unit_type: p.unit_type || 'unit'
    })
    setError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.sale_price) { setError('Nombre y precio de venta requeridos'); return }
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
        supplier: form.supplier || null,
        unit_type: form.unit_type || 'unit'
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
    if (!confirm('Desactivar este producto?')) return
    try { await products.remove(id); loadProducts(); setSuccess('Producto desactivado'); setTimeout(() => setSuccess(''), 3000) }
    catch (e) { setError(e.message) }
  }

  const openKardex = async (p) => {
    setKardexProduct(p)
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
    if (!confirm('Eliminar este lote?')) return
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
    if (!confirm('Eliminar este código?')) return
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
    if (!confirm(`¿Desactivar ${selectedObsolete.size} producto(s)? Podrás reactivarlos manualmente después si hace falta.`)) return
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
                    <td><strong>{p.name}</strong></td>
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
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
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
                <input type="text" value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} />
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
            {error && <div className="alert alert-error" style={{marginTop:'0.5rem'}}>{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowForm(false); setError('') }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>{editingProduct ? 'Actualizar' : 'Crear'}</button>
            </div>
          </div>
        </div>
      )}

      {kardexProduct && (
        <div className="modal-overlay" onClick={() => setKardexProduct(null)}>
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
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setKardexProduct(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {batchProduct && (
        <div className="modal-overlay" onClick={() => setBatchProduct(null)}>
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
        <div className="modal-overlay" onClick={() => setBarcodeProduct(null)}>
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
        <div className="modal-overlay" onClick={() => setShowObsoleteModal(false)}>
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
        <div className="modal-overlay" onClick={() => setShowWasteModal(false)}>
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
        <div className="modal-overlay" onKeyDown={(e) => { if (e.key === 'Escape') setShowCategoriesModal(false) }}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Categorías</h3>
              <button className="btn btn-sm btn-outline" onClick={() => setShowCategoriesModal(false)} tabIndex="0">Cerrar</button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{display:'flex', gap:'0.5rem'}}>
                <input type="text" className="input-lg" placeholder="Nombre de categoría" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCategory() }} autoFocus />
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
        <div className="modal-overlay" onClick={() => setShowWasteList(false)}>
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
