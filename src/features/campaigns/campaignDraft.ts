import type { CampaignInput } from './types'
import type { CampaignWizardStep } from './workflow'

export type CampaignWizardDraft = {
  version: 1
  form: CampaignInput
  step: CampaignWizardStep
  selectedLeadIds: string[]
}

export function campaignDraftKey(campaignId?: string): string {
  return `sprintcrm:campaign-draft:${campaignId ?? 'new'}`
}

export function readCampaignDraft(storage: Pick<Storage, 'getItem'>, key: string): CampaignWizardDraft | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<CampaignWizardDraft>
    if (value.version !== 1 || !value.form || ![1, 2, 3, 4].includes(value.step ?? 0) || !Array.isArray(value.selectedLeadIds)) return null
    return value as CampaignWizardDraft
  } catch {
    return null
  }
}

export function writeCampaignDraft(storage: Pick<Storage, 'setItem'>, key: string, draft: CampaignWizardDraft): void {
  storage.setItem(key, JSON.stringify(draft))
}

export function clearCampaignDraft(storage: Pick<Storage, 'removeItem'>, key: string): void {
  storage.removeItem(key)
}
