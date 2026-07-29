import { useSearchParams } from 'react-router-dom'
import { LeadDetailsForm } from '../../features/leads/LeadDetailsForm'

export function LeadCreatePage() {
  const [searchParams] = useSearchParams()
  return <LeadDetailsForm mode="create" returnTo={searchParams.get('returnTo')} />
}
