import { useI18n } from '../../../i18n/i18n'

export function TodayPage() {
  const { t } = useI18n()

  return (
    <section>
      <h1 className="text-2xl font-semibold text-zinc-900">{t('today.title')}</h1>
      <p className="mt-2 text-sm text-zinc-600">{t('today.placeholder')}</p>
    </section>
  )
}
