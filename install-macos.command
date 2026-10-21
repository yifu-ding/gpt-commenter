#!/bin/bash
# Build this checkout and open its local plugin installation page.
set -euo pipefail
trap 'printf "\nSetup stopped at line %s. Fix the error above, then rerun this script.\n" "$LINENO" >&2' ERR

with_codex=false
open_page=true
for argument in "$@"; do
  case "$argument" in
    --with-codex) with_codex=true ;;
    --no-open) open_page=false ;;
    --help|-h)
      cat <<'HELP'
Usage: bash install-macos.command [--with-codex] [--no-open]

Installs missing build prerequisites, Homebrew, Node.js 22/npm, and Poppler;
builds MarkAtlas from this checkout; opens its local ChatGPT Desktop install page.
--with-codex  Also install Codex CLI for background explanations (sign in afterward).
--no-open     Print the local install link without opening ChatGPT Desktop.
HELP
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 1 ;;
  esac
done

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'This installer requires macOS. The native file picker is not supported on Windows or Linux.' >&2
  exit 1
fi
if [[ "${EUID}" -eq 0 ]]; then
  echo 'Run this script as your normal user, without sudo. Homebrew requests permission if needed.' >&2
  exit 1
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$repo_root"
if [[ ! -f plugin/package-lock.json || ! -f .agents/plugins/marketplace.json ]]; then
  echo 'Keep this script inside the complete repository checkout, then rerun it.' >&2
  exit 1
fi

echo 'Checking Apple command-line tools (including Swift for the file picker)...'
if ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
  /usr/bin/xcode-select --install || true
  echo 'Finish installing the Apple command-line tools in the dialog, then rerun this script.'
  exit 1
fi
if ! /usr/bin/xcrun swiftc --version >/dev/null 2>&1; then
  echo 'Swift is unavailable. Finish command-line tools/Xcode setup, then rerun this script.' >&2
  exit 1
fi

# Finder-launched scripts may not inherit Homebrew in PATH.
if ! command -v brew >/dev/null 2>&1; then
  for brew_path in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$brew_path" ]]; then
      eval "$("$brew_path" shellenv)"
      break
    fi
  done
fi
if ! command -v brew >/dev/null 2>&1; then
  echo 'Installing Homebrew using its official interactive installer...'
  brew_installer="$(mktemp -t markatlas-homebrew)"
  trap 'rm -f "$brew_installer"' EXIT
  /usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$brew_installer"
  /bin/bash "$brew_installer"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  else
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

echo 'Installing Node.js 22 (includes npm) and Poppler PDF tools...'
brew install node@22 poppler
export PATH="$(brew --prefix node@22)/bin:$(brew --prefix)/bin:$PATH"
node --version
npm --version
for pdf_tool in pdftotext pdftocairo pdftoppm; do
  command -v "$pdf_tool"
done

echo 'Installing locked dependencies and building the viewer, server, and native file picker...'
npm ci --include=dev --prefix plugin
npm run build --prefix plugin
test -x plugin/node_modules/node/bin/node
test -f plugin/dist/server.js
test -f plugin/dist/viewer.js
test -x plugin/dist/FolderPicker.app/Contents/MacOS/folder-picker

if "$with_codex"; then
  brew install --cask codex
  echo 'Codex CLI installed. Run codex in Terminal and sign in before using background explanations.'
fi

install_url="$(node --input-type=module - "$repo_root" <<'JS'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const marketplace = join(process.argv[2], '.agents/plugins/marketplace.json');
const { name } = JSON.parse(readFileSync(join(process.argv[2], 'plugin/plugin.json'), 'utf8'));
console.log(`codex://plugins/${encodeURIComponent(name)}?marketplacePath=${encodeURIComponent(marketplace)}`);
JS
)"
printf '\nMarkAtlas is built. Local install link:\n%s\n\n' "$install_url"
echo 'In ChatGPT Desktop, select Install on the local plugin page and approve its requested access.'
echo 'Use a local chat, then ask: Open MarkAtlas so I can review my files.'
echo 'Public plugin search is not available yet; MarkAtlas has been submitted to OpenAI for review.'
if "$open_page"; then
  /usr/bin/open "$install_url" || echo 'Could not open ChatGPT Desktop. Open the link above after installing the desktop app.'
fi
