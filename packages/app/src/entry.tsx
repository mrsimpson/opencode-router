import { render } from "solid-js/web"
import { DialogProvider, I18nProvider } from "./ui/context"
import { createI18n } from "./i18n"
import { App } from "./app"
import "./index.css"

const i18n = createI18n(navigator.language || "en")

render(
  () => (
    <I18nProvider value={i18n}>
      <DialogProvider>
        <App />
      </DialogProvider>
    </I18nProvider>
  ),
  document.getElementById("root")!,
)
