#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Save old configuration
mkdir .old-config
mv .zshrc .old-config 2&>/dev/null
mv .vim .old-config 2&>/dev/null
mv .vimrc .old-config 2&>/dev/null
mv .ssh/config .old-config 2&>/dev/null
mv .tmux.conf .old-config 2&>/dev/null
mv .gitconfig .old-config 2&>/dev/null

# Create symlinks for new config
ln -s $DIR/zshrc ~/.zshrc
ln -s -d $DIR/vim ~/.vim
ln -s $DIR/vim/vimrc ~/.vimrc
ln -s $DIR/ssh_config ~/.ssh/config
ln -s $DIR/tmux.conf ~/.tmux.conf
ln -s $DIR/gitconfig ~/.gitconfig
