import { For, createSignal, onCleanup, onMount } from "solid-js"
import { useI18n } from "./ui/context"
import { subscribeSessionEvents } from "./api"
import { useT } from "./i18n"

/** Ordered startup stages — each maps to an i18n label key. */
const STAGES = ["initializing", "configuring", "preparing", "starting", "readying"] as const
type Stage = (typeof STAGES)[number]

const STAGE_LABEL_KEY: Record<Stage, string> = {
  initializing: "loading.stage.initializing",
  configuring: "loading.stage.configuring",
  preparing: "loading.stage.preparing",
  starting: "loading.stage.starting",
  readying: "loading.stage.readying",
}

export function LoadingScreen(props: {
  hash: string
  onReady?: (url: string) => void
  onError?: (message: string) => void
}) {
  const t = useT(useI18n())
  const [stage, setStage] = createSignal<Stage>("initializing")
  let es: EventSource | undefined

  onMount(() => {
    es = subscribeSessionEvents(props.hash, {
      onProgress: (s) => {
        if (STAGES.includes(s as Stage)) setStage(s as Stage)
      },
      onComplete: (url) => {
        if (props.onReady) props.onReady(url)
        else window.location.replace(url)
      },
      onError: (message) => {
        if (props.onError) props.onError(message)
      },
    })
  })

  onCleanup(() => es?.close())

  const stageIndex = () => STAGES.indexOf(stage())

  return (
    <div class="flex flex-col items-center gap-6" style={{ "max-width": "320px", width: "100%" }}>
      {/* Inline keyframes so the spin animation works without Tailwind utility generation */}
      <style>{`@keyframes oc-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Arc spinner driven by pure CSS — no Tailwind utility dependency */}
      <div
        style={{
          width: "36px",
          height: "36px",
          "border-radius": "50%",
          border: "3px solid var(--border-base)",
          "border-top-color": "var(--icon-strong-base)",
          animation: "oc-spin 0.75s linear infinite",
        }}
      />

      {/* Title */}
      <p class="text-14-medium text-center" style={{ color: "var(--text-base)" }}>
        {t("loading.title")}
      </p>

      {/* Step progress track */}
      <div class="flex flex-col gap-2" style={{ width: "100%" }}>
        <For each={STAGES}>
          {(s, i) => {
            const isPast = () => i() < stageIndex()
            const isCurrent = () => i() === stageIndex()
            return (
              <div class="flex items-center gap-3">
                {/* Circle indicator */}
                <div
                  class="shrink-0 rounded-full"
                  style={{
                    width: "8px",
                    height: "8px",
                    background: isPast()
                      ? "var(--surface-success-strong)"
                      : isCurrent()
                        ? "var(--icon-strong-base)"
                        : "var(--border-base)",
                    transition: "background 0.3s ease",
                  }}
                />
                {/* Stage label */}
                <span
                  class="text-12-regular"
                  style={{
                    color: isCurrent()
                      ? "var(--text-base)"
                      : isPast()
                        ? "var(--surface-success-strong)"
                        : "var(--text-dimmed-base)",
                    transition: "color 0.3s ease",
                    "font-weight": isCurrent() ? "500" : undefined,
                  }}
                >
                  {t(STAGE_LABEL_KEY[s] as Parameters<typeof t>[0])}
                </span>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
