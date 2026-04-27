import { useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useI18n } from '../../i18n/i18n'
import type { SupportedLang } from '../../i18n/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useThemeMode } from '../theme/useThemeMode'

export function AppShell() {
  const { signOut } = useAuth()
  const { lang, setLang, t } = useI18n()
  const { theme, setTheme } = useThemeMode()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const navItems = useMemo(
    () => [
      { to: '/today', label: t('nav.today') },
      { to: '/active-contacts', label: t('nav.activeContacts') },
      { to: '/leads', label: t('nav.leads') },
      { to: '/imports', label: t('nav.imports') },
      { to: '/pipeline', label: t('nav.pipeline') },
      { to: "/reports", label: t("nav.reports") },
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
    <div className="crm-workspace-enter crm-shell h-screen overflow-hidden bg-zinc-50 text-zinc-900">
      <div className="crm-shell-inner mx-auto flex h-full w-full max-w-screen-2xl gap-5 overflow-hidden p-3 sm:p-5">
        <aside className="crm-sidebar flex w-64 shrink-0 flex-col rounded-[1.75rem] border border-zinc-200/80 bg-white/90 p-4 shadow-[0_18px_60px_rgba(24,24,27,0.08)] backdrop-blur-xl">
          <p className="mb-5 text-sm font-semibold tracking-wide text-zinc-700">{t('app.name')}</p>

          <label className="mb-5 block space-y-1.5">
            <span className="text-xs font-medium text-zinc-500">{t('lang.label')}</span>
            <select
              value={lang}
              onChange={(event) => setLang(event.target.value as SupportedLang)}
              className="w-full rounded-xl border border-zinc-200/90 bg-white/80 px-3 py-2 text-sm outline-none transition focus:border-zinc-300 focus:bg-white focus:ring-4 focus:ring-zinc-200/60"
            >
              <option value="en">{t('lang.en')}</option>
              <option value="uk">{t('lang.uk')}</option>
              <option value="es">{t('lang.es')}</option>
              <option value="ru">{t('lang.ru')}</option>
            </select>
          </label>

          <div className="crm-theme-switch mb-5" role="group" aria-label="Theme">

            <button

              type="button"

              onClick={() => setTheme('light')}

              className={`crm-theme-choice ${theme === 'light' ? 'is-active' : ''}`}

              aria-pressed={theme === 'light'}

            >

              Light

            </button>

            <button

              type="button"

              onClick={() => setTheme('dark')}

              className={`crm-theme-choice ${theme === 'dark' ? 'is-active' : ''}`}

              aria-pressed={theme === 'dark'}

            >

              Dark

            </button>

          </div>


          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `block rounded-xl px-3 py-2.5 text-sm font-medium transition duration-200 ${
                    isActive ? 'bg-zinc-950 text-white shadow-[0_10px_28px_rgba(24,24,27,0.12)]' : 'text-zinc-600 hover:bg-zinc-100/80 hover:text-zinc-900'
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
            className="mt-4 shrink-0 rounded-xl border border-zinc-200/90 bg-white/70 px-3 py-2.5 text-left text-sm font-medium text-zinc-700 transition duration-200 hover:bg-zinc-50 hover:text-zinc-950 disabled:opacity-60"
          >
            {isSigningOut ? t('auth.signingOut') : t('auth.signOut')}
          </button>
        </aside>

        <main className="crm-main min-w-0 flex-1 overflow-y-auto rounded-[1.75rem] border border-zinc-200/80 bg-white/92 p-6 shadow-[0_24px_80px_rgba(24,24,27,0.08)] backdrop-blur-xl">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
