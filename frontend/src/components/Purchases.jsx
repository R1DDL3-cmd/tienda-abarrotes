import React, { useState, useEffect } from 'react'
import { suppliers as suppliersApi, purchases as purchasesApi, products as productsApi } from '../api'

export default function Purchases({ user }) {
  const [suppliers, setSuppliers] = useState([])
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [purchases, setPurchases] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [supplierForm, setSupplierForm] = useState({ name: '', contact: '', phone: '', email: '', address: '', notes: '' })
  const [editingSupplier, setEditingSupplier] = useState(null)

  const [showPurchaseModal, setShowPurchaseModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailPurchase, setDetailPurchase] = useState(null)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receivePurchase, setReceivePurchase] = useState(null)
  const [receiveItems, setReceiveItems] = useState([])
  const [products, setProducts] = useState([])
  const [purchaseForm, setPurchaseForm] = useState({ supplier_id: '', invoice_number: '', notes: '', status: 'pending', items: [] })
  const [productSearch, setProductSearch] = useState('')
  const [filteredProducts, setFilteredProducts] = useState([])
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { syncAndLoad() }, [])

  const syncAndLoad = async () => {
    try { await suppliersApi.syncFromProducts() } catch (_) {}
    loadSuppliers()
  }
  useEffect(() => { if (selectedSupplier) loadPurchases(selectedSupplier.id) }, [selectedSupplier])
  useEffect(() => { if (products.length === 0) loadProducts() }, [])

  useEffect(() => {
    if (productSearch && products.length > 0 && purchaseForm.supplier_id) {
      const q = productSearch.toLowerCase()
      const supplierName = (suppliers.find(s => s.id === purchaseForm.supplier_id)?.name || '').toLowerCase()
      setFilteredProducts(products.filter(p => {
        const matchesSupplier = (p.supplier || '').toLowerCase() === supplierName
        const matchesSearch = p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q))
        return matchesSupplier && matchesSearch
      }))
    } else {
      setFilteredProducts([])
    }
  }, [productSearch, products, purchaseForm.supplier_id, suppliers])

  const loadSuppliers = async () => {
    try {
      const data = await suppliersApi.list(search)
      setSuppliers(data)
    } catch (e) { setError(e.message) }
  }

  const loadPurchases = async (supplierId) => {
    setLoading(true)
    try {
      const data = await suppliersApi.purchases(supplierId)
      setPurchases(data)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const loadProducts = async () => {
    try {
      const data = await productsApi.all()
      setProducts(data)
    } catch (e) { setError(e.message) }
  }

  const openNewSupplier = () => {
    setSupplierForm({ name: '', contact: '', phone: '', email: '', address: '', notes: '' })
    setEditingSupplier(null)
    setShowSupplierModal(true)
  }

  const openEditSupplier = (s) => {
    setSupplierForm({ name: s.name, contact: s.contact || '', phone: s.phone || '', email: s.email || '', address: s.address || '', notes: s.notes || '' })
    setEditingSupplier(s)
    setShowSupplierModal(true)
  }

  const handleSaveSupplier = async () => {
    if (!supplierForm.name.trim()) { setError('El nombre es obligatorio'); return }
    try {
      if (editingSupplier) {
        await suppliersApi.update(editingSupplier.id, supplierForm)
      } else {
        await suppliersApi.create(supplierForm)
      }
      setShowSupplierModal(false)
      loadSuppliers()
      setSuccess(editingSupplier ? 'Proveedor actualizado' : 'Proveedor creado')
    } catch (e) { setError(e.message) }
  }

  const handleDeleteSupplier = async (id) => {
    if (!confirm('Desactivar este proveedor?')) return
    try {
      await suppliersApi.remove(id)
      loadSuppliers()
      if (selectedSupplier?.id === id) { setSelectedSupplier(null); setPurchases([]) }
      setSuccess('Proveedor desactivado')
    } catch (e) { setError(e.message) }
  }

  const openNewPurchase = (supplier) => {
    setPurchaseForm({ supplier_id: supplier.id, invoice_number: '', notes: '', status: 'pending', items: [] })
    setProductSearch('')
    setError('')
    setShowPurchaseModal(true)
  }

  const removeItem = (idx) => {
    setPurchaseForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))
  }

  const updateItem = (idx, field, value) => {
    const items = [...purchaseForm.items]
    items[idx] = { ...items[idx], [field]: value }
    if (field === 'quantity' || field === 'unit_price') {
      items[idx].subtotal = (parseFloat(items[idx].quantity) || 0) * (parseFloat(items[idx].unit_price) || 0)
    }
    setPurchaseForm(prev => ({ ...prev, items }))
  }

  const calcTotals = () => {
    const subtotal = purchaseForm.items.reduce((s, i) => s + (parseFloat(i.subtotal) || 0), 0)
    const tax = subtotal * 0.16
    const total = subtotal + tax
    return { subtotal, tax, total }
  }

  const handleSavePurchase = async () => {
    if (purchaseForm.items.length === 0) { setError('Agrega al menos un producto'); return }
    try {
      await purchasesApi.create(purchaseForm)
      setShowPurchaseModal(false)
      if (selectedSupplier) loadPurchases(selectedSupplier.id)
      setSuccess(purchaseForm.status === 'pending' ? 'Pedido creado' : 'Compra registrada e inventariada')
    } catch (e) { setError(e.message) }
  }

  const openReceivePurchase = async (purchaseId) => {
    try {
      const data = await purchasesApi.get(purchaseId)
      setReceivePurchase(data)
      setReceiveItems(data.items.map(item => ({
        id: item.id,
        product_name: item.product_name,
        ordered_quantity: item.quantity,
        ordered_unit_price: item.unit_price,
        received_quantity: item.quantity,
        received_unit_price: item.unit_price
      })))
      setShowReceiveModal(true)
    } catch (e) { setError(e.message) }
  }

  const updateReceiveItem = (idx, field, value) => {
    setReceiveItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const confirmReceivePurchase = async () => {
    try {
      await purchasesApi.receive(receivePurchase.id, receiveItems.map(it => ({
        id: it.id,
        received_quantity: parseFloat(it.received_quantity) || 0,
        received_unit_price: parseFloat(it.received_unit_price) || 0
      })))
      setShowReceiveModal(false)
      if (selectedSupplier) loadPurchases(selectedSupplier.id)
      setSuccess('Pedido recibido e inventariado')
    } catch (e) { setError(e.message) }
  }

  const handleCancelPurchase = async (purchaseId) => {
    if (!confirm('Cancelar esta compra? Se revertira el stock si ya fue inventariada.')) return
    try {
      await purchasesApi.cancel(purchaseId)
      if (selectedSupplier) loadPurchases(selectedSupplier.id)
      setSuccess('Compra cancelada')
    } catch (e) { setError(e.message) }
  }

  const viewDetail = async (purchaseId) => {
    try {
      const data = await purchasesApi.get(purchaseId)
      setDetailPurchase(data)
      setShowDetailModal(true)
    } catch (e) { setError(e.message) }
  }

  const statusBadge = (status) => {
    const map = { pending: 'badge-warning', completed: 'badge-success', cancelled: 'badge-error' }
    const labels = { pending: 'Pendiente', completed: 'Completada', cancelled: 'Cancelada' }
    return <span className={`badge ${map[status] || ''}`}>{labels[status] || status}</span>
  }

  return (
    <div className="purchases-container">
      <div className="page-header">
        <h2>Compras y Pedidos</h2>
        <button className="btn btn-primary" onClick={openNewSupplier}>Nuevo Proveedor</button>
      </div>

      {error && <div className="alert alert-error" onClick={() => setError('')}>{error}</div>}
      {success && <div className="alert alert-success" onClick={() => setSuccess('')}>{success}</div>}

      <div className="purchases-layout">
        <div className="suppliers-panel">
          <div className="form-group">
            <input type="text" className="input" placeholder="Buscar proveedor..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') loadSuppliers() }} />
          </div>
          <div className="suppliers-list">
            {suppliers.map(s => (
              <div key={s.id} className={`supplier-card ${selectedSupplier?.id === s.id ? 'active' : ''}`} onClick={() => setSelectedSupplier(s)}>
                <div className="supplier-card-header">
                  <strong>{s.name}</strong>
                  <button className="btn btn-sm btn-outline" onClick={e => { e.stopPropagation(); openEditSupplier(s) }}>Editar</button>
                </div>
                {s.contact && <div className="supplier-card-info">{s.contact}</div>}
                {s.phone && <div className="supplier-card-info">{s.phone}</div>}
              </div>
            ))}
            {suppliers.length === 0 && <p className="text-muted">No hay proveedores</p>}
          </div>
        </div>

        <div className="purchases-panel">
          {selectedSupplier ? (
            <>
              <div className="purchases-panel-header">
                <h3>{selectedSupplier.name}</h3>
                <button className="btn btn-primary" onClick={() => openNewPurchase(selectedSupplier)}>Nuevo Pedido</button>
              </div>
              {loading ? <div className="loading">Cargando...</div> : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Factura</th>
                      <th>Total</th>
                      <th>Estado</th>
                      <th>Fecha</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map(p => (
                      <tr key={p.id}>
                        <td>#{p.id}</td>
                        <td>{p.invoice_number || '-'}</td>
                        <td>${(p.total || 0).toFixed(2)}</td>
                        <td>{statusBadge(p.status)}</td>
                        <td>{new Date(p.created_at + 'Z').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' })}</td>
                        <td>
                          <button className="btn btn-sm btn-outline" onClick={() => viewDetail(p.id)}>Ver</button>
                          {p.status === 'pending' && <button className="btn btn-sm btn-success" onClick={() => openReceivePurchase(p.id)}>Recibir</button>}
                          {p.status !== 'cancelled' && <button className="btn btn-sm btn-danger" onClick={() => handleCancelPurchase(p.id)}>Cancelar</button>}
                        </td>
                      </tr>
                    ))}
                    {purchases.length === 0 && <tr><td colSpan="6" className="text-muted">Sin movimientos</td></tr>}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div className="purchases-empty">
              <p>Selecciona un proveedor para ver sus pedidos y compras</p>
            </div>
          )}
        </div>
      </div>

      {showSupplierModal && (
        <div className="modal-overlay" onClick={() => setShowSupplierModal(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h3>{editingSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h3>
            <div className="form-group">
              <label>Nombre *</label>
              <input type="text" className="input" value={supplierForm.name} onChange={e => setSupplierForm({...supplierForm, name: e.target.value})} autoFocus />
            </div>
            <div className="form-group">
              <label>Contacto</label>
              <input type="text" className="input" value={supplierForm.contact} onChange={e => setSupplierForm({...supplierForm, contact: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Telefono</label>
              <input type="text" className="input" value={supplierForm.phone} onChange={e => setSupplierForm({...supplierForm, phone: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" className="input" value={supplierForm.email} onChange={e => setSupplierForm({...supplierForm, email: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Direccion</label>
              <input type="text" className="input" value={supplierForm.address} onChange={e => setSupplierForm({...supplierForm, address: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Notas</label>
              <textarea className="input" rows="2" value={supplierForm.notes} onChange={e => setSupplierForm({...supplierForm, notes: e.target.value})} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowSupplierModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveSupplier}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {showPurchaseModal && (
        <div className="modal-overlay">
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <h3>Nuevo Pedido / Compra</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Proveedor</label>
                <input type="text" className="input" value={suppliers.find(s => s.id === purchaseForm.supplier_id)?.name || ''} disabled />
              </div>
              <div className="form-group">
                <label>Factura / Folio</label>
                <input type="text" className="input" value={purchaseForm.invoice_number} onChange={e => setPurchaseForm({...purchaseForm, invoice_number: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Tipo</label>
                <select className="input" value={purchaseForm.status} onChange={e => setPurchaseForm({...purchaseForm, status: e.target.value})}>
                  <option value="pending">Pedido (pendiente)</option>
                  <option value="completed">Compra directa (inventariar ahora)</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Notas</label>
              <input type="text" className="input" value={purchaseForm.notes} onChange={e => setPurchaseForm({...purchaseForm, notes: e.target.value})} />
            </div>

            <h4>Productos</h4>
            <div className="product-global-search">
              <input type="text" className="input" placeholder="Buscar producto del proveedor y agregar..." value={productSearch} onChange={e => setProductSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setShowProductDropdown(false) }} autoFocus />
              {showProductDropdown && filteredProducts.length > 0 && (
                <div className="product-dropdown">
                  {filteredProducts.map(p => (
                    <div key={p.id} className="product-dropdown-item" onClick={() => {
                      const exists = purchaseForm.items.find(i => i.product_id === p.id)
                      if (exists) {
                        updateItem(purchaseForm.items.indexOf(exists), 'quantity', exists.quantity + 1)
                      } else {
                        setPurchaseForm(prev => ({ ...prev, items: [...prev.items, { product_id: p.id, product_name: p.name, quantity: 1, unit_price: p.purchase_price || 0, subtotal: p.purchase_price || 0 }] }))
                      }
                      setProductSearch('')
                      setShowProductDropdown(false)
                    }}>
                      {p.name} {p.barcode ? `(${p.barcode})` : ''} {p.purchase_price ? `- $${p.purchase_price.toFixed(2)}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Precio Unitario</th>
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {purchaseForm.items.map((item, idx) => (
                  <tr key={idx}>
                    <td>{item.product_name}</td>
                    <td><input type="number" className="input" style={{width: '80px'}} min="0.01" step="0.01" value={item.quantity} onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)} /></td>
                    <td><input type="number" className="input" style={{width: '100px'}} min="0" step="0.01" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} /></td>
                    <td>${(item.subtotal || 0).toFixed(2)}</td>
                    <td><button className="btn btn-sm btn-danger" onClick={() => removeItem(idx)}>X</button></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="purchase-totals">
              <div className="total-row"><span>Subtotal:</span><span>${calcTotals().subtotal.toFixed(2)}</span></div>
              <div className="total-row"><span>IVA (16%):</span><span>${calcTotals().tax.toFixed(2)}</span></div>
              <div className="total-row total-final"><span>Total:</span><span>${calcTotals().total.toFixed(2)}</span></div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowPurchaseModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSavePurchase}>
                {purchaseForm.status === 'pending' ? 'Crear Pedido' : 'Registrar Compra'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceiveModal && receivePurchase && (
        <div className="modal-overlay" onClick={() => setShowReceiveModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <h3>Recibir Pedido #{receivePurchase.id}</h3>
            <p className="text-muted">Confirma lo que realmente llegó. Si cambió la cantidad o el precio, ajústalo aquí — el inventario y el costo del producto se actualizan con estos valores, no con lo pedido.</p>
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Pedido</th>
                  <th>Cantidad recibida</th>
                  <th>Precio recibido</th>
                </tr>
              </thead>
              <tbody>
                {receiveItems.map((item, idx) => (
                  <tr key={item.id}>
                    <td>{item.product_name}</td>
                    <td className="text-muted">{item.ordered_quantity} x ${(item.ordered_unit_price || 0).toFixed(2)}</td>
                    <td><input type="number" className="input" style={{width: '90px'}} min="0" step="0.01" value={item.received_quantity} onChange={e => updateReceiveItem(idx, 'received_quantity', e.target.value)} /></td>
                    <td><input type="number" className="input" style={{width: '100px'}} min="0" step="0.01" value={item.received_unit_price} onChange={e => updateReceiveItem(idx, 'received_unit_price', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowReceiveModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={confirmReceivePurchase}>Confirmar recepción</button>
            </div>
          </div>
        </div>
      )}

      {showDetailModal && detailPurchase && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <h3>Detalle de Compra #{detailPurchase.id}</h3>
            <div className="detail-grid">
              <div><strong>Proveedor:</strong> {detailPurchase.supplier_name}</div>
              {detailPurchase.supplier_contact && <div><strong>Contacto:</strong> {detailPurchase.supplier_contact}</div>}
              {detailPurchase.supplier_phone && <div><strong>Telefono:</strong> {detailPurchase.supplier_phone}</div>}
              <div><strong>Factura:</strong> {detailPurchase.invoice_number || '-'}</div>
              <div><strong>Estado:</strong> {statusBadge(detailPurchase.status)}</div>
              <div><strong>Fecha:</strong> {new Date(detailPurchase.created_at + 'Z').toLocaleDateString('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' })}</div>
              {detailPurchase.notes && <div><strong>Notas:</strong> {detailPurchase.notes}</div>}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th><th>Pedido</th><th>Precio pedido</th>
                  {detailPurchase.status === 'completed' && <><th>Recibido</th><th>Precio recibido</th></>}
                </tr>
              </thead>
              <tbody>
                {detailPurchase.items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.product_name} {item.barcode ? `(${item.barcode})` : ''}</td>
                    <td>{item.quantity}</td>
                    <td>${(item.unit_price || 0).toFixed(2)}</td>
                    {detailPurchase.status === 'completed' && (
                      <>
                        <td>{item.received_quantity != null ? item.received_quantity : item.quantity}</td>
                        <td>${(item.received_unit_price != null ? item.received_unit_price : item.unit_price || 0).toFixed(2)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="purchase-totals">
              <div className="total-row"><span>Subtotal:</span><span>${(detailPurchase.subtotal || 0).toFixed(2)}</span></div>
              <div className="total-row"><span>IVA (16%):</span><span>${(detailPurchase.tax || 0).toFixed(2)}</span></div>
              <div className="total-row total-final"><span>Total:</span><span>${(detailPurchase.total || 0).toFixed(2)}</span></div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowDetailModal(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
