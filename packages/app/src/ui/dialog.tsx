import { type ComponentProps, type JSXElement, type ParentProps, Show, onMount } from "solid-js"
import { Portal } from "solid-js/web"

export interface DialogProps extends ParentProps {
  title?: JSXElement
  description?: JSXElement
  action?: JSXElement
  size?: "normal" | "large" | "x-large"
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  fit?: boolean
  transition?: boolean
  /** Called when the dialog requests close (close button, overlay click, Escape key). */
  onClose?: () => void
}

export function Dialog(props: DialogProps) {
  let dialogRef: HTMLDialogElement | undefined

  onMount(() => {
    dialogRef?.showModal()
  })

  const handleCancel = (e: Event) => {
    e.preventDefault()
    props.onClose?.()
  }

  return (
    <Portal>
      <dialog
        ref={dialogRef}
        data-component="dialog"
        data-fit={props.fit ? true : undefined}
        data-size={props.size || "normal"}
        data-transition={props.transition ? true : undefined}
        onCancel={handleCancel}
        style={{
          border: "none",
          padding: "0",
          background: "transparent",
          "max-width": "none",
          "max-height": "none",
          overflow: "visible",
          /* Override browser default dialog positioning — fill viewport and flex-center content */
          position: "fixed",
          inset: "0",
          width: "100vw",
          height: "100vh",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          margin: "0",
        }}
      >
        {/* Dim overlay — clicking it closes the dialog */}
        <div
          data-slot="dialog-overlay"
          style={{
            position: "fixed",
            inset: "0",
            "z-index": "50",
            "background-color": "hsl(from var(--background-base) h s l / 0.2)",
            "pointer-events": "auto",
            cursor: "default",
          }}
          onClick={() => props.onClose?.()}
        />
        <div data-slot="dialog-container">
          <div
            data-slot="dialog-content"
            data-no-header={!props.title && !props.action ? "" : undefined}
            classList={{
              ...props.classList,
              [props.class ?? ""]: !!props.class,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Show when={props.title}>
              <div data-slot="dialog-header">
                <span data-slot="dialog-title">{props.title}</span>
                <button
                  aria-label="Close"
                  data-component="icon-button"
                  data-size="small"
                  data-variant="ghost"
                  onClick={() => props.onClose?.()}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--icon-base)",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    width: "24px",
                    height: "24px",
                    "border-radius": "4px",
                    padding: "0",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="square"/>
                  </svg>
                </button>
              </div>
            </Show>
            <Show when={props.description}>
              <div data-slot="dialog-description">{props.description}</div>
            </Show>
            <div data-slot="dialog-body">{props.children}</div>
            <Show when={props.action}>
              <div data-slot="dialog-footer">{props.action}</div>
            </Show>
          </div>
        </div>
      </dialog>
    </Portal>
  )
}
