import { useRef, useState, useCallback } from 'react'

// ÍNDICE DE LA FILA ACTIVA, SIN DESFASE.
//
// Con el teclado, tres pulsaciones pueden llegar dentro del mismo fotograma
// (autorrepetición al dejar ↓ presionado, o un usuario rápido). React agrupa
// los cambios de estado y no vuelve a renderizar entre una tecla y la
// siguiente, así que un manejador que lea `activeRow` del render anterior
// actuaría sobre la fila equivocada: bajas dos y marcas la de antes.
//
// La solución es llevar el índice también en un ref, que sí cambia al
// instante: el estado sirve para pintar y el ref para decidir.
export function useActiveIndex(length) {
  const [index, setIndexState] = useState(0)
  const ref = useRef(0)

  const clamp = (n) => Math.max(0, Math.min(n, Math.max(0, length - 1)))

  const setIndex = useCallback((n) => {
    ref.current = Math.max(0, Math.min(n, Math.max(0, length - 1)))
    setIndexState(ref.current)
  }, [length])

  const move = useCallback((delta) => {
    ref.current = Math.max(0, Math.min(ref.current + delta, Math.max(0, length - 1)))
    setIndexState(ref.current)
  }, [length])

  // Índice vigente AHORA (no el del último render).
  const current = () => clamp(ref.current)

  return { index: clamp(index), setIndex, move, current, ref }
}
