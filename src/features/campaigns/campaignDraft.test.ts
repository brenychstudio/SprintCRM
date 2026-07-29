import { describe, expect, it } from 'vitest'
import { campaignDraftKey, clearCampaignDraft, readCampaignDraft, writeCampaignDraft, type CampaignWizardDraft } from './campaignDraft'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('campaign wizard draft', () => {
  it('survives a lead-edit round trip and clears after campaign save', () => {
    const storage = memoryStorage()
    const key = campaignDraftKey('campaign-1')
    const draft: CampaignWizardDraft = {
      version: 1,
      step: 4,
      selectedLeadIds: ['lead-1'],
      form: { name: 'Pilot', description: '', target_segment: '', offer_summary: '', default_channel: 'email', default_language: 'en', tone: '', status: 'draft' },
    }
    writeCampaignDraft(storage, key, draft)
    expect(readCampaignDraft(storage, key)).toEqual(draft)
    clearCampaignDraft(storage, key)
    expect(readCampaignDraft(storage, key)).toBeNull()
  })
})
