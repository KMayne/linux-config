precmd() {
  printf "\e]9;9;%s\e\\" $(wslpath -m "$PWD")
}
