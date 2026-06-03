import { ComponentProps } from "solid-js"

export function Spinner(props: {
  class?: string
  classList?: ComponentProps<"div">["classList"]
  style?: ComponentProps<"div">["style"]
}) {
  return (
    <svg
      {...props}
      viewBox="0 0 15 15"
      data-component="spinner"
      classList={{
        ...props.classList,
        [props.class ?? ""]: !!props.class,
      }}
      fill="currentColor"
    >
      <rect x="0" y="0" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0s"/>
      </rect>
      <rect x="4" y="0" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.1s"/>
      </rect>
      <rect x="8" y="0" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.2s"/>
      </rect>
      <rect x="12" y="0" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.3s"/>
      </rect>
      <rect x="0" y="4" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.4s"/>
      </rect>
      <rect x="4" y="4" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.5s"/>
      </rect>
      <rect x="8" y="4" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.6s"/>
      </rect>
      <rect x="12" y="4" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.7s"/>
      </rect>
      <rect x="0" y="8" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.8s"/>
      </rect>
      <rect x="4" y="8" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.9s"/>
      </rect>
      <rect x="8" y="8" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="1.0s"/>
      </rect>
      <rect x="12" y="8" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="1.1s"/>
      </rect>
      <rect x="0" y="12" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="1.2s"/>
      </rect>
      <rect x="4" y="12" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="1.3s"/>
      </rect>
      <rect x="8" y="12" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="1.4s"/>
      </rect>
      <rect x="12" y="12" width="3" height="3" rx="1" opacity="0">
        <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="1.5s"/>
      </rect>
    </svg>
  )
}
