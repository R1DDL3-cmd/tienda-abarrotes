// Registro centralizado de cambios de precio (tabla price_history, migración
// v14). Lo usan los tres lugares donde un precio puede cambiar: la edición
// manual del producto, el import de Excel y la recepción de compras (que
// actualiza el costo al precio realmente recibido).
function recordPriceChange(db, { productId, field, oldValue, newValue, source, user }) {
  const oldN = oldValue === null || oldValue === undefined ? null : Number(oldValue);
  const newN = newValue === null || newValue === undefined ? null : Number(newValue);
  // Solo cambios reales: registrar "de $20 a $20" en cada guardado del
  // formulario llenaría el historial de ruido.
  if (oldN === newN) return;
  if (oldN !== null && newN !== null && Math.abs(oldN - newN) < 0.005) return;
  db.prepare(
    `INSERT INTO price_history (product_id, field, old_value, new_value, source, changed_by, changed_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(productId, field, oldN, newN, source || 'manual', user ? user.id : null, user ? (user.name || '') : '');
}

module.exports = { recordPriceChange };
