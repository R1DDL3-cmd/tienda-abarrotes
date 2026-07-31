// TRABAJO SUSPENDIDO — "nunca perder trabajo" (principio 8).
//
// El caso real en el POS: el cliente olvidó algo y va por ello. El caso real
// en Compras: llega un cliente a media captura del pedido, o el proveedor
// llama para decir que un producto no lo trae. En ambos, lo que hay a medias
// se guarda completo y se recupera tal cual.
//
// Vive en localStorage —igual que la cola offline— para sobrevivir a un
// cierre accidental del programa o a un corte de luz.

export function makeSuspendStore(key, { max = 20 } = {}) {
  function read() {
    try {
      const raw = localStorage.getItem(key)
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list : []
    } catch (e) {
      return []
    }
  }

  function write(list) {
    try { localStorage.setItem(key, JSON.stringify(list.slice(0, max))) } catch (e) {}
  }

  return {
    list: () => read(),
    count: () => read().length,

    // Guarda el trabajo en curso. `resumen` es lo que se muestra en la lista
    // al retomarlo (total, número de renglones, a quién corresponde).
    suspend(payload, resumen = {}) {
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `susp-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const list = read()
      list.unshift({ id, createdAt: new Date().toISOString(), ...resumen, payload })
      write(list)
      return id
    },

    // Recupera y elimina de la lista: retomar es un movimiento, no una copia.
    resume(id) {
      const list = read()
      const idx = list.findIndex(s => s.id === id)
      if (idx === -1) return null
      const [found] = list.splice(idx, 1)
      write(list)
      return found
    },

    discard(id) {
      write(read().filter(s => s.id !== id))
    },
  }
}
