import { Match, Show, Switch, createSignal, onMount } from "solid-js"
import { useI18n } from "./ui/context"
import { Button } from "./ui/button"
import { useT } from "./i18n"
import { GIT_URL_PATTERN } from "./setup-form-utils"
import { Autocomplete } from "./autocomplete"
import type { Repo } from "./api"

type Props = {
  activeTab: "git" | "new-project"
  onTabChange: (tab: "git" | "new-project") => void
  repoUrl: string
  onRepoUrlChange: (v: string) => void
  sourceBranch: string
  onSourceBranchChange: (v: string) => void
  sessionBranch: string
  promptText: string
  onPromptTextChange: (v: string) => void
  formError: string
  submitting: boolean
  onSubmit: () => void
  ref?: (el: HTMLTextAreaElement) => void
}

import type { DictKey } from "./i18n/en"

// Load user repos on mount (lazy loaded)
let userRepos: Repo[] = []
let reposLoaded = false
async function loadUserRepos(): Promise<Repo[]> {
  if (reposLoaded) return userRepos
  try {
    const { listUserRepos } = await import("./api")
    userRepos = await listUserRepos()
    reposLoaded = true
  } catch {
    userRepos = []
  }
  return userRepos
}

function findRepoByUrl(url: string): Repo | undefined {
  return userRepos.find((r) => r.url === url)
}

function disabledReason(props: Props, t: (key: DictKey) => string): string | null {
  if (props.activeTab === "git") {
    if (!GIT_URL_PATTERN.test(props.repoUrl.trim())) return t("form.error.repoUrl.invalid")
    if (!props.sourceBranch.trim()) return t("form.error.sourceBranch.required")
    if (!props.sessionBranch.trim()) return t("form.error.sessionBranch.waiting")
  }
  if (!props.promptText.trim()) return t("form.error.prompt.required")
  return null
}

const inputStyle = {
  background: "var(--background-base)",
  border: "1px solid var(--border-base)",
  color: "var(--text-base)",
  "border-radius": "6px",
  padding: "8px 10px",
  "font-size": "13px",
  outline: "none",
  width: "100%",
}

const tabBase: Record<string, string> = {
  padding: "6px 16px",
  "font-size": "13px",
  border: "none",
  cursor: "pointer",
  background: "transparent",
  color: "var(--text-dimmed-base)",
  "border-radius": "6px",
  transition: "all 0.15s ease",
}

export function SessionInputBar(props: Props) {
  const t = useT(useI18n())
  const [repoItems, setRepoItems] = createSignal<{ label: string; value: string }[]>([])
  const [branchItems, setBranchItems] = createSignal<{ label: string; value: string }[]>([])
  const [reposLoading, setReposLoading] = createSignal(false)

  // Load repos on first focus
  const ensureReposLoaded = async () => {
    if (repoItems().length > 0 || reposLoading()) return
    setReposLoading(true)
    const repos = await loadUserRepos()
    setRepoItems(repos.map((r) => ({ label: r.name, value: r.url })))
    setReposLoading(false)
  }

  // Load branches when repo is selected and set default branch
  const loadBranchesForRepo = async (url: string) => {
    const repo = findRepoByUrl(url)
    const newBranch = repo?.defaultBranch
    if (newBranch) props.onSourceBranchChange(newBranch)

    try {
      const { listRepoBranches } = await import("./api")
      const repoFullName = url.replace(/^https?:\/\//, "").replace(/\.git$/, "")
      const repoParts = repoFullName.split("/")
      if (repoParts.length >= 2) {
        const branches = await listRepoBranches(`${repoParts[repoParts.length - 2]}/${repoParts[repoParts.length - 1]}`)
        setBranchItems(branches.map((b) => ({ label: b.name, value: b.name })))
      }
    } catch {
      setBranchItems([])
    }
  }

  onMount(() => {
    // Pre-load repos in background when component mounts
    ensureReposLoaded()
  })

  const canSubmit = () => {
    if (props.submitting) return false
    if (props.activeTab === "git") {
      return (
        GIT_URL_PATTERN.test(props.repoUrl.trim()) &&
        props.sourceBranch.trim().length > 0 &&
        props.sessionBranch.trim().length > 0 &&
        props.promptText.trim().length > 0
      )
    }
    return props.promptText.trim().length > 0
  }

  const errorMessage = () => props.formError || disabledReason(props, t)

  return (
    <div
      class="rounded-xl border p-4"
      style={{ background: "var(--background-surface)", "border-color": "var(--border-base)" }}
    >
      <form
        class="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          props.onSubmit()
        }}
      >
        {/* Segmented tab bar */}
        <div class="flex gap-1 p-1 rounded-lg" style={{ background: "var(--background-base)" }}>
          <button
            type="button"
            onClick={() => props.onTabChange("git")}
            style={{
              ...tabBase,
              background: props.activeTab === "git" ? "var(--background-surface)" : "transparent",
              color: props.activeTab === "git" ? "var(--text-base)" : "var(--text-dimmed-base)",
              "font-weight": props.activeTab === "git" ? "500" : "400",
            }}
          >
            {t("form.tab.git")}
          </button>
          <button
            type="button"
            onClick={() => props.onTabChange("new-project")}
            style={{
              ...tabBase,
              background: props.activeTab === "new-project" ? "var(--background-surface)" : "transparent",
              color: props.activeTab === "new-project" ? "var(--text-base)" : "var(--text-dimmed-base)",
              "font-weight": props.activeTab === "new-project" ? "500" : "400",
            }}
          >
            {t("form.tab.newProject")}
          </button>
        </div>

        {/* Git tab fields: repo URL + branch autocompletes */}
        <Show when={props.activeTab === "git"}>
          <div class="flex gap-2 flex-wrap">
            <Autocomplete
              placeholder={t("app.newSession.repoUrl.placeholder")}
              value={props.repoUrl}
              onSelect={(v) => {
                props.onRepoUrlChange(v)
                loadBranchesForRepo(v)
              }}
              items={repoItems()}
              loading={reposLoading()}
            />
            <Autocomplete
              placeholder={t("app.newSession.sourceBranch.placeholder")}
              value={props.sourceBranch}
              onSelect={props.onSourceBranchChange}
              items={branchItems()}
            />
          </div>
          {/* Auto-created branch name intentionally hidden */}
          {/* <Show when={props.sessionBranch}>...</Show> */}
        </Show>

        <textarea
          ref={props.ref}
          autofocus
          placeholder={t("app.newSession.prompt.placeholder")}
          value={props.promptText}
          onInput={(e) => props.onPromptTextChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              props.onSubmit()
            }
          }}
          required
          rows={3}
          style={{
            ...inputStyle,
            resize: "none",
            "font-family": "inherit",
          }}
        />

        <div class="flex items-center" style={{ "min-height": "32px" }}>
          <Show
            when={errorMessage()}
            fallback={
              <Button type="submit" icon="arrow-up" variant="primary" disabled={!canSubmit()} class="w-full">
                {props.submitting ? t("form.submitting") : t("form.submit")}
              </Button>
            }
          >
            {(msg) => (
              <p
                style={{
                  color: "var(--text-on-critical-base)",
                  "font-family": "var(--font-family-sans)",
                  "font-size": "var(--font-size-small)",
                  "font-weight": "var(--font-weight-medium)",
                  "line-height": "18px",
                }}
              >
                {msg()}
              </p>
            )}
          </Show>
        </div>
      </form>
    </div>
  )
}
