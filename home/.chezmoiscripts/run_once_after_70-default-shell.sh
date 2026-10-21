#!/bin/bash
# Makes zsh the login shell
set -euo pipefail

zsh_path="$(command -v zsh)"
if [[ "$(getent passwd "$USER" | cut -d: -f7)" != "$zsh_path" ]]; then
  echo "==> Setting login shell to zsh (takes effect at next login)"
  sudo chsh -s "$zsh_path" "$USER"
fi
