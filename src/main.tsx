import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './app/auth/AuthProvider'
import { I18nProvider } from './i18n/i18n'
import './style.css'

const queryClient = new QueryClient()
const router = createBrowserRouter([{ path: '*', element: <App /> }])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <I18nProvider>
          <RouterProvider router={router} />
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
