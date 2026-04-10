#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <target-branch>" >&2
  exit 1
fi

target_branch="$1"

for attempt in 1 2 3; do
  if git push origin HEAD:"$target_branch"; then
    exit 0
  fi

  if [[ "$attempt" -eq 3 ]]; then
    echo "Failed to push HEAD to $target_branch after $attempt attempts." >&2
    exit 1
  fi

  git fetch origin "$target_branch"
  git rebase "origin/$target_branch"
done