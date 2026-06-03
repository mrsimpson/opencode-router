import { dict as en } from "./en"
import { dict as de } from "./de"
import type { DictKey } from "./en"

export type { DictKey }

const dicts: Record<string, Record<string, string>> = { en, de }

function resolve(locale: string): Record<string, string> {
  // exact match first (e.g. "de"), then language prefix (e.g. "de-AT" → "de")
  return dicts[locale] ?? dicts[locale.split("-")[0]] ?? en
}

function interpolate(value: string, params?: Record<string, string | number | boolean>): string {
  if (!params) return value
  return value.replace(/{{\s*([^}]+?)\s*}}/g, (_, k) => String(params[String(k).trim()] ?? ""))
}

export function createI18n(locale: string) {
  const dict = resolve(locale)
  const t = (key: string, params?: Record<string, string | number | boolean>): string =>
    interpolate(dict[key] ?? (en as Record<string, string>)[key] ?? key, params)
  return { locale: () => locale, t } as const
}

/** Typed helper for use inside this package — narrows key to known DictKey */
export function useT(i18n: { t: (key: string, params?: Record<string, string | number | boolean>) => string }) {
  return (key: DictKey, params?: Record<string, string | number | boolean>) => i18n.t(key, params)
}
