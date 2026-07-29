type Translate = (key: string) => string

export function activityLabel(t: Translate, activityType: string): string {
  const key = `activity.${activityType}`
  const label = t(key)
  return label === key ? t('activity.unknown') : label
}
