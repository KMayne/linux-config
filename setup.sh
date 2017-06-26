DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

ln -s $DIR/zshrc ~/.zshrc

ln -s -d $DIR/vim ~/.vim
ln -s $DIR/vim/vimrc ~/.vimrc

ln -s $DIR/ssh_config ~/.ssh/config

ln -s $DIR/tmux.conf ~/.tmux.conf

ln -s $DIR/gitconfig ~/.gitconfig
