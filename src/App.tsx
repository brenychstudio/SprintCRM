import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from './app/auth/LoginPage'
import { RequireAuth } from './app/auth/RequireAuth'
import { AppShell } from './app/layout/AppShell'
import { LeadsPage } from './app/pages/leads/LeadsPage'
import { TodayPage } from './app/pages/today/TodayPage'
import { ActiveContactsPage } from './app/pages/active-contacts/ActiveContactsPage'
import { ImportsPage } from './app/pages/imports/ImportsPage'
import { PipelinePage } from './app/pages/pipeline/PipelinePage'
import { ReportsPage } from './app/pages/reports/ReportsPage'
import { featureFlags } from './features/featureFlags/featureFlags'
import { useI18n } from './i18n/i18n'

const CampaignsPage = lazy(() => import('./app/pages/campaigns/CampaignsPage').then((module) => ({ default: module.CampaignsPage })))
const CampaignEditorPage = lazy(() => import('./app/pages/campaigns/CampaignEditorPage').then((module) => ({ default: module.CampaignEditorPage })))
const CampaignOverviewPage = lazy(() => import('./app/pages/campaigns/CampaignOverviewPage').then((module) => ({ default: module.CampaignOverviewPage })))
const CampaignReviewStartPage = lazy(() => import('./app/pages/campaigns/CampaignReviewStartPage').then((module) => ({ default: module.CampaignReviewStartPage })))
const CampaignWorkspacePage = lazy(() => import('./app/pages/campaigns/CampaignWorkspacePage').then((module) => ({ default: module.CampaignWorkspacePage })))
const LeadCreatePage = lazy(() => import('./app/pages/leads/LeadCreatePage').then((module) => ({ default: module.LeadCreatePage })))
const LeadEditPage = lazy(() => import('./app/pages/leads/LeadEditPage').then((module) => ({ default: module.LeadEditPage })))

function OutreachRoute({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  if (!featureFlags.outreach_ops_enabled) return <Navigate to="/today" replace />
  return <Suspense fallback={<p className="text-sm text-zinc-500">{t('campaigns.loading')}</p>}>{children}</Suspense>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="/active-contacts" element={<ActiveContactsPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/new" element={<Suspense fallback={null}><LeadCreatePage /></Suspense>} />
          <Route path="/leads/:leadId/edit" element={<Suspense fallback={null}><LeadEditPage /></Suspense>} />
          <Route path="/imports" element={<ImportsPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/campaigns" element={<OutreachRoute><CampaignsPage /></OutreachRoute>} />
          <Route path="/campaigns/new" element={<OutreachRoute><CampaignEditorPage /></OutreachRoute>} />
          <Route path="/campaigns/:campaignId" element={<OutreachRoute><CampaignOverviewPage /></OutreachRoute>} />
          <Route path="/campaigns/:campaignId/edit" element={<OutreachRoute><CampaignEditorPage /></OutreachRoute>} />
          <Route path="/campaigns/:campaignId/review" element={<OutreachRoute><CampaignReviewStartPage /></OutreachRoute>} />
          <Route path="/campaigns/:campaignId/review/:memberId" element={<OutreachRoute><CampaignWorkspacePage /></OutreachRoute>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  )
}
