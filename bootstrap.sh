#!/bin/bash
# Fresh-machine setup. On a new Fedora (or Ubuntu/WSL) install, open a terminal and run:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/KMayne/linux-config/main/bootstrap.sh)
#
# Installs chezmoi, clones this repo to ~/Repos/config, then installs packages,
# toolchains and dotfiles. Safe to rerun.
set -euo pipefail

REPO="https://github.com/KMayne/linux-config.git"
SRC="$HOME/Repos/config"
# Set BRANCH to try another branch; any arguments are passed to `chezmoi init`
BRANCH="${BRANCH:-main}"
export PATH="$HOME/.local/bin:$PATH"

# Ask for the sudo password once, up front
sudo -v

if ! command -v chezmoi >/dev/null; then
  echo "==> Installing chezmoi"
  if command -v dnf >/dev/null; then
    sudo dnf install -y chezmoi git
  else
    sudo apt-get update && sudo apt-get install -y git curl
    sh -c "$(curl -fsSL https://get.chezmoi.io)" -- -b "$HOME/.local/bin"
  fi
fi

if chezmoi source-path >/dev/null 2>&1 && [[ -d "$(chezmoi source-path)" ]]; then
  chezmoi update
else
  if [[ ! -d "$SRC/.git" ]]; then
    echo "==> Cloning $REPO to $SRC"
    # HTTPS needs no SSH key; run_after_90-ssh-origin switches to SSH once one works
    git clone --branch "$BRANCH" "$REPO" "$SRC"
  fi
  chezmoi init --apply --source "$SRC" "$@"
fi

echo
echo "Done. Log out and back in if your login shell changed to zsh."
