# MarkAtlas 0.16.5

Collect comments. Let AI act.

## Changes in this release

- Hide deleted Git files and directories from the file tree while preserving Git
  change totals. Missing paths now show a useful moved/deleted message.
- Prevent stale deleted entries from opening previews or triggering file actions.
- Add appearance settings, file-tree controls, new-file/folder creation, and
  moving deleted files to Trash.
- Improve Markdown editing, PDF navigation and selection, comment persistence,
  and clearing recently opened history.
- Include the macOS arm64 Node runtime, bundled JavaScript dependencies,
  Poppler PDF executables and libraries, encoding data, and native file chooser.
- Verify the extracted package with a system-only PATH, including Python/text
  read/save, PDF extraction/rendering, settings, and MCP discovery.

## Downloads

- `markatlas-0.16.5-macos-arm64.zip`: ready-built desktop plugin package.
- `markatlas-0.16.5-source.zip`: matching repository source, including the local
  marketplace and macOS build installer. Dependencies and build outputs are excluded.
- `markatlas-0.16.5-SHA256SUMS.txt`: SHA-256 checksums for both archives.

Review and edit Markdown and code, annotate PDF text or screenshot regions, and
send comments to the current conversation with their file context. Text edits
autosave for connected files, with checks for conflicting disk changes.

The macOS Apple Silicon desktop ZIP includes Node, the built viewer and MCP
server, the native file/folder chooser, and Poppler PDF tools with their runtime
libraries. Users do not need npm, a build step, or Homebrew to use those bundled
features. Matching PDF component sources, build recipes, and license notices are
included. Install through the desktop host's supported local-plugin flow.

Explanations require host sampling or an installed, signed-in Codex CLI. Precise
LaTeX mapping benefits from SyncTeX; compilation uses your own LaTeX toolchain.
Intel Macs, Windows, and Linux are not targets of this ZIP.

Publisher: Zihao Jing. No MarkAtlas payments or purchases. Availability targeting:
all countries supported by the directory, subject to platform eligibility.

MarkAtlas has been submitted to OpenAI for review. Public plugin search is not
available yet; availability in the public Plugins Directory depends on approval
and publication. This patch package is provided for local installation and testing.
