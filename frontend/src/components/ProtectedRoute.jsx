import React from 'react'
import { Navigate } from 'react-router-dom'

export default function ProtectedRoute({ user, children, allowedRoles }) {
  if (!user) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const fallback = user.role === 'inventory' ? '/inventory' : '/pos'
    return <Navigate to={fallback} replace />
  }
  return children
}
