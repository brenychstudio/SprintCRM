import { useQuery } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router-dom'
import { LeadDetailsForm } from '../../features/leads/LeadDetailsForm'
import { getLeadForEdit, leadsQueryKeys } from '../../../features/leads/leadsApi'
import { useI18n } from '../../../i18n/i18n'

export function LeadEditPage() {
  const { leadId } = useParams()
  const [searchParams] = useSearchParams()
  const { t } = useI18n()
  const query = useQuery({
    queryKey: leadsQueryKeys.detail(leadId ?? 'missing'),
    queryFn: () => getLeadForEdit(leadId!),
    enabled: Boolean(leadId),
  })

  if (query.isLoading) return <p className="text-sm text-zinc-500">{t('leadForm.loading')}</p>
  if (query.error || !query.data) return <div className="mx-auto max-w-2xl rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"><h1 className="font-semibold">{t('leadForm.error.loadTitle')}</h1><p className="mt-2">{t('leadForm.error.load')}</p></div>

  return <LeadDetailsForm mode="edit" lead={query.data} returnTo={searchParams.get('returnTo')} />
}
