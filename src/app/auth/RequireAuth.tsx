import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export function RequireAuth() {
  const { isLoading, session } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">Loading session…</div>
  }

  if (!session) {
    return <Navigate replace to="/login" state={{ from: location }} />
  }

  return <Outlet />
}
