import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

const navItems = [
  { to: '/today', label: 'Today' },
  { to: '/leads', label: 'Leads' },
]

export function AppShell() {
  const { signOut } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)

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
          <p className="mb-4 text-sm font-semibold tracking-wide text-zinc-500">Outreach CRM</p>
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
            className="mt-auto rounded-xl border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-700 disabled:opacity-60"
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </aside>

        <main className="flex-1 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
