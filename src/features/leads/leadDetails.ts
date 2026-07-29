import { cleanNullable, deriveWebsiteDomain, normalizeEmail, normalizePhone } from '../../lib/normalize'
import type { Lead, OutreachChannel, OutreachLanguage } from './types'

export const leadDetailFieldNames = [
  'company_name',
  'contact_name',
  'email',
  'phone',
  'website',
  'preferred_channel',
  'niche',
  'country_city',
  'language',
  'notes',
] as const

export type LeadDetailFieldName = (typeof leadDetailFieldNames)[number]

export type LeadDetailsValues = {
  company_name: string
  contact_name: string
  email: string
  phone: string
  website: string
  preferred_channel: '' | OutreachChannel
  niche: string
  country_city: string
  language: '' | OutreachLanguage
  notes: string
}

export type NormalizedLeadDetails = {
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  website: string | null
  website_domain: string | null
  preferred_channel: OutreachChannel | null
  niche: string | null
  country_city: string | null
  language: OutreachLanguage | null
  notes: string | null
}

export type LeadDetailsValidationErrors = Partial<Record<'company_name' | 'email' | 'website', string>>
export type LeadDuplicateKind = 'email' | 'domain' | 'phone' | 'company'
export type LeadDuplicateMatch = {
  lead: Lead
  kinds: LeadDuplicateKind[]
  exactIdentifier: boolean
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function emptyLeadDetails(): LeadDetailsValues {
  return {
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    website: '',
    preferred_channel: '',
    niche: '',
    country_city: '',
    language: '',
    notes: '',
  }
}

export function leadDetailsFromLead(lead: Lead): LeadDetailsValues {
  return {
    company_name: lead.company_name,
    contact_name: lead.contact_name ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    website: lead.website ?? '',
    preferred_channel: lead.preferred_channel ?? '',
    niche: lead.niche ?? '',
    country_city: lead.country_city ?? '',
    language: lead.language ?? '',
    notes: lead.notes ?? '',
  }
}

export function normalizeWebsiteForSave(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function isValidWebsite(value: string): boolean {
  const normalized = normalizeWebsiteForSave(value)
  if (!normalized) return true

  try {
    const url = new URL(normalized)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function validateLeadDetails(values: LeadDetailsValues): LeadDetailsValidationErrors {
  const errors: LeadDetailsValidationErrors = {}
  if (!values.company_name.trim()) errors.company_name = 'required'
  if (values.email.trim() && !emailPattern.test(values.email.trim())) errors.email = 'invalid'
  if (!isValidWebsite(values.website)) errors.website = 'invalid'
  return errors
}

export function normalizeLeadDetails(values: LeadDetailsValues): NormalizedLeadDetails {
  const website = normalizeWebsiteForSave(values.website)
  return {
    company_name: values.company_name.trim(),
    contact_name: cleanNullable(values.contact_name),
    email: normalizeEmail(values.email),
    phone: cleanNullable(values.phone),
    website,
    website_domain: deriveWebsiteDomain(website, null),
    preferred_channel: values.preferred_channel || null,
    niche: cleanNullable(values.niche),
    country_city: cleanNullable(values.country_city),
    language: values.language || null,
    notes: cleanNullable(values.notes),
  }
}

function comparableCompany(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase()
}

export function classifyLeadDuplicates(
  values: LeadDetailsValues,
  leads: Lead[],
  excludeLeadId?: string,
): LeadDuplicateMatch[] {
  const normalized = normalizeLeadDetails(values)
  const phoneNorm = normalizePhone(normalized.phone)
  const companyNorm = comparableCompany(normalized.company_name)

  return leads.flatMap((lead) => {
    if (lead.id === excludeLeadId) return []
    const kinds: LeadDuplicateKind[] = []
    if (normalized.email && lead.email_norm === normalized.email) kinds.push('email')
    if (normalized.website_domain && lead.website_domain_norm === normalized.website_domain) kinds.push('domain')
    if (phoneNorm && lead.phone_norm === phoneNorm) kinds.push('phone')
    if (companyNorm && comparableCompany(lead.company_name) === companyNorm) kinds.push('company')
    if (!kinds.length) return []
    return [{ lead, kinds, exactIdentifier: kinds.some((kind) => kind !== 'company') }]
  })
}

export function changedLeadDetailFields(before: LeadDetailsValues, after: LeadDetailsValues): LeadDetailFieldName[] {
  const beforeNormalized = normalizeLeadDetails(before)
  const afterNormalized = normalizeLeadDetails(after)
  return leadDetailFieldNames.filter((field) => beforeNormalized[field] !== afterNormalized[field])
}

export function hasLeadContactChannel(lead: Pick<Lead, 'email' | 'phone' | 'website'>): boolean {
  return Boolean(lead.email?.trim() || lead.phone?.trim() || lead.website?.trim())
}

export function hasEnteredContactChannel(values: LeadDetailsValues): boolean {
  return Boolean(values.email.trim() || values.phone.trim() || values.website.trim())
}
