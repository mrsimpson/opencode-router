import {
  createContext,
  createSignal,
  useContext,
  type JSX,
  type ParentProps,
  Show,
} from "solid-js"

const Context = createContext<{
  show: (render: () => JSX.Element, onClose?: () => void) => void
  close: () => void
}>()

type DialogSlot = {
  id: string
  render: () => JSX.Element
  onClose?: () => void
}

let idCounter = 0

export function DialogProvider(props: ParentProps) {
  const [active, setActive] = createSignal<DialogSlot | undefined>()

  const show = (render: () => JSX.Element, onClose?: () => void) => {
    const id = String(++idCounter)
    setActive({ id, render, onClose })
  }

  const close = () => {
    const current = active()
    if (current?.onClose) current.onClose()
    setActive(undefined)
  }

  return (
    <Context.Provider value={{ show, close }}>
      {props.children}
      <Show when={active()}>
        {(slot) => slot().render()}
      </Show>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  if (!ctx) throw new Error("useDialog must be used within DialogProvider")
  return ctx
}
