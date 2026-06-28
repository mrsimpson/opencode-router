#!/bin/sh
if [ -n "$OPENCODE_MODEL_THINKING$OPENCODE_MODEL_CODING$OPENCODE_MODEL_RESEARCH" ]; then
  cd /workspace
  # Build argv with set -- / "$@" instead of string concatenation: model IDs
  # may contain spaces. Naive concatenation would re-split on IFS when the
  # shell expands the variable, turning "claude sonnet" into two arguments.
  # set -- accumulates positional parameters without word-splitting.
  set --
  [ -n "$OPENCODE_MODEL_THINKING" ] && set -- "$@" --model-thinking "$OPENCODE_MODEL_THINKING"
  [ -n "$OPENCODE_MODEL_CODING" ]  && set -- "$@" --model-coding "$OPENCODE_MODEL_CODING"
  [ -n "$OPENCODE_MODEL_RESEARCH" ] && set -- "$@" --model-research "$OPENCODE_MODEL_RESEARCH"
  echo "opencode-init: configuring capabilities (thinking=${OPENCODE_MODEL_THINKING}, coding=${OPENCODE_MODEL_CODING}, research=${OPENCODE_MODEL_RESEARCH})" >&2
  # Use if/else rather than || so we can capture rc=$? in the failure branch.
  # With || the exit code is already consumed by the time the RHS runs.
  if npx -y @codemcp/workflows setup capabilities opencode "$@" --force; then
    echo "opencode-init: capability setup complete" >&2
  else
    rc=$?
    echo "opencode-init: capability setup FAILED (exit=$rc); opencode will still start, but the LLM will not receive a capability hint" >&2
  fi
  # Leave /workspace so the remainder of the init script is not affected by a
  # stale working directory (subsequent phases cd to their own paths).
  cd /
fi
