import { For, Show, createMemo, createSignal } from "solid-js"
import { useI18n } from "./ui/context"
import type { Session } from "./api"
import { useT } from "./i18n"
import { SessionItem } from "./session-item"
import { sortedAndGroupedSessions } from "./session-utils"

type Props = {
  sessions: Session[]
  onOpenSession: (session: Session) => void
  onResumeSession: (session: Session) => void
  onTerminateSession: (session: Session) => void
}

export function SessionList(props: Props) {
  const t = useT(useI18n())
  const [expandedHash, setExpandedHash] = createSignal<string | null>(null)

  const toggleExpand = (hash: string) => setExpandedHash((prev) => (prev === hash ? null : hash))

  const groups = createMemo(() => sortedAndGroupedSessions(props.sessions))
  const allSorted = createMemo(() => [...groups().active, ...groups().stopped])
  const showGroupHeaders = createMemo(() => groups().active.length > 0 && groups().stopped.length > 0)

  const groupCard = (label: string, sessions: Session[]) => (
    <div
      class="rounded-xl border overflow-hidden"
      style={{ background: "var(--background-surface)", "border-color": "var(--border-base)" }}
    >
      {/* Group header */}
      <div class="px-4 py-2 border-b" style={{ "border-color": "var(--border-base)" }}>
        <p
          class="text-11-medium"
          style={{
            color: "var(--text-dimmed-base)",
            "text-transform": "uppercase",
            "letter-spacing": "0.06em",
          }}
        >
          {label}
        </p>
      </div>
      {/* Sessions */}
      <For each={sessions}>
        {(session, i) => (
          <div style={{ "border-top": i() > 0 ? "1px solid var(--border-base)" : "none" }}>
            <SessionItem
              session={session}
              onClick={() => {
                if (session.state === "stopped") props.onResumeSession(session)
                else if (session.state === "running") props.onOpenSession(session)
              }}
              expanded={expandedHash() === session.hash}
              onToggleExpand={() => toggleExpand(session.hash)}
              onTerminate={() => props.onTerminateSession(session)}
            />
          </div>
        )}
      </For>
    </div>
  )

  return (
    <Show when={props.sessions.length > 0}>
      <div class="flex flex-col gap-3">
        <p class="text-12-medium px-1" style={{ color: "var(--text-dimmed-base)" }}>
          {t("app.sessions")}
        </p>
        <Show
          when={showGroupHeaders()}
          fallback={
            <div
              class="rounded-xl border overflow-hidden"
              style={{ background: "var(--background-surface)", "border-color": "var(--border-base)" }}
            >
              <For each={allSorted()}>
                {(session, i) => (
                  <div style={{ "border-top": i() > 0 ? "1px solid var(--border-base)" : "none" }}>
                    <SessionItem
                      session={session}
                      onClick={() => {
                        if (session.state === "stopped") props.onResumeSession(session)
                        else if (session.state === "running") props.onOpenSession(session)
                      }}
                      expanded={expandedHash() === session.hash}
                      onToggleExpand={() => toggleExpand(session.hash)}
                      onTerminate={() => props.onTerminateSession(session)}
                    />
                  </div>
                )}
              </For>
            </div>
          }
        >
          <Show when={groups().active.length > 0}>
            {groupCard(t("session.group.active"), groups().active)}
          </Show>
          <Show when={groups().stopped.length > 0}>
            {groupCard(t("session.group.stopped"), groups().stopped)}
          </Show>
        </Show>
      </div>
    </Show>
  )
}
