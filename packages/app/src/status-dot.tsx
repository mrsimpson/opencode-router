import { Spinner } from "./ui/spinner"
import type { Session } from "./api"

export function StatusDot(props: { state: Session["state"] }) {
  if (props.state === "creating") return <Spinner class="size-3" style={{ color: "var(--icon-base)" }} />
  return (
    <span
      class="size-2 rounded-full shrink-0 inline-block"
      style={{
        background: props.state === "running" ? "var(--surface-success-strong)" : "var(--icon-base)",
      }}
    />
  )
}
