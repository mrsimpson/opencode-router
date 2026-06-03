import { splitProps, type ComponentProps } from "solid-js"

const icons: Record<string, string> = {
  trash: `<path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="square" fill="none"/>`,
  close: `<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="square"/>`,
  "arrow-up": `<path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="square" fill="none"/>`,
  "arrow-left": `<path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="square" fill="none"/>`,
}

export interface IconProps extends Omit<ComponentProps<"svg">, "innerHTML"> {
  name: keyof typeof icons
  size?: "small" | "normal" | "large"
}

export function Icon(props: IconProps) {
  const [local, rest] = splitProps(props, ["name", "size", "class"])
  const size = local.size === "small" ? 16 : local.size === "large" ? 24 : 20
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      data-component="icon"
      class={local.class}
      {...rest}
      innerHTML={icons[local.name]}
    />
  )
}
