import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from './app/auth/LoginPage'
import { RequireAuth } from './app/auth/RequireAuth'
import { AppShell } from './app/layout/AppShell'
import { LeadsPage } from './app/pages/leads/LeadsPage'
import { TodayPage } from './app/pages/today/TodayPage'
import { ImportsPage } from './app/pages/imports/ImportsPage'
import { PipelinePage } from './app/pages/pipeline/PipelinePage'
import { ReportsPage } from "./app/pages/reports/ReportsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/imports" element={<ImportsPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/reports" element={<ReportsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  )
}
