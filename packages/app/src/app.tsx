import { Button } from "./ui/button"
import { Dialog } from "./ui/dialog"
import { TextField } from "./ui/text-field"
import { Icon } from "./ui/icon"
import { useDialog, useI18n } from "./ui/context"
import { Match, Show, Switch, createSignal, onCleanup, onMount, batch } from "solid-js"
import {
  type Session,
  createNewProjectSession,
  createSession,
  resumeSession,
  subscribeSessionsStream,
  suggestBranch,
  terminateSession,
  getUserSecret,
  setUserSecret,
  deleteUserSecret,
} from "./api"
import { useT } from "./i18n"
import { LoadingScreen } from "./loading-screen"
import { SessionInputBar } from "./session-input-bar"
import { SessionList } from "./session-list"
import { SessionSidebar } from "./session-sidebar"
import { buildNewProjectKey, buildSessionKey, GIT_URL_PATTERN } from "./setup-form-utils"
import { getPhaseKindAfterUrlRestore } from "./session-utils"

type AppPhase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "creating"; hash: string }
  | { kind: "open"; hash: string; url: string }
  | { kind: "error"; message: string }

export function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)
  const [appPhase, setAppPhase] = createSignal<AppPhase>({ kind: "loading" })
  const [sessions, setSessions] = createSignal<Session[]>([])
  const [email, setEmail] = createSignal("")
  const [repoUrl, setRepoUrl] = createSignal("")
  const [sourceBranch, setSourceBranch] = createSignal("")
  const [sessionBranch, setSessionBranch] = createSignal("")
  const [activeTab, setActiveTab] = createSignal<"git" | "new-project">("git")
  const [promptText, setPromptText] = createSignal("")
  const [formError, setFormError] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)


  // Settings state - support multiple key-value pairs
  const [secretKeys, setSecretKeys] = createSignal<string[]>([])
  const [newEnvVarName, setNewEnvVarName] = createSignal("")
  const [newEnvVarValue, setNewEnvVarValue] = createSignal("")
  const [secretLoading, setSecretLoading] = createSignal(false)
  const [secretMessage, setSecretMessage] = createSignal("")
  const [secretMessageIsError, setSecretMessageIsError] = createSignal(false)

  // Load user secret keys on mount
  onMount(async () => {
    try {
      const { keys } = await getUserSecret()
      setSecretKeys(keys)
    } catch {
      /* silent */
    }
  })

  const handleOpenSettings = async () => {
    setNewEnvVarName("")
    setNewEnvVarValue("")
    setSecretMessage("")
    try {
      const { keys } = await getUserSecret()
      setSecretKeys(keys)
    } catch {
      /* silent */
    }
    dialog.show(() => (
      <Dialog fit title={t("settings.title")} onClose={() => dialog.close()}>
        <div class="flex flex-col gap-4 p-4">
          <div>
            <h3 class="text-14-medium mb-1">{t("settings.apiKeys")}</h3>
            <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
              {t("settings.apiKeys.description")}
            </p>
          </div>

          {/* List of existing secrets */}
          <Show when={secretKeys().length > 0}>
            <div class="flex flex-col gap-2">
              {secretKeys().map((key) => (
                <div class="flex items-center gap-2 p-2 rounded" style={{ background: "var(--surface-elevated)" }}>
                  <code class="text-12-regular font-mono flex-1">{key}</code>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={async () => {
                      // Delete this specific key by fetching all secrets, removing it, and saving
                        setSecretLoading(true)
                        setSecretMessage("")
                        setSecretMessageIsError(false)
                        try {
                          const existing = await getUserSecret()
                          const remaining = { ...existing.secrets }
                          delete remaining[key]
                          if (Object.keys(remaining).length > 0) {
                            await setUserSecret(remaining)
                            setSecretKeys(Object.keys(remaining))
                          } else {
                            await deleteUserSecret()
                            setSecretKeys([])
                          }
                          setSecretMessageIsError(false)
                          setSecretMessage(t("settings.apiKeys.deleted"))
                        } catch (err) {
                          setSecretMessageIsError(true)
                          setSecretMessage(t("settings.apiKeys.error.delete"))
                        } finally {
                          setSecretLoading(false)
                        }
                    }}
                    disabled={secretLoading()}
                    style={{ color: "var(--text-danger-base, #ef4444)" }}
                    title={t("settings.apiKeys.delete")}
                  >
                    <Icon name="trash" style={{ color: "var(--text-danger-base, #ef4444)" }} />
                  </Button>
                </div>
              ))}
            </div>
          </Show>

          <Show when={secretKeys().length === 0}>
            <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
              {t("settings.apiKeys.none")}
            </p>
          </Show>

          {/* Add new secret form */}
          <div class="flex flex-col gap-2">
            <div class="flex gap-2">
              <TextField
                placeholder="ENV_VAR_NAME (e.g. OPENAI_API_KEY)"
                value={newEnvVarName()}
                onInput={(e) => setNewEnvVarName(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                class="flex-1"
              />
              <TextField
                placeholder={t("settings.apiKeys.placeholder")}
                value={newEnvVarValue()}
                onInput={(e) => setNewEnvVarValue(e.currentTarget.value)}
                type="password"
                class="flex-1"
              />
            </div>
            <div class="flex gap-2">
              <Button
                variant="primary"
                size="small"
                onClick={async () => {
                  const envVarName = newEnvVarName().trim()
                  const envVarValue = newEnvVarValue().trim()
                  if (!envVarName || !envVarValue) return
                  setSecretLoading(true)
                  setSecretMessage("")
                  setSecretMessageIsError(false)
                  try {
                    // Fetch existing secrets and merge with the new one
                    const existing = await getUserSecret()
                    const mergedSecrets = { ...existing.secrets, [envVarName]: envVarValue }
                    await setUserSecret(mergedSecrets)
                    setSecretKeys(Object.keys(mergedSecrets))
                    setNewEnvVarName("")
                    setNewEnvVarValue("")
                    setSecretMessageIsError(false)
                    setSecretMessage(t("settings.apiKeys.saved"))
                  } catch (err) {
                    setSecretMessageIsError(true)
                    setSecretMessage(t("settings.apiKeys.error.save"))
                  } finally {
                    setSecretLoading(false)
                  }
                }}
                disabled={secretLoading() || !newEnvVarName().trim() || !newEnvVarValue().trim()}
              >
                {secretKeys().length > 0 ? t("settings.apiKeys.add") : t("settings.apiKeys.set")}
              </Button>
              <Show when={secretKeys().length > 0}>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={async () => {
                    setSecretLoading(true)
                    setSecretMessage("")
                    setSecretMessageIsError(false)
                    try {
                      await deleteUserSecret()
                      setSecretKeys([])
                      setSecretMessageIsError(false)
                      setSecretMessage(t("settings.apiKeys.deleted"))
                    } catch (err) {
                      setSecretMessageIsError(true)
                      setSecretMessage(t("settings.apiKeys.error.delete"))
                    } finally {
                      setSecretLoading(false)
                    }
                  }}
                  disabled={secretLoading()}
                  style={{ color: "var(--text-danger-base, #ef4444)" }}
                >
                  {t("settings.apiKeys.deleteAll")}
                </Button>
              </Show>
            </div>
            <Show when={secretMessage()}>
              <p
                class="text-12-regular"
                style={{
                  color: secretMessageIsError()
                    ? "var(--text-danger-base, #ef4444)"
                    : "var(--text-dimmed-base)",
                }}
              >
                {secretMessage()}
              </p>
            </Show>
          </div>
        </div>
      </Dialog>
    ))
  }

  let promptRef: HTMLTextAreaElement | undefined

  const dialog = useDialog()
  const t = useT(useI18n())

  /** Navigate the browser URL without a full-page reload. */
  const navigate = (path: string) => window.history.pushState({}, "", path)

  /** Restore app phase from the current browser URL after sessions have loaded. */
  const restoreFromUrl = async () => {
    if (window.location.pathname === "/settings") {
      handleOpenSettings()
      return
    }
    const m = window.location.pathname.match(/^\/session\/([a-f0-9]{12})$/)
    if (!m) return
    const hash = m[1]
    const session = sessions().find((s) => s.hash === hash)
    if (!session) return

    // Resume stopped sessions before setting app phase
    let wasResumed = false
    if (session.state === "stopped") {
      try {
        await resumeSession(session.hash)
        wasResumed = true
      } catch (error) {
        console.error("Failed to resume session from URL", error)
        setAppPhase({
          kind: "error",
          message: "Failed to resume session. Please try again or select a session from the list.",
        })
        return
      }
    }

    // After resuming, always use LoadingScreen. For running sessions with a
    // resolved URL go directly to open; otherwise LoadingScreen polls events SSE.
    const phaseKind = getPhaseKindAfterUrlRestore(wasResumed, session.url)
    if (phaseKind === "open" && session.url !== null) {
      setAppPhase({ kind: "open", hash, url: session.url })
    } else {
      setAppPhase({ kind: "creating", hash })
    }
  }

  onMount(() => {
    // SSE stream provides the initial snapshot and all subsequent updates.
    // loadSessions() is no longer called on mount — the SSE replaces polling.
    let es: EventSource | null = null
    const startStream = () => {
      es?.close()
      es = subscribeSessionsStream({
        onSessions: (data) => {
          batch(() => {
            setEmail(data.email)
            setSessions(data.sessions)
            if (appPhase().kind === "loading") {
              setAppPhase({ kind: "ready" })
              restoreFromUrl()
            }
          })
        },
        onError: () => {
          if (appPhase().kind === "loading") {
            setAppPhase({ kind: "error", message: t("app.error.connect") })
          }
        },
      })
    }
    startStream()

    const onPopState = async () => {
      if (window.location.pathname === "/settings") {
        handleOpenSettings()
        return
      }
      const m = window.location.pathname.match(/^\/session\/([a-f0-9]{12})$/)
      if (!m) {
        setAppPhase({ kind: "ready" })
        return
      }
      const hash = m[1]
      const session = sessions().find((s) => s.hash === hash)
      if (!session) return

      // Resume stopped sessions
      let wasResumed = false
      if (session.state === "stopped") {
        try {
          await resumeSession(session.hash)
          wasResumed = true
        } catch (error) {
          console.error("Failed to resume session on popstate", error)
          setAppPhase({
            kind: "error",
            message: "Failed to resume session. Please try again or select a session from the list.",
          })
          return
        }
      }

      const phaseKind = getPhaseKindAfterUrlRestore(wasResumed, session.url)
      if (phaseKind === "open" && session.url !== null) {
        setAppPhase({ kind: "open", hash, url: session.url })
      } else {
        setAppPhase({ kind: "creating", hash })
      }
    }
    window.addEventListener("popstate", onPopState)
    onCleanup(() => {
      es?.close()
      window.removeEventListener("popstate", onPopState)
    })
  })

  const handleRepoUrlChange = async (url: string) => {
    setRepoUrl(url)
    if (!GIT_URL_PATTERN.test(url.trim())) return
    try {
      const { branch } = await suggestBranch(url.trim())
      setSessionBranch(branch)
    } catch {
      /* silent */
    }
  }

  const handleTerminateSession = (session: Session) => {
    const hash = session.hash
    const repo = session.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")
    dialog.show(() => (
      <Dialog fit title={t("session.terminate.title")} description={t("session.terminate.description", { repo })} onClose={() => dialog.close()}>
        <div class="flex justify-end gap-2 p-4 pt-2">
          <Button variant="secondary" size="small" onClick={() => dialog.close()}>
            {t("session.action.cancel")}
          </Button>
          <Button
            variant="secondary"
            size="small"
            style={{ color: "var(--text-danger-base, #ef4444)" }}
            onClick={() => {
              dialog.close()
              // Optimistic removal — remove from UI immediately
              setSessions((prev) => prev.filter((s) => s.hash !== hash))
              // If the terminated session was open, go back to ready
              const p = appPhase()
              if (p.kind === "open" && p.hash === hash) {
                navigate("/")
                setAppPhase({ kind: "ready" })
              }
              // Fire-and-forget the API call in the background
              terminateSession(hash).catch((err) => {
                console.error("Failed to terminate session:", err)
              })
            }}
          >
            {t("session.action.terminate")}
          </Button>
        </div>
      </Dialog>
    ))
  }

  const handleSubmit = async () => {
    setFormError("")
    if (!promptText().trim()) return

    if (activeTab() === "new-project") {
      setSubmitting(true)
      try {
        const result = await createNewProjectSession(promptText())
        batch(() => {
          navigate(`/session/${result.hash}`)
          setAppPhase({ kind: "creating", hash: result.hash })
        })
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Network error")
      } finally {
        setSubmitting(false)
      }
      return
    }

    const validated = buildSessionKey(repoUrl(), sourceBranch(), {
      repoUrlRequired: t("form.error.repoUrl.required"),
      repoUrlInvalid: t("form.error.repoUrl.invalid"),
      sourceBranchRequired: t("form.error.sourceBranch.required"),
    })
    if (!validated.valid) {
      setFormError(validated.error)
      return
    }
    if (!sessionBranch()) {
      setFormError(t("form.error.sessionBranch"))
      return
    }
    setSubmitting(true)
    try {
      const result = await createSession(validated.repoUrl, sessionBranch(), validated.sourceBranch, promptText())
      batch(() => {
        navigate(`/session/${result.hash}`)
        setAppPhase({ kind: "creating", hash: result.hash })
      })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error")
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenSession = (session: Session) => {
    navigate(`/session/${session.hash}`)
    if (session.url !== null) {
      setAppPhase({ kind: "open", hash: session.hash, url: session.url })
    } else {
      // URL not yet resolved — LoadingScreen polls the events SSE until the deep link arrives
      setAppPhase({ kind: "creating", hash: session.hash })
    }
  }

  const handleResumeSession = async (session: Session) => {
    await resumeSession(session.hash)
    navigate(`/session/${session.hash}`)
    setAppPhase({ kind: "creating", hash: session.hash })
  }

  const activeHash = () => {
    const p = appPhase()
    return p.kind === "open" ? p.hash : p.kind === "creating" ? p.hash : undefined
  }

  const goHome = () => {
    navigate("/")
    setAppPhase({ kind: "ready" })
    setActiveTab("git")
    setTimeout(() => promptRef?.focus(), 50)
  }

  return (
    <div class="flex h-dvh overflow-hidden" style={{ background: "var(--background-base)" }}>
      {/* Sidebar: only on desktop, only when session is open/creating */}
      <div class="hidden md:contents">
        <Show when={appPhase().kind === "open" || appPhase().kind === "creating"}>
          <SessionSidebar
            collapsed={sidebarCollapsed()}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            sessions={sessions()}
            email={email()}
            activeHash={activeHash()}
            onNewSession={goHome}
            onOpenSession={handleOpenSession}
            onResumeSession={handleResumeSession}
            onTerminateSession={handleTerminateSession}
          />
        </Show>
      </div>

      <main class="flex flex-col flex-1 overflow-hidden">
        <Switch>
          <Match when={appPhase().kind === "loading"}>
            <div class="flex flex-1 items-center justify-center">
              <p class="text-12-regular" style={{ color: "var(--text-dimmed-base)" }}>
                {t("app.loading")}
              </p>
            </div>
          </Match>

          <Match when={appPhase().kind === "ready"}>
            <div class="flex flex-1 flex-col items-center overflow-y-auto px-4 pt-12 pb-8 gap-6">
              <div class="w-full max-w-2xl flex flex-col gap-6">
                {/* Welcome heading with settings button */}
                <div class="flex items-center justify-center gap-2">
                  <h1 class="text-18-medium text-center" style={{ color: "var(--text-base)" }}>
                    {t("app.welcomeBack", { email: email() || "—" })}
                  </h1>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={handleOpenSettings}
                    title={t("settings.title")}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
                      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
                    </svg>
                  </Button>
                </div>

                {/* New session form */}
                <SessionInputBar
                  activeTab={activeTab()}
                  onTabChange={setActiveTab}
                  repoUrl={repoUrl()}
                  onRepoUrlChange={handleRepoUrlChange}
                  sourceBranch={sourceBranch()}
                  onSourceBranchChange={setSourceBranch}
                  sessionBranch={sessionBranch()}
                  promptText={promptText()}
                  onPromptTextChange={setPromptText}
                  formError={formError()}
                  submitting={submitting()}
                  onSubmit={handleSubmit}
                  ref={(el) => {
                    promptRef = el
                  }}
                />

                {/* Session list: always visible on all screen sizes */}
                <SessionList
                  sessions={sessions()}
                  onOpenSession={handleOpenSession}
                  onResumeSession={handleResumeSession}
                  onTerminateSession={handleTerminateSession}
                />

                {/* Build version */}
                <p class="text-center" style={{ color: "var(--text-dimmed-base)", "font-size": "11px" }}>
                  {import.meta.env.VITE_APP_VERSION || "dev"}
                </p>
              </div>
            </div>
          </Match>

          <Match when={appPhase().kind === "creating" && (appPhase() as Extract<AppPhase, { kind: "creating" }>)}>
            {(p) => (
              <div class="flex flex-1 items-center justify-center">
                <LoadingScreen
                  hash={p().hash}
                  onReady={(url) => {
                    setAppPhase({ kind: "open", hash: p().hash, url })
                  }}
                  onError={(message) => {
                    setAppPhase({ kind: "error", message })
                  }}
                />
              </div>
            )}
          </Match>

          <Match when={appPhase().kind === "open" && (appPhase() as Extract<AppPhase, { kind: "open" }>)}>
            {(p) => (
              <iframe
                src={p().url}
                class="flex-1 w-full border-0"
                style={{ height: "100%" }}
                title="opencode session"
              />
            )}
          </Match>

          <Match when={appPhase().kind === "error" && (appPhase() as Extract<AppPhase, { kind: "error" }>)}>
            {(p) => (
              <div class="flex flex-1 items-center justify-center p-6">
                <p class="text-14-medium" style={{ color: "var(--text-danger-base, #ef4444)" }}>
                  {p().message}
                </p>
              </div>
            )}
          </Match>
        </Switch>
      </main>
    </div>
  )
}
