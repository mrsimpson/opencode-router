import { For, Show, createMemo } from "solid-js"
import { useI18n } from "./ui/context"
import { Button } from "./ui/button"
import type { Session } from "./api"
import { useT } from "./i18n"
import { SessionItem } from "./session-item"
import { sortedAndGroupedSessions } from "./session-utils"

type Props = {
  collapsed: boolean
  onToggleCollapse: () => void
  sessions: Session[]
  email: string
  activeHash?: string
  onNewSession: () => void
  onOpenSession: (session: Session) => void
  onResumeSession: (session: Session) => void
  onTerminateSession: (session: Session) => void
}

const sidebarBase = {
  background: "var(--background-surface)",
  "border-right": "1px solid var(--border-base)",
  "flex-shrink": "0",
}

export function SessionSidebar(props: Props) {
  const t = useT(useI18n())
  const groups = createMemo(() => sortedAndGroupedSessions(props.sessions, props.activeHash))

  const renderItem = (session: Session) => (
    <SessionItem
      session={session}
      compact
      active={props.activeHash === session.hash}
      onClick={() => {
        if (session.state === "stopped") props.onResumeSession(session)
        else if (session.state === "running") props.onOpenSession(session)
      }}
      trailing={
        <button
          class="opacity-0 group-hover:opacity-100 text-12-regular px-1 shrink-0"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-danger-base, #ef4444)",
          }}
          onClick={(e) => {
            e.stopPropagation()
            props.onTerminateSession(session)
          }}
          title={t("session.action.terminate")}
        >
          ✕
        </button>
      }
    />
  )

  const groupLabel = (label: string) => (
    <p class="text-10-regular px-2 pt-2 pb-0.5" style={{ color: "var(--text-dimmed-base)", "text-transform": "uppercase", "letter-spacing": "0.05em" }}>
      {label}
    </p>
  )

  const hasMultipleGroups = createMemo(
    () =>
      (groups().current.length > 0 ? 1 : 0) +
        (groups().active.length > 0 ? 1 : 0) +
        (groups().stopped.length > 0 ? 1 : 0) >
      1,
  )

  return (
    <Show
      when={!props.collapsed}
      fallback={
        <aside class="flex flex-col items-center py-4 w-12" style={sidebarBase}>
          <button
            title={t("sidebar.expand")}
            onClick={props.onToggleCollapse}
            class="size-8 flex items-center justify-center rounded"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--icon-base)" }}
          >
            ›
          </button>
        </aside>
      }
    >
      <aside class="flex flex-col w-56 py-4 gap-4" style={{ ...sidebarBase, overflow: "visible" }}>
        <div class="flex items-center justify-between px-3">
          <span class="text-13-medium" style={{ color: "var(--text-base)" }}>
            OpenCode
          </span>
          <button
            title={t("sidebar.collapse")}
            onClick={props.onToggleCollapse}
            class="size-6 flex items-center justify-center rounded"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--icon-base)" }}
          >
            ‹
          </button>
        </div>

        <div class="px-3">
          <Button onClick={props.onNewSession} icon="arrow-left" variant="secondary" class="w-full">
            {t("sidebar.home")}
          </Button>
        </div>

        <Show when={props.sessions.length > 0}>
          <div class="flex flex-col gap-0 px-1 overflow-y-auto flex-1">
            {/* Current group */}
            <Show when={groups().current.length > 0}>
              <Show when={hasMultipleGroups()}>{groupLabel(t("session.group.current"))}</Show>
              <For each={groups().current}>{renderItem}</For>
            </Show>
            {/* Active group */}
            <Show when={groups().active.length > 0}>
              <Show when={hasMultipleGroups()}>{groupLabel(t("session.group.active"))}</Show>
              <For each={groups().active}>{renderItem}</For>
            </Show>
            {/* Stopped group */}
            <Show when={groups().stopped.length > 0}>
              <Show when={hasMultipleGroups()}>{groupLabel(t("session.group.stopped"))}</Show>
              <For each={groups().stopped}>{renderItem}</For>
            </Show>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
