import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import en from './locales/en'
import es from './locales/es'
import ru from './locales/ru'
import uk from './locales/uk'

export const supportedLangs = ['en', 'uk', 'es', 'ru'] as const
export type SupportedLang = (typeof supportedLangs)[number]

const defaultLang: SupportedLang = 'en'
const storageKey = 'outreach_crm_lang'

const dictionaries: Record<SupportedLang, Record<string, string>> = {
  en,
  uk,
  es,
  ru,
}

type Params = Record<string, string | number>

type I18nContextValue = {
  lang: SupportedLang
  setLang: (lang: SupportedLang) => void
  t: (key: string, params?: Params) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function resolveInitialLang(): SupportedLang {
  const storedLang = localStorage.getItem(storageKey)
  if (storedLang && supportedLangs.includes(storedLang as SupportedLang)) {
    return storedLang as SupportedLang
  }

  return defaultLang
}

function formatTemplate(template: string, params?: Params): string {
  if (!params) return template

  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`))
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<SupportedLang>(resolveInitialLang)

  const setLang = (nextLang: SupportedLang) => {
    setLangState(nextLang)
    localStorage.setItem(storageKey, nextLang)
  }

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, params) => {
        const template = dictionaries[lang][key] ?? dictionaries[defaultLang][key] ?? key
        return formatTemplate(template, params)
      },
    }),
    [lang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }

  return context
}
