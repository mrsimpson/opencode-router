import { createSignal, createEffect, Show, For, onCleanup, onMount } from "solid-js"
import { useI18n } from "./ui/context"
import type { Repo, Branch } from "./api"
import { useT } from "./i18n"

type Props = {
  /** Placeholder text when empty */
  placeholder?: string
  /** Current value */
  value: string
  /** Called when user selects an item */
  onSelect: (value: string) => void
  /** Items fetched from API */
  items?: { label: string; value: string }[]
  /** Show a loading hint while items are being fetched */
  loading?: boolean
}

export function Autocomplete(props: Props) {
  const t = useT(useI18n())
  const [isOpen, setIsOpen] = createSignal(false)
  const [highlightedIndex, setHighlightedIndex] = createSignal(0)

  let containerRef: HTMLDivElement | undefined

  const displayItems = () => props.items ?? []
  const filteredItems = () => {
    const query = props.value.toLowerCase().trim()
    if (!query) return displayItems()
    return displayItems().filter((item) => item.label.toLowerCase().includes(query))
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = filteredItems()
    if (!isOpen() && items.length > 0) {
      setIsOpen(true)
      return
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlightedIndex((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = items[highlightedIndex()]
      if (item) {
        props.onSelect(item.value)
        setIsOpen(false)
      }
    } else if (e.key === "Escape") {
      setIsOpen(false)
    }
  }

  const handleSelect = (value: string) => {
    props.onSelect(value)
    setIsOpen(false)
  }

  // Close on click outside
  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setIsOpen(false)
    }
  }

  onMount(() => {
    document.addEventListener("click", handleClickOutside)
    onCleanup(() => document.removeEventListener("click", handleClickOutside))
  })

  createEffect(() => {
    // Reset highlight when items change
    const items = filteredItems()
    if (highlightedIndex() >= items.length) {
      setHighlightedIndex(0)
    }
  })

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", flex: props.placeholder?.includes("repo") ? "2" : "1", "min-width": "0" }}
    >
      <input
        type="text"
        placeholder={props.placeholder}
        value={props.value}
        onInput={(e) => {
          const v = e.currentTarget.value
          props.onSelect(v)
          if (v.trim() && displayItems().length > 0) {
            setIsOpen(true)
          }
        }}
        onFocus={() => {
          if (displayItems().length > 0) {
            setIsOpen(true)
          }
        }}
        onBlur={() => {
          setIsOpen(false)
        }}
        onKeyDown={handleKeyDown}
        style={{
          background: "var(--background-base)",
          border: "1px solid var(--border-base)",
          color: "var(--text-base)",
          "border-radius": "6px",
          padding: "8px 10px",
          "font-size": "13px",
          outline: "none",
          width: "100%",
        }}
      />

      <Show when={isOpen() && (props.loading || filteredItems().length > 0)}>
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: "0",
            right: "0",
            "margin-top": "4px",
            background: "var(--background-base)",
            border: "1px solid var(--border-base)",
            "border-radius": "6px",
            "max-height": "240px",
            overflow: "auto",
            "z-index": "50",
          }}
        >
          <Show when={props.loading}>
            <div
              style={{
                padding: "8px 10px",
                "font-size": "13px",
                color: "var(--text-dimmed-base)",
                "font-style": "italic",
              }}
            >
              {t("autocomplete.loading")}
            </div>
          </Show>
          <For each={filteredItems()}>
            {(item, index) => (
              <div
                style={{
                  padding: "8px 10px",
                  cursor: "pointer",
                  "font-size": "13px",
                  color: "var(--text-base)",
                  background: index() === highlightedIndex() ? "var(--background-base)" : "transparent",
                }}
                onMouseEnter={() => setHighlightedIndex(index())}
                onClick={() => handleSelect(item.value)}
                onMouseDown={(e) => e.preventDefault()}
              >
                <div style={{ "font-weight": "500" }}>{item.label}</div>
                <Show when={item.value !== item.label}>
                  <div style={{ color: "var(--text-dimmed-base)", "font-size": "11px" }}>{item.value}</div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
