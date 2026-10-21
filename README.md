# linux-config

Dotfiles and machine setup, managed with [chezmoi](https://www.chezmoi.io). Works on Fedora (including KDE and Asahi) and Ubuntu/WSL.

## New machine

1. Install Fedora.
2. Open a terminal and run:

   ```sh
   bash <(curl -fsSL https://raw.githubusercontent.com/KMayne/linux-config/main/bootstrap.sh)
   ```

3. Log out and back in if your login shell changed to zsh.

To keep the repo somewhere else (e.g. `~/Repos/config`), clone it there and run
`chezmoi init --source ~/Repos/config --apply` instead; the location is remembered.

## Day to day

| To… | Run |
| --- | --- |
| Change a dotfile | `chezmoi edit ~/.zshrc` (applies on save), or the `virc` / `vialias` aliases |
| Add a package | Edit `home/.chezmoidata/packages.yaml`, then `chezmoi apply` |
| Add a toolchain | `mise use -g go@latest`, then `chezmoi re-add ~/.config/mise/config.toml` |
| Pull changes from another machine | `chezmoi update` |
| See what would change | `chezmoi diff` |
| Commit and push | `chezmoi cd`, then git as normal |

Install scripts only rerun when their package list changes, so `chezmoi apply` is cheap.

## Layout

- `bootstrap.sh`: installs chezmoi and applies this repo.
- `home/`: the chezmoi source (`.chezmoiroot` points here). `dot_zshrc.tmpl` becomes `~/.zshrc`, and so on.
- `home/.chezmoidata/packages.yaml`: dnf, COPR and Flatpak package lists.
- `home/.chezmoiscripts/`: install scripts (repos, dnf packages, Flatpaks, mise toolchains, wakatime-cli, login shell).
- `home/.chezmoiexternal.toml`: Oh My Zsh, zsh plugins and vim plugins, refreshed weekly.
- `home/dot_config/mise/config.toml`: language toolchains (node, go, rust, kubectl).

## Per-machine differences

`chezmoi init` detects `wsl`, `kde` and `distro` and stores them in `~/.config/chezmoi/chezmoi.toml`; templates branch on them (replacing the old `wsl` branch). Machine-only shell config goes in `~/.zsh_custom` and git config in `~/.gitconfig-local`; neither is managed.
