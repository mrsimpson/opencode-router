import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"

export type UiI18nKey = string

export type UiI18nParams = Record<string, string | number | boolean>

export type UiI18n = {
  locale: Accessor<string>
  t: (key: UiI18nKey, params?: UiI18nParams) => string
}

const fallback: UiI18n = {
  locale: () => "en",
  t: (key) => String(key),
}

const Context = createContext<UiI18n>(fallback)

export function I18nProvider(props: ParentProps<{ value: UiI18n }>) {
  return <Context.Provider value={props.value}>{props.children}</Context.Provider>
}

export function useI18n() {
  return useContext(Context)
}
