export function cleanNullable(input: string | null | undefined): string | null {
  const s = (input ?? '').trim()
  return s ? s : null
}

export function normalizeEmail(input: string | null | undefined): string | null {
  const s = (input ?? '').trim().toLowerCase()
  return s ? s : null
}

export function normalizePhone(input: string | null | undefined): string | null {
  const s = (input ?? '').trim()
  if (!s) return null
  const out = s.replace(/[^0-9+]/g, '')
  return out ? out : null
}

export function extractDomain(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim().toLowerCase()
  if (!raw) return null

  try {
    const withProto = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`
    const u = new URL(withProto)
    const host = u.hostname.replace(/^www\./, '')
    return host || null
  } catch {
    const cleaned = raw.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '')
    return cleaned ? cleaned : null
  }
}

export function normalizeWebsiteDomain(input: string | null | undefined): string | null {
  const s = (input ?? '').trim().toLowerCase().replace(/^www\./, '')
  return s ? s : null
}

export function deriveWebsiteDomain(website: string | null | undefined, websiteDomain: string | null | undefined): string | null {
  const fromDomain = normalizeWebsiteDomain(websiteDomain)
  if (fromDomain) return fromDomain
  return extractDomain(website)
}