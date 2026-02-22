import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from './app/auth/LoginPage'
import { AppShell } from './app/layout/AppShell'
import { LeadsPage } from './app/pages/leads/LeadsPage'
import { TodayPage } from './app/pages/today/TodayPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route path="/today" element={<TodayPage />} />
        <Route path="/leads" element={<LeadsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  )
}

export default App
