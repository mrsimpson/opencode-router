import { type ComponentProps, Show, splitProps } from "solid-js"

export interface TextFieldProps extends ComponentProps<"input"> {
  label?: string
  description?: string
  error?: string
  variant?: "normal" | "ghost"
}

export function TextField(props: TextFieldProps) {
  const [local, rest] = splitProps(props, [
    "label",
    "description",
    "error",
    "variant",
    "class",
    "classList",
  ])
  return (
    <div
      data-component="text-field"
      data-variant={local.variant || "normal"}
      class={local.class}
      classList={local.classList}
    >
      <Show when={local.label}>
        <label data-slot="text-field-label">{local.label}</label>
      </Show>
      <div data-slot="text-field-input-wrapper">
        <input {...rest} data-slot="text-field-input" />
      </div>
      <Show when={local.description}>
        <p data-slot="text-field-description">{local.description}</p>
      </Show>
      <Show when={local.error}>
        <p data-slot="text-field-error">{local.error}</p>
      </Show>
    </div>
  )
}
