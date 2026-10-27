# linked/

Files that apps rewrite themselves. chezmoi symlinks them into place (see the
`symlink_*.tmpl` entries under `home/`), so changes made in the app land here and
show up in `git diff`, ready to commit. Nothing to `chezmoi re-add`.
