# Path to your oh-my-zsh installation.
export ZSH=$HOME/.oh-my-zsh

# Set name of the theme to load. Optionally, if you set this to "random"
# it'll load a random theme each time that oh-my-zsh is loaded.
# See https://github.com/robbyrussell/oh-my-zsh/wiki/Themes
ZSH_THEME="agnoster"

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion. Case
# sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to change how often to auto-update (in days).
export UPDATE_ZSH_DAYS=7

# Uncomment the following line to enable command auto-correction.
ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# The optional three formats: "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
HIST_STAMPS="yyyy-mm-dd"

# Would you like to use another custom folder than $ZSH/custom?
ZSH_CUSTOM=~/Repos/config/OMZ-Custom

# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(git kubectl pj colored-man-pages command-not-found wakatime history zsh-prompt-benchmark zsh-syntax-highlighting)

PROJECT_PATHS=(~/Repos)

source $ZSH/oh-my-zsh.sh

unsetopt AUTO_CD
unsetopt SHARE_HISTORY
setopt INC_APPEND_HISTORY_TIME

# User configuration
# You may need to manually set your language environment
export LANG=en_GB.UTF-8

# Hide user
export DEFAULT_USER='kian'

# Include custom aliases
source $ZSH_CUSTOM/zsh_aliases

# Set Vim as the editor
export EDITOR=vim

# Set up node as development
export NODE_ENV=development
#
# Include local binaries + global npm binaries in path + Snaps
export PATH=~/.local/bin:~/.npm/bin:/$PATH:/snap/bin

# Add device-specific config
source ~/.zsh_custom

source $ZSH_CUSTOM/bashmarks.sh
source $ZSH_CUSTOM/mouse.zsh
source $ZSH_CUSTOM/paste-perf-fix.zsh
bindkey -M emacs '\em' zle-toggle-mouse

source $HOME/.cargo/env

# Add time + last elapsed time to prompt
function preexec() {
  timer=$SECONDS
}

function precmd() {
  if [ $timer ]; then
    now=$SECONDS
    elapsed=$(($now-$timer))

    export RPROMPT="%F{cyan}${elapsed}s %{$reset_color%} [%D{%H:%M:%S}]"
    unset timer
  else
    RPROMPT="[%D{%H:%M:%S}]"
  fi
}

