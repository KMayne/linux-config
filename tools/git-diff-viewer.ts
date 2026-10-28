// GitHub-style "Files changed" page for any git diff, with per-file Viewed marks.
//
//   git diff-viewer [git diff args...]            # nothing = working tree, or --cached, a..b, a...b
//   git diff-viewer --stack feat/a feat/b feat/c  # one tab per consecutive pair
//   git diff-viewer --title "Search PR" --no-open
//
// Writes /tmp/diff-viewer/<repo>-<range>.html and opens it in the browser. Viewed marks live in the
// browser's localStorage, keyed by file path and a hash of its hunks, so a rerun after a rebase
// un-views only the files that changed. Runs on Node 24 directly (type stripping), no build step.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT_DIR = '/tmp/diff-viewer';

type LineKind = 'add' | 'del' | 'ctx' | 'meta';
type DiffLine = { kind: LineKind; old: number | null; new: number | null; text: string };
type Hunk = { header: string; lines: Array<DiffLine> };
type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';
type DiffFile = {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  adds: number;
  dels: number;
  hunks: Array<Hunk>;
  hash: string;
  /** Full new content for Markdown files, so the page can render a preview. */
  preview: string | null;
};
type Tab = { label: string; files: Array<DiffFile> };
type PreviewSource = { kind: 'rev'; rev: string } | { kind: 'index' } | { kind: 'worktree' };

function main(argv: Array<string>): number {
  const args = [...argv];
  const title = popOption(args, '--title');
  const noOpen = popFlag(args, '--no-open');
  if (popFlag(args, '--self-test')) {
    return selfTest();
  }

  const repo = gitRoot();
  const repoName = basename(repo);
  let tabs: Array<Tab>;
  let slug: string;
  if (popFlag(args, '--stack')) {
    if (args.length < 2) {
      fail('--stack needs at least two refs');
    }
    tabs = args.slice(1).map((head, i) => diffTab(repo, [args[i], head], `${args[i]} → ${head}`));
    slug = `stack-${args.join('-')}`;
  } else {
    tabs = [diffTab(repo, args, args.join(' ') || 'working tree')];
    slug = args.join('-') || 'worktree';
  }

  const pageTitle = title ?? `${repoName}: ${tabs.length === 1 ? tabs[0].label : 'stack'}`;
  const out = join(OUT_DIR, `${repoName}-${slug.replace(/[^A-Za-z0-9._-]+/g, '_')}.html`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(out, renderPage(pageTitle, repoName, tabs));
  console.log(out);
  if (!noOpen) {
    openInBrowser(out);
  }
  return 0;
}

function diffTab(repo: string, diffArgs: Array<string>, label: string): Tab {
  const result = spawnSync('git', ['diff', '--no-color', '--find-renames', '--no-ext-diff', ...diffArgs], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(result.stderr.trim() || 'git diff failed');
  }
  const files = parseDiff(result.stdout);
  const source = previewSource(diffArgs);
  for (const file of files) {
    if (/\.(md|markdown)$/i.test(file.path) && file.status !== 'deleted') {
      file.preview = readNewContent(repo, source, file.path);
    }
  }
  return { label, files };
}

// Which version of a file the "new" side of this diff shows: a rev, the index, or the working tree.
function previewSource(diffArgs: Array<string>): PreviewSource {
  const separator = diffArgs.indexOf('--');
  const revs = (separator === -1 ? diffArgs : diffArgs.slice(0, separator)).filter(arg => !arg.startsWith('-'));
  if (revs.length >= 2) {
    return { kind: 'rev', rev: revs[revs.length - 1] };
  }
  if (revs.length === 1 && revs[0].includes('..')) {
    const head = revs[0].slice(revs[0].lastIndexOf('.') + 1);
    return head ? { kind: 'rev', rev: head } : { kind: 'worktree' };
  }
  return diffArgs.includes('--cached') || diffArgs.includes('--staged') ? { kind: 'index' } : { kind: 'worktree' };
}

function readNewContent(repo: string, source: PreviewSource, path: string): string | null {
  if (source.kind === 'worktree') {
    try {
      return readFileSync(join(repo, path), 'utf8');
    } catch {
      return null;
    }
  }
  const spec = source.kind === 'index' ? `:${path}` : `${source.rev}:${path}`;
  const result = spawnSync('git', ['show', spec], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}

// ---------------------------------------------------------------------------
// Unified diff parser

export function parseDiff(text: string): Array<DiffFile> {
  const files: Array<DiffFile> = [];
  let current: DiffFile | undefined;
  let hunk: Hunk | undefined;
  let oldNo = 0;
  let newNo = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = newFile(line);
      files.push(current);
      hunk = undefined;
    } else if (current === undefined) {
      continue;
    } else if (line.startsWith('@@')) {
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldNo = Number(match?.[1] ?? 0);
      newNo = Number(match?.[2] ?? 0);
    } else if (hunk !== undefined && line.startsWith('\\')) {
      hunk.lines.push({ kind: 'meta', old: null, new: null, text: line.slice(2) });
    } else if (hunk !== undefined && (line[0] === '+' || line[0] === '-' || line[0] === ' ')) {
      const kind: LineKind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx';
      const entry: DiffLine = { kind, old: null, new: null, text: line.slice(1) };
      if (kind !== 'add') {
        entry.old = oldNo;
        oldNo += 1;
      }
      if (kind !== 'del') {
        entry.new = newNo;
        newNo += 1;
      }
      hunk.lines.push(entry);
      if (kind === 'add') {
        current.adds += 1;
      } else if (kind === 'del') {
        current.dels += 1;
      }
    } else {
      readHeaderLine(current, line);
    }
  }
  for (const file of files) {
    const hunkText = file.hunks.flatMap(h => h.lines.map(l => l.text)).join('\n');
    file.hash = createHash('sha1').update(hunkText).digest('hex').slice(0, 12);
  }
  return files;
}

function newFile(diffLine: string): DiffFile {
  const match = /^diff --git a\/(.*) b\/(.*)$/.exec(diffLine);
  const oldPath = match?.[1] ?? '';
  const path = match?.[2] ?? diffLine;
  return {
    path,
    oldPath: oldPath !== path ? oldPath : null,
    status: oldPath !== path ? 'renamed' : 'modified',
    binary: false,
    adds: 0,
    dels: 0,
    hunks: [],
    hash: '',
    preview: null,
  };
}

function readHeaderLine(file: DiffFile, line: string): void {
  if (line.startsWith('new file mode')) {
    file.status = 'added';
  } else if (line.startsWith('deleted file mode')) {
    file.status = 'deleted';
  } else if (line.startsWith('rename from ')) {
    file.oldPath = line.slice('rename from '.length);
    file.status = 'renamed';
  } else if (line.startsWith('rename to ')) {
    file.path = line.slice('rename to '.length);
  } else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
    file.binary = true;
  }
}

// ---------------------------------------------------------------------------
// Page

export function renderPage(title: string, repo: string, tabs: Array<Tab>): string {
  const data = JSON.stringify({ title, repo, tabs }).replace(/<\//g, '<\\/');
  return PAGE.replace('__TITLE__', htmlEscape(title)).replace('__DATA__', data);
}

function htmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --border: #d1d9e0; --panel: #f6f8fa;
    --accent: #0969da; --hunk: #ddf4ff; --hunk-fg: #0550ae;
    --add: #dafbe1; --add-num: #aceebb; --del: #ffebe9; --del-num: #ffcecb; --viewed: #1a7f37; --danger: #cf222e; --since: #bf8700;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Noto Sans, Helvetica, Arial, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #e6edf3; --muted: #8d96a0; --border: #30363d; --panel: #161b22;
      --accent: #4493f8; --hunk: #161b22; --hunk-fg: #79c0ff;
      --add: #12261e; --add-num: #1f4428; --del: #2d1214; --del-num: #5a1e1e; --viewed: #3fb950; --danger: #f85149; --since: #d29922;
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 var(--sans); }
  button, input { font: inherit; color: inherit; }
  .top {
    position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--border);
    padding: 10px max(16px, env(safe-area-inset-right, 0px)) 10px max(16px, env(safe-area-inset-left, 0px));
    display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
  }
  .top h1 { font-size: 16px; margin: 0; font-weight: 600; }
  .top .range { color: var(--muted); font-family: var(--mono); font-size: 12px; }
  .top .spacer { flex: 1; }
  .chip { border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; font-size: 12px; background: var(--panel); white-space: nowrap; }
  .chip.done { border-color: var(--viewed); color: var(--viewed); }
  .chip.since { border-color: var(--since); color: var(--since); }
  .since-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--since); flex: none; }
  tr.since td:first-child { box-shadow: inset 3px 0 0 var(--since); }
  .btn { border: 1px solid var(--border); background: var(--panel); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  .btn[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
  .btn:focus-visible, input:focus-visible, .file-header:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tabs { display: flex; gap: 4px; width: 100%; flex-wrap: wrap; }
  .layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; padding: 16px max(16px, env(safe-area-inset-right, 0px)) 40px max(16px, env(safe-area-inset-left, 0px)); }
  .side { position: sticky; top: calc(var(--top-h, 56px) + 16px); align-self: start; max-height: calc(100vh - var(--top-h, 56px) - 32px); overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); }
  .side ul { list-style: none; margin: 0; padding: 4px 0; }
  .side li { display: flex; align-items: center; gap: 8px; padding: 4px 10px; font-family: var(--mono); font-size: 12px; cursor: pointer; }
  .side li:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .side li .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
  .side li.viewed .name { color: var(--muted); }
  .counts { white-space: nowrap; font-size: 11px; font-variant-numeric: tabular-nums; }
  .counts .a { color: var(--viewed); } .counts .d { color: var(--danger); }
  .status { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; border-radius: 4px; padding: 1px 5px; border: 1px solid var(--border); color: var(--muted); }
  .status.added { color: var(--viewed); border-color: var(--viewed); }
  .status.deleted { color: var(--danger); border-color: var(--danger); }
  .status.renamed { color: var(--accent); border-color: var(--accent); }
  .main { min-width: 0; display: flex; flex-direction: column; gap: 16px; }
  .file { border: 1px solid var(--border); border-radius: 6px; }
  .file-header { position: sticky; top: var(--top-h, 56px); z-index: 2; border-radius: 6px 6px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--border); cursor: pointer; }
  .file.collapsed .file-header { border-bottom: 0; border-radius: 6px; }
  .body { border-radius: 0 0 6px 6px; }
  .file-header .path { font-family: var(--mono); font-size: 12px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .file-header .caret { color: var(--muted); font-size: 11px; width: 10px; }
  .file.collapsed .caret { transform: rotate(-90deg); }
  .file-header label { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
  .file.viewed .file-header { background: color-mix(in srgb, var(--viewed) 8%, var(--panel)); }
  .file.collapsed .body { display: none; }
  .body { overflow-x: auto; }
  table { border-collapse: collapse; font-family: var(--mono); font-size: 12px; line-height: 20px; width: 100%; }
  td { padding: 0; vertical-align: top; white-space: pre; }
  td.num { width: 1%; min-width: 44px; padding: 0 8px; text-align: right; color: var(--muted); user-select: none; font-variant-numeric: tabular-nums; }
  td.mark { width: 1%; padding: 0 4px; user-select: none; color: var(--muted); }
  td.code { padding-right: 16px; }
  tr.add td.code, tr.add td.mark { background: var(--add); } tr.add td.num { background: var(--add-num); }
  tr.del td.code, tr.del td.mark { background: var(--del); } tr.del td.num { background: var(--del-num); }
  td.code.add { background: var(--add); } td.num.add { background: var(--add-num); }
  td.code.del { background: var(--del); } td.num.del { background: var(--del-num); }
  td.code.empty { background: color-mix(in srgb, var(--border) 25%, transparent); }
  tr.hunk td { background: var(--hunk); color: var(--hunk-fg); padding: 2px 12px; }
  tr.meta td { color: var(--muted); font-style: italic; }
  .split td.code { width: 50%; }
  .notice { padding: 12px; color: var(--muted); font-style: italic; }
  td.num { position: relative; }
  .add-comment { position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; line-height: 14px; padding: 0; border: 0; border-radius: 3px; background: var(--accent); color: #fff; font-size: 13px; cursor: pointer; display: none; }
  tr:hover .add-comment { display: inline-block; }
  tr.comment td, tr.comment-form td { background: var(--panel); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 8px 12px; white-space: normal; font-family: var(--sans); font-size: 13px; }
  .comment-box { max-width: 72ch; }
  .comment-text { white-space: pre-wrap; }
  .comment-code { font-family: var(--mono); font-size: 12px; color: var(--muted); white-space: pre; overflow-x: auto; margin-bottom: 4px; }
  .comment-stale { color: var(--muted); font-style: italic; font-size: 12px; }
  .actions { display: flex; gap: 6px; margin-top: 6px; }
  textarea { display: block; width: 100%; max-width: 72ch; font: 13px/1.4 var(--sans); padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); resize: vertical; }
  .preview { padding: 16px 24px; max-width: 80ch; line-height: 1.6; }
  .preview h1, .preview h2, .preview h3 { margin: 1.2em 0 .5em; line-height: 1.25; }
  .preview h1 { font-size: 1.6em; border-bottom: 1px solid var(--border); padding-bottom: .3em; }
  .preview h2 { font-size: 1.3em; border-bottom: 1px solid var(--border); padding-bottom: .3em; }
  .preview pre { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 12px; overflow-x: auto; font-family: var(--mono); font-size: 12px; }
  .preview code { font-family: var(--mono); font-size: .9em; background: var(--panel); border-radius: 4px; padding: 1px 4px; }
  .preview pre code { background: none; padding: 0; }
  .preview table { width: auto; font-family: var(--sans); font-size: 13px; }
  .preview th, .preview td { border: 1px solid var(--border); padding: 4px 10px; white-space: normal; }
  .preview th { background: var(--panel); }
  .preview blockquote { margin: 0; padding: 0 12px; border-left: 3px solid var(--border); color: var(--muted); }
  .preview img { max-width: 100%; }
  .preview .added { box-shadow: -4px 0 0 var(--viewed), -8px 0 0 var(--bg); background: color-mix(in srgb, var(--viewed) 7%, transparent); }
  .preview tr.added td { background: color-mix(in srgb, var(--viewed) 10%, transparent); }
  .preview .mermaid { background: transparent; border: 0; padding: 8px 0; text-align: center; }
  .preview .mermaid svg { max-width: 100%; height: auto; }
  .help { position: fixed; right: 16px; bottom: 16px; z-index: 6; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; font-size: 12px; }
  .help kbd { font-family: var(--mono); border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; }
  [hidden] { display: none !important; }
  @media (max-width: 800px) {
    .layout { grid-template-columns: minmax(0, 1fr); }
    .side { position: static; max-height: 40vh; }
    .file-header { position: static; }
  }
  @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
</style>
</head>
<body>
<div class="top" id="top"></div>
<div class="layout">
  <nav class="side" id="side" aria-label="Changed files"></nav>
  <main class="main" id="main"></main>
</div>
<div class="help" id="help" hidden><kbd>j</kbd>/<kbd>k</kbd> next/previous file &nbsp; <kbd>v</kbd> viewed &nbsp; <kbd>e</kbd> expand/collapse &nbsp; hover a line number and click <kbd>+</kbd> to comment &nbsp; <kbd>?</kbd> this help</div>
<script id="data" type="application/json">__DATA__</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById('data').textContent);
  const storageKey = key => 'diff-viewer:' + data.repo + ':' + key;
  const store = {
    get(key) { try { return localStorage.getItem(storageKey(key)); } catch { return null; } },
    set(key, value) { try { value === null ? localStorage.removeItem(storageKey(key)) : localStorage.setItem(storageKey(key), value); } catch {} },
  };
  const tabFromHash = parseInt(location.hash.replace('#tab', ''), 10);
  let tabIndex = Number.isInteger(tabFromHash) ? tabFromHash : Number(store.get('tab') || 0);
  if (!data.tabs[tabIndex]) tabIndex = 0;
  let split = store.get('split') === '1';
  let smallestFirst = store.get('sort') === 'size';
  let current = 0;
  const previewOn = new Set();

  const size = file => file.adds + file.dels;
  const files = () => {
    const list = [...data.tabs[tabIndex].files];
    return smallestFirst ? list.sort((a, b) => size(a) - size(b) || a.path.localeCompare(b.path)) : list;
  };
  const isViewed = file => store.get(file.path) === file.hash;

  // Marking a file viewed also snapshots its diff lines, so a later version of the diff can show what is new since
  const lineKeys = file => file.hunks.flatMap(h => h.lines.map(l => l.kind[0] + l.text));
  const snapshotKey = file => 'snap:' + file.path;
  const sinceCache = new Map();
  function changesSinceViewed(file) {
    const cacheKey = tabIndex + ':' + file.path;
    if (sinceCache.has(cacheKey)) return sinceCache.get(cacheKey);
    let result = null;
    const raw = store.get(snapshotKey(file));
    if (raw && !isViewed(file)) {
      let before = [];
      try { before = JSON.parse(raw); } catch {}
      const after = lineKeys(file);
      const kept = lcsMembership(before, after);
      const fresh = new Set();
      kept.after.forEach((seen, index) => { if (!seen) fresh.add(index); });
      result = { fresh, removed: before.length - kept.count };
    }
    sinceCache.set(cacheKey, result);
    return result;
  }
  // Which entries of b survive from a, by longest common subsequence; plain membership when the table would be too big
  function lcsMembership(a, b) {
    const n = a.length, m = b.length;
    if (n * m > 4e6) {
      const seen = new Set(a);
      const after = b.map(key => seen.has(key));
      return { after, count: after.filter(Boolean).length };
    }
    const width = m + 1;
    const dp = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * width + j] = a[i] === b[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
      }
    }
    const after = new Array(m).fill(false);
    let i = 0, j = 0, count = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { after[j] = true; count++; i++; j++; }
      else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) i++;
      else j++;
    }
    return { after, count };
  }
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'checked') node.checked = Boolean(v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    node.append(...children.flat().filter(c => c != null));
    return node;
  };
  const counts = file => el('span', { class: 'counts' }, el('span', { class: 'a' }, '+' + file.adds), ' ', el('span', { class: 'd' }, '−' + file.dels));

  // Review comments: anchored to a path, a side (old/new) and a line; kept per diff in localStorage
  const commentsKey = () => 'comments:' + data.tabs[tabIndex].label;
  const comments = () => { try { return JSON.parse(store.get(commentsKey()) || '[]'); } catch { return []; } };
  const saveComments = list => store.set(commentsKey(), list.length ? JSON.stringify(list) : null);
  const byPosition = (a, b) => a.path.localeCompare(b.path) || a.line - b.line;

  function render() {
    renderTop();
    renderSide();
    renderMain();
  }

  function renderTop() {
    const top = document.getElementById('top');
    top.replaceChildren();
    const viewed = files().filter(isViewed).length;
    const total = { adds: files().reduce((n, f) => n + f.adds, 0), dels: files().reduce((n, f) => n + f.dels, 0) };
    top.append(...[
      el('h1', {}, data.title),
      el('span', { class: 'range' }, data.tabs[tabIndex].label),
      el('span', { class: 'chip' }, files().length + ' files ', counts(total)),
      el('span', { class: 'chip' + (viewed === files().length && files().length ? ' done' : '') }, viewed + ' of ' + files().length + ' viewed'),
      comments().length ? el('span', { class: 'chip' }, comments().length + (comments().length === 1 ? ' comment' : ' comments')) : null,
      el('span', { class: 'spacer' }),
      comments().length ? el('button', { class: 'btn', onclick: copyComments }, 'Copy comments') : null,
      comments().length ? el('button', { class: 'btn', onclick: clearComments }, 'Clear comments') : null,
      el('button', { class: 'btn', 'aria-pressed': String(smallestFirst), onclick: () => { smallestFirst = !smallestFirst; store.set('sort', smallestFirst ? 'size' : 'path'); current = 0; render(); } }, 'Smallest first'),
      el('button', { class: 'btn', 'aria-pressed': String(split), onclick: () => { split = !split; store.set('split', split ? '1' : '0'); render(); } }, 'Split'),
      el('button', { class: 'btn', onclick: () => setAllCollapsed(false) }, 'Expand all'),
      el('button', { class: 'btn', onclick: () => setAllCollapsed(true) }, 'Collapse all'),
    ].filter(Boolean));
    if (data.tabs.length > 1) {
      top.append(el('div', { class: 'tabs' }, data.tabs.map((tab, i) =>
        el('button', { class: 'btn', 'aria-pressed': String(i === tabIndex), onclick: () => { tabIndex = i; current = 0; store.set('tab', String(i)); history.replaceState(null, '', '#tab' + i); render(); } },
          tab.label + ' (' + tab.files.filter(isViewed).length + '/' + tab.files.length + ')'))));
    }
  }

  function renderSide() {
    document.getElementById('side').replaceChildren(el('ul', {}, files().map((file, i) =>
      el('li', { class: isViewed(file) ? 'viewed' : '', onclick: () => focusFile(i) },
        el('input', { type: 'checkbox', checked: isViewed(file), onclick: e => { e.stopPropagation(); toggleViewed(i); } }),
        el('span', { class: 'status ' + file.status }, file.status[0]),
        el('span', { class: 'name', title: file.path }, file.path),
        changesSinceViewed(file) ? el('span', { class: 'since-dot', title: 'Changed since you viewed it' }) : null,
        counts(file),
      ))));
  }

  function renderMain() {
    document.getElementById('main').replaceChildren(...files().map(renderFileBlock));
    highlightCode();
  }

  function renderFileBlock(file, i) {
    const viewed = isViewed(file);
    const since = changesSinceViewed(file);
    const block = el('div', { class: 'file' + (viewed ? ' viewed collapsed' : ''), id: 'file-' + i, 'data-index': i });
    const header = el('div', { class: 'file-header', tabindex: 0, onclick: e => { if (!e.target.closest('label')) block.classList.toggle('collapsed'); } },
      el('span', { class: 'caret' }, '▾'),
      el('span', { class: 'status ' + file.status }, file.status),
      el('span', { class: 'path' }, file.oldPath ? file.oldPath + ' → ' + file.path : file.path),
      counts(file),
      since ? el('span', { class: 'chip since', title: 'Compared with the diff when you last marked this file viewed' }, since.fresh.size + ' new' + (since.removed ? ', ' + since.removed + ' gone' : '') + ' since viewed') : null,
      file.preview != null ? el('button', { class: 'btn', 'aria-pressed': String(previewOn.has(file.path)), onclick: e => { e.stopPropagation(); togglePreview(file, block, e.target); } }, 'Preview') : null,
      el('label', {}, el('input', { type: 'checkbox', checked: viewed, onclick: () => toggleViewed(i) }), 'Viewed'),
    );
    block.append(header, el('div', { class: 'body' + (split ? ' split' : '') }, renderBody(file)));
    return block;
  }

  function togglePreview(file, block, button) {
    previewOn.has(file.path) ? previewOn.delete(file.path) : previewOn.add(file.path);
    button.setAttribute('aria-pressed', String(previewOn.has(file.path)));
    block.querySelector('.body').replaceChildren(renderBody(file));
    highlightCode();
  }

  function renderBody(file) {
    if (file.preview != null && previewOn.has(file.path)) {
      const box = el('div', { class: 'preview' }, 'Rendering…');
      renderMarkdown(box, file);
      return box;
    }
    if (file.binary) return el('div', { class: 'notice' }, 'Binary file');
    if (!file.hunks.length) return el('div', { class: 'notice' }, file.status === 'renamed' ? 'Renamed without changes' : 'No content changes');
    const table = el('table', { 'data-lang': languageFor(file.path) });
    const fresh = changesSinceViewed(file)?.fresh ?? new Set();
    let index = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) line.index = index++;
      table.append(el('tr', { class: 'hunk' }, el('td', { colspan: 4 }, hunk.header)));
      table.append(...(split ? splitRows(hunk.lines, file.path, fresh) : unifiedRows(hunk.lines, file.path, fresh)));
    }
    for (const comment of comments().filter(c => c.path === file.path).sort(byPosition)) {
      const row = table.querySelector('tr[data-' + comment.side + '="' + comment.line + '"]');
      if (row) row.after(commentRow(comment, false));
      else table.prepend(commentRow(comment, true));
    }
    return table;
  }

  const addButton = anchor => el('button', { class: 'add-comment', title: 'Comment on this line', onclick: e => { e.stopPropagation(); openCommentForm(e.target.closest('tr'), anchor); } }, '+');

  function commentRow(comment, stale) {
    const row = el('tr', { class: 'comment' }, el('td', { colspan: 4 }, el('div', { class: 'comment-box' },
      stale ? el('div', { class: 'comment-stale' }, 'Line ' + comment.line + ' (' + comment.side + ') is no longer in this diff') : null,
      el('div', { class: 'comment-code' }, comment.code),
      el('div', { class: 'comment-text' }, comment.text),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: () => openCommentForm(row, comment, comment) }, 'Edit'),
        el('button', { class: 'btn', onclick: () => { saveComments(comments().filter(c => c.id !== comment.id)); render(); } }, 'Delete')))));
    return row;
  }

  function openCommentForm(afterRow, anchor, existing) {
    const textarea = el('textarea', { rows: 3, placeholder: 'Comment for Claude. Ctrl+Enter saves, Esc cancels.' }, existing ? existing.text : '');
    const formRow = el('tr', { class: 'comment-form' });
    const save = () => {
      const text = textarea.value.trim();
      if (!text) return;
      const list = comments().filter(c => !existing || c.id !== existing.id);
      list.push({ id: existing ? existing.id : String(Date.now()), path: anchor.path, side: anchor.side, line: anchor.line, code: anchor.code, text });
      saveComments(list);
      render();
    };
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
      else if (e.key === 'Escape') formRow.remove();
    });
    formRow.append(el('td', { colspan: 4 }, textarea, el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: save }, existing ? 'Update' : 'Save'),
      el('button', { class: 'btn', onclick: () => formRow.remove() }, 'Cancel'))));
    afterRow.after(formRow);
    textarea.focus();
  }

  function commentsMarkdown() {
    const lines = ['Review comments on ' + data.title + ' (' + data.tabs[tabIndex].label + '):', ''];
    for (const c of comments().sort(byPosition)) {
      lines.push(c.path + ':' + c.line + ' (' + c.side + ')', '> ' + c.code, c.text, '');
    }
    return lines.join('\n');
  }

  function copyComments(e) {
    const button = e.target;
    const done = label => { button.textContent = label; setTimeout(() => { button.textContent = 'Copy comments'; }, 1500); };
    navigator.clipboard.writeText(commentsMarkdown()).then(() => done('Copied'), () => {
      const box = el('textarea', { rows: 12 }, commentsMarkdown());
      button.after(box);
      box.select();
      done('Select and copy');
    });
  }

  function clearComments(e) {
    if (e.target.dataset.armed) { saveComments([]); render(); return; }
    e.target.dataset.armed = '1';
    e.target.textContent = 'Really clear?';
    setTimeout(() => { delete e.target.dataset.armed; e.target.textContent = 'Clear comments'; }, 3000);
  }

  function unifiedRows(lines, path, fresh) {
    return lines.map(line => {
      const since = fresh.has(line.index) ? ' since' : '';
      if (line.kind === 'meta') return el('tr', { class: 'meta' + since }, el('td', { class: 'num' }), el('td', { class: 'num' }), el('td', { class: 'code', colspan: 2 }, line.text));
      const anchor = line.new != null ? { path, side: 'new', line: line.new, code: line.text } : { path, side: 'old', line: line.old, code: line.text };
      return el('tr', { class: line.kind + since, 'data-old': line.old, 'data-new': line.new },
        el('td', { class: 'num' }, addButton(anchor), line.old ?? ''), el('td', { class: 'num' }, line.new ?? ''),
        el('td', { class: 'mark' }, { add: '+', del: '-', ctx: ' ' }[line.kind]), el('td', { class: 'code' }, line.text));
    });
  }

  function splitRows(lines, path, fresh) {
    const rows = [];
    const oldCell = (line, cls) => el('td', { class: 'num' + cls }, line ? addButton({ path, side: 'old', line: line.old, code: line.text }) : null, line ? line.old : '');
    const newCell = (line, cls) => el('td', { class: 'num' + cls }, line ? addButton({ path, side: 'new', line: line.new, code: line.text }) : null, line ? line.new : '');
    const since = (...candidates) => (candidates.some(line => line && fresh.has(line.index)) ? 'since' : '');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.kind === 'meta') { rows.push(el('tr', { class: 'meta ' + since(line) }, el('td', { class: 'num' }), el('td', { class: 'code' }, line.text), el('td', { class: 'num' }), el('td', { class: 'code' }, line.text))); i++; continue; }
      if (line.kind === 'ctx') { rows.push(el('tr', { class: since(line), 'data-old': line.old, 'data-new': line.new }, oldCell(line, ''), el('td', { class: 'code' }, line.text), newCell(line, ''), el('td', { class: 'code' }, line.text))); i++; continue; }
      const dels = [], adds = [];
      while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++]);
      while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        const d = dels[k], a = adds[k];
        rows.push(el('tr', { class: since(d, a), 'data-old': d ? d.old : null, 'data-new': a ? a.new : null },
          oldCell(d, d ? ' del' : ''), el('td', { class: 'code' + (d ? ' del' : ' empty') }, d ? d.text : ''),
          newCell(a, a ? ' add' : ''), el('td', { class: 'code' + (a ? ' add' : ' empty') }, a ? a.text : '')));
      }
    }
    return rows;
  }

  function toggleViewed(i) {
    const file = files()[i];
    const viewed = !isViewed(file);
    store.set(file.path, viewed ? file.hash : null);
    if (viewed) store.set(snapshotKey(file), JSON.stringify(lineKeys(file)));
    sinceCache.delete(tabIndex + ':' + file.path);
    document.getElementById('file-' + i).replaceWith(renderFileBlock(file, i));
    highlightCode();
    renderTop();
    renderSide();
    if (viewed && i + 1 < files().length) focusFile(i + 1);
  }

  function setAllCollapsed(collapsed) {
    document.querySelectorAll('.file').forEach(block => block.classList.toggle('collapsed', collapsed));
  }

  function focusFile(i) {
    current = Math.max(0, Math.min(i, files().length - 1));
    const block = document.getElementById('file-' + current);
    block.scrollIntoView({ block: 'start' });
    block.querySelector('.file-header').focus({ preventScroll: true });
  }

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'j') focusFile(current + 1);
    else if (e.key === 'k') focusFile(current - 1);
    else if (e.key === 'v') toggleViewed(current);
    else if (e.key === 'e') document.getElementById('file-' + current).classList.toggle('collapsed');
    else if (e.key === '?') document.getElementById('help').hidden = !document.getElementById('help').hidden;
    else return;
    e.preventDefault();
  });
  document.addEventListener('focusin', e => {
    const block = e.target.closest('.file');
    if (block) current = Number(block.dataset.index);
  });

  // Highlighting and Markdown rendering come from a CDN on first use, so the page stays usable offline
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
  const loaded = new Map();
  const loadScript = url => loaded.get(url) ?? loaded.set(url, new Promise((resolve, reject) => {
    const script = el('script', { src: url, onload: resolve, onerror: () => reject(new Error('failed to load ' + url)) });
    document.head.append(script);
  })).get(url);
  const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  let themeLink;
  const loadHighlightTheme = () => {
    const href = CDN + 'highlight.js/11.9.0/styles/' + (dark() ? 'github-dark' : 'github') + '.min.css';
    if (themeLink?.href === href) return;
    themeLink?.remove();
    themeLink = el('link', { rel: 'stylesheet', href });
    document.head.append(themeLink);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeLink) loadHighlightTheme(); });

  const LANGUAGES = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'bash', zsh: 'bash', bash: 'bash', py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', css: 'css', scss: 'scss', html: 'xml', xml: 'xml', sql: 'sql', toml: 'ini', ini: 'ini', dockerfile: 'dockerfile', prisma: 'graphql', graphql: 'graphql', tf: 'ini' };
  function languageFor(path) {
    const name = path.split('/').pop().toLowerCase();
    if (name === 'dockerfile') return 'dockerfile';
    return LANGUAGES[name.split('.').pop()] ?? '';
  }

  let highlightFailed = false;
  function highlightCode() {
    if (highlightFailed) return;
    loadScript(CDN + 'highlight.js/11.9.0/highlight.min.js').then(() => {
      loadHighlightTheme();
      for (const table of document.querySelectorAll('table[data-lang]')) {
        const language = table.dataset.lang;
        if (!language || !hljs.getLanguage(language)) continue;
        for (const cell of table.querySelectorAll('td.code')) {
          if (cell.dataset.highlighted || cell.closest('tr.meta')) continue;
          cell.innerHTML = hljs.highlight(cell.textContent, { language, ignoreIllegals: true }).value;
          cell.dataset.highlighted = '1';
        }
      }
    }, () => { highlightFailed = true; });
  }

  // Plants an HTML comment at the start of each added line of the Markdown source (outside code fences, where a whole
  // changed fence gets one marker before it) so the rendered block it lands in can be marked as changed.
  function markAddedLines(markdown, file) {
    const added = new Set(file.hunks.flatMap(h => h.lines.filter(l => l.kind === 'add').map(l => l.new)));
    const out = [];
    let fence = null;
    let fenceTouched = false;
    let fenceStart = 0;
    markdown.split('\n').forEach((line, index) => {
      const no = index + 1;
      const fenceMatch = /^\s*(\x60{3,}|~{3,})/.exec(line);
      if (fence === null && fenceMatch) {
        fence = fenceMatch[1];
        fenceStart = out.length;
        fenceTouched = added.has(no);
        out.push(line);
      } else if (fence !== null) {
        fenceTouched ||= added.has(no);
        if (line.trim().startsWith(fence)) {
          if (fenceTouched) out.splice(fenceStart, 0, '<!--dv-->', '');
          fence = null;
        }
        out.push(line);
      } else if (added.has(no) && line.trim() && !/^\s*([-=*_]\s*){3,}$/.test(line) && !/^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*\|?\s*$/.test(line)) {
        out.push(line.replace(/^(\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*|#{1,6}\s+|\|)?)/, '$1<!--dv-->'));
      } else {
        out.push(line);
      }
    });
    return out.join('\n');
  }

  function renderMarkdown(box, file) {
    loadScript(CDN + 'marked/12.0.2/marked.min.js').then(() => {
      box.innerHTML = marked.parse(markAddedLines(file.preview, file));
      const fences = [...box.querySelectorAll('pre > code.language-mermaid')];
      for (const code of fences) code.parentElement.replaceWith(el('pre', { class: 'mermaid' }, code.textContent));
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_COMMENT);
      const markers = [];
      while (walker.nextNode()) if (walker.currentNode.data === 'dv') markers.push(walker.currentNode);
      for (const marker of markers) {
        const target = marker.parentElement === box ? marker.nextElementSibling : marker.parentElement.closest('tr, li, p, h1, h2, h3, h4, h5, h6, blockquote, pre');
        target?.classList.add('added');
        marker.remove();
      }
      if (!fences.length) return;
      return loadScript(CDN + 'mermaid/10.9.1/mermaid.min.js').then(() => {
        mermaid.initialize({ startOnLoad: false, theme: dark() ? 'dark' : 'default' });
        return mermaid.run({ nodes: box.querySelectorAll('pre.mermaid') });
      });
    }).catch(err => { box.textContent = 'Preview unavailable: ' + err.message; });
  }

  // The top bar wraps at narrow widths, so sticky offsets follow its real height
  const setTopHeight = () => document.documentElement.style.setProperty('--top-h', document.getElementById('top').offsetHeight + 'px');
  new ResizeObserver(setTopHeight).observe(document.getElementById('top'));

  render();
  setTopHeight();
})();
</script>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Helpers

function gitRoot(): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail('not inside a git repository');
  }
  return result.stdout.trim();
}

function openInBrowser(path: string): void {
  const opener = spawnSync('which', ['wslview'], { encoding: 'utf8' }).status === 0 ? 'wslview' : 'xdg-open';
  spawn(opener, [opener === 'wslview' ? path : pathToFileURL(path).href], { detached: true, stdio: 'ignore' }).unref();
}

function popOption(args: Array<string>, name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  if (index + 1 >= args.length) {
    fail(`${name} needs a value`);
  }
  const [, value] = args.splice(index, 2);
  return value;
}

function popFlag(args: Array<string>, name: string): boolean {
  const index = args.indexOf(name);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

function fail(message: string): never {
  console.error(`git-diff-viewer: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Self-test: the one check the script carries, over a fixture with every file shape

const FIXTURE = `diff --git a/src/kept.ts b/src/kept.ts
index 1111111..2222222 100644
--- a/src/kept.ts
+++ b/src/kept.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a, b };
\\ No newline at end of file
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const fresh = true;
+
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/src/before.ts b/src/after.ts
similarity index 90%
rename from src/before.ts
rename to src/after.ts
index 5555555..6666666 100644
--- a/src/before.ts
+++ b/src/after.ts
@@ -2 +2 @@
-x
+y
diff --git a/logo.png b/logo.png
index 7777777..8888888 100644
Binary files a/logo.png and b/logo.png differ
`;

function selfTest(): number {
  const files = new Map(parseDiff(FIXTURE).map(file => [file.path, file]));
  const expect = (condition: boolean, what: string): void => {
    if (!condition) {
      fail(`self-test failed: ${what}`);
    }
  };
  expect([...files.keys()].join() === 'src/kept.ts,src/new.ts,src/old.ts,src/after.ts,logo.png', 'file list');
  const kept = files.get('src/kept.ts');
  expect(kept?.status === 'modified' && kept.adds === 2 && kept.dels === 1, 'kept counts');
  expect(kept?.hunks[0].lines.at(-1)?.kind === 'meta', 'no-newline marker');
  expect(JSON.stringify(kept?.hunks[0].lines[1]) === JSON.stringify({ kind: 'del', old: 2, new: null, text: 'const b = 2;' }), 'del line');
  expect(JSON.stringify(kept?.hunks[0].lines[3]) === JSON.stringify({ kind: 'add', old: null, new: 3, text: 'const c = 4;' }), 'add line');
  expect(files.get('src/new.ts')?.status === 'added' && files.get('src/new.ts')?.adds === 2, 'added file');
  expect(files.get('src/old.ts')?.status === 'deleted' && files.get('src/old.ts')?.dels === 1, 'deleted file');
  expect(files.get('src/after.ts')?.status === 'renamed' && files.get('src/after.ts')?.oldPath === 'src/before.ts', 'rename');
  expect(files.get('logo.png')?.binary === true && files.get('logo.png')?.hunks.length === 0, 'binary');
  expect(new Set([...files.values()].map(file => file.hash)).size === 5, 'distinct hashes');
  const page = renderPage('t', 'repo', [{ label: 'a..b', files: [...files.values()] }]);
  expect(!page.split('id="data"')[1].split('</script>')[0].includes('</'), 'json is script-safe');
  console.log('self-test ok');
  return 0;
}

process.exit(main(process.argv.slice(2)));
