const localBase = 'https://sprintcrm.local'

export function safeLeadReturnTarget(value: string | null | undefined, fallback = '/leads'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback

  try {
    const target = new URL(value, localBase)
    if (target.origin !== localBase) return fallback

    const campaignEdit = /^\/campaigns\/[0-9a-f-]{36}\/edit$/i.test(target.pathname)
    const campaignCreate = target.pathname === '/campaigns/new'
    if ((campaignEdit || campaignCreate) && target.searchParams.get('step') === 'leads') {
      return `${target.pathname}?step=leads`
    }
  } catch {
    return fallback
  }

  return fallback
}

export function leadDrawerTarget(leadId: string): string {
  return `/leads?open=${encodeURIComponent(leadId)}`
}
