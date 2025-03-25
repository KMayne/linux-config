#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Save old configuration
mv ~/.old-config ~/.old-config-tmp 2>/dev/null
mkdir ~/.old-config
mv ~/.old-config-tmp ~/.old-config/ 2>/dev/null
mv ~/.zshrc ~/.old-config 2>/dev/null
mv ~/.vim ~/.old-config 2>/dev/null
mv ~/.vimrc ~/.old-config 2>/dev/null
mv ~/.ssh/config ~/.old-config 2>/dev/null
mv ~/.tmux.conf ~/.old-config 2>/dev/null
mv ~/.gitconfig ~/.old-config 2>/dev/null
mv ~/.npmrc ~/.old-config 2>/dev/null

# Create symlinks for new config
ln -s $DIR/zshrc ~/.zshrc
ln -s $DIR/vim ~/.vim
ln -s $DIR/vim/vimrc ~/.vimrc
mkdir ~/.ssh 2>/dev/null
ln -s $DIR/ssh_config ~/.ssh/config
ln -s $DIR/tmux.conf ~/.tmux.conf
ln -s $DIR/gitconfig ~/.gitconfig
ln -s $DIR/npmrc ~/.npmrc
mkdir -p ~/.local/bin
ln -s $DIR/wsl-git ~/.local/bin/git

# Install Vim plugins
vim +PluginInstall +qall

# Set up $CONFIG and create ~/.zsh_custom file
echo "export CONFIG='$DIR'" >> ~/.zsh_custom

# Create local gitconfig to include
touch ~/.gitconfig-local
mkdir -p ~/.cargo
touch ~/.cargo/env

