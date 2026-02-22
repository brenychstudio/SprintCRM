import { useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useI18n } from '../../i18n/i18n'
import type { SupportedLang } from '../../i18n/i18n'
import { useAuth } from '../auth/AuthProvider'

export function AppShell() {
  const { signOut } = useAuth()
  const { lang, setLang, t } = useI18n()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const navItems = useMemo(
    () => [
      { to: '/today', label: t('nav.today') },
      { to: '/leads', label: t('nav.leads') },
      { to: '/imports', label: t('nav.imports') },
    ],
    [t],
  )

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      await signOut()
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl gap-6 p-6">
        <aside className="flex w-64 flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-4 text-sm font-semibold tracking-wide text-zinc-500">{t('app.name')}</p>

          <label className="mb-4 block space-y-1">
            <span className="text-xs text-zinc-500">{t('lang.label')}</span>
            <select
              value={lang}
              onChange={(event) => setLang(event.target.value as SupportedLang)}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
            >
              <option value="en">{t('lang.en')}</option>
              <option value="uk">{t('lang.uk')}</option>
              <option value="es">{t('lang.es')}</option>
              <option value="ru">{t('lang.ru')}</option>
            </select>
          </label>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `block rounded-xl px-3 py-2 text-sm transition ${
                    isActive ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="mt-auto rounded-xl border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
          >
            {isSigningOut ? t('auth.signingOut') : t('auth.signOut')}
          </button>
        </aside>

        <main className="flex-1 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <Outlet />
        </main>
      </div>
    </div>
  )
}