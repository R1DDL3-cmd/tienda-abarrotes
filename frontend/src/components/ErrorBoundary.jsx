import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Arial, sans-serif', padding: '2rem', textAlign: 'center' }}>
          <h2 style={{ color: '#e74c3c', marginBottom: '1rem' }}>Ocurrió un error inesperado</h2>
          <p style={{ color: '#666', marginBottom: '0.5rem' }}>{this.state.error?.message || 'Error desconocido'}</p>
          <p style={{ color: '#999', fontSize: '0.85rem', marginBottom: '2rem' }}>Los datos están seguros en la base de datos</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
            style={{ padding: '0.75rem 2rem', fontSize: '1rem', background: '#3498db', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
          >
            Recargar Aplicación
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
