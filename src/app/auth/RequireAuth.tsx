import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useI18n } from '../../i18n/i18n'
import { useAuth } from './AuthProvider'

export function RequireAuth() {
  const { isLoading, session } = useAuth()
  const { t } = useI18n()
  const location = useLocation()

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">{t('auth.loadingSession')}</div>
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
