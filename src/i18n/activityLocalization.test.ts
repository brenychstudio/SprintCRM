import { describe, expect, it } from 'vitest'
import type { ActivityType } from '../features/leads/types'
import en from './locales/en'
import es from './locales/es'
import ru from './locales/ru'
import uk from './locales/uk'

const activityTypes: ActivityType[] = [
  'imported', 'contacted', 'replied', 'proposal_sent', 'won', 'lost', 'note', 'stage_changed', 'next_action_set',
  'ai_draft_generated', 'ai_draft_applied', 'ai_draft_copied', 'outreach_sent', 'followup_scheduled', 'reply_marked',
  'manual_edit', 'campaign_added', 'research_saved', 'outreach_draft_saved', 'outreach_approved', 'campaign_skipped',
]

describe('activity localization', () => {
  it.each([
    ['en', en], ['uk', uk], ['es', es], ['ru', ru],
  ])('%s includes every known activity label and the fallback', (_, dictionary) => {
    for (const type of activityTypes) expect(dictionary[`activity.${type}`]).toBeTruthy()
    expect(dictionary['activity.unknown']).toBeTruthy()
  })
})
