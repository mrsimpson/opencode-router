export const dict = {
  "app.loading": "Loading...",
  "app.error.connect": "Failed to connect",
  "app.error.timeout": "Request timed out — the router may not be reachable",

  "session.idle.stopsIn": "stops in ~{{minutes}}m",
  "session.idle.stoppedOn": "stopped on {{date}}",
  "session.idle.stoppingSoon": "stopping soon",

  "session.action.cancel": "Cancel",
  "session.action.attach": "Attach ⌘",
  "session.action.attachCopied": "Copied to clipboard",
  "session.action.editor": "Open Editor",
  "session.action.terminate": "Terminate",
  "session.action.terminating": "Terminating…",
  "session.terminate.title": "Terminate session?",
  "session.terminate.description": '"{{repo}}" will be permanently deleted — all uncommitted work will be lost.',

  "form.tab.git": "Git Repository",
  "form.tab.newProject": "New Project",

  "form.submit": "Start Session",
  "form.submitting": "Starting...",
  "form.error.sessionBranch": "Session branch could not be generated — please try again",
  "form.error.sessionBranch.waiting": "Waiting for session branch…",
  "form.error.prompt.required": "Describe your task to continue",
  "form.error.repoUrl.required": "Repository URL is required",
  "form.error.repoUrl.invalid": "Enter a valid HTTP(S) repository URL",
  "form.error.sourceBranch.required": "Source branch is required",

  "loading.title": "Starting your OpenCode session...",
  "loading.subtitle": "Initializing session...",

  "loading.stage.initializing": "Initializing",
  "loading.stage.configuring": "Configuring environment",
  "loading.stage.preparing": "Preparing repository",
  "loading.stage.starting": "Starting OpenCode server",
  "loading.stage.readying": "Connecting session",

  "app.welcomeBack": "Welcome back, {{email}}",
  "app.sessions": "Sessions",
  "app.recents": "Recents",
  "app.newSession": "New Session",
  "app.newSession.repoUrl.placeholder": "https://github.com/org/repo.git",
  "app.newSession.sourceBranch.placeholder": "main",
  "app.newSession.prompt.placeholder": "Describe a task or ask a question",
  "sidebar.collapse": "Collapse sidebar",
  "sidebar.expand": "Expand sidebar",
  "sidebar.home": "Home",

  "session.group.current": "Current",
  "session.group.active": "Active",
  "session.group.stopped": "Stopped",
  "session.meta.started": "started {{date}}",
  "session.meta.stopped": "stopped {{date}}",
  "session.meta.created": "Created {{date}} · {{idle}}",
  "session.messages.count": "{{count}} messages",

  "autocomplete.loading": "Loading…",

  "settings.title": "Settings",
  "settings.apiKeys": "Environment Variables",
  "settings.apiKeys.description":
    "Set environment variables (e.g., API keys) that will be automatically injected into all your sessions.",
  "settings.apiKeys.current": "Current",
  "settings.apiKeys.set": "Add",
  "settings.apiKeys.add": "Add",
  "settings.apiKeys.update": "Update",
  "settings.apiKeys.delete": "Delete",
  "settings.apiKeys.deleteAll": "Delete All",
  "settings.apiKeys.placeholder": "API key value",
  "settings.apiKeys.saved": "Saved",
  "settings.apiKeys.deleted": "Deleted",
  "settings.apiKeys.error.save": "Failed to save",
  "settings.apiKeys.error.delete": "Failed to delete",
  "settings.apiKeys.none": "No environment variables set",
} as const

export type DictKey = keyof typeof dict
