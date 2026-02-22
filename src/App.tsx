import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './app/auth/AuthProvider'
import { LoginPage } from './app/auth/LoginPage'
import { RequireAuth } from './app/auth/RequireAuth'
import { AppShell } from './app/layout/AppShell'
import { ImportsPage } from './app/pages/imports/ImportsPage'
import { LeadsPage } from './app/pages/leads/LeadsPage'
import { PipelinePage } from './app/pages/pipeline/PipelinePage'
import { TodayPage } from './app/pages/today/TodayPage'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/today" element={<TodayPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/imports" element={<ImportsPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
