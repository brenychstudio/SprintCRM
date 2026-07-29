import { describe, expect, it } from 'vitest'
import { activityLabel } from './activityLabels'

describe('activityLabel', () => {
  it('returns the localized activity label when one exists', () => {
    expect(activityLabel((key) => key === 'activity.outreach_approved' ? 'Outreach approved' : key, 'outreach_approved')).toBe('Outreach approved')
  })

  it('uses a user-facing fallback instead of exposing a raw activity key', () => {
    const t = (key: string) => key === 'activity.unknown' ? 'Activity updated' : key
    expect(activityLabel(t, 'future_activity')).toBe('Activity updated')
  })
})
