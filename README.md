<p align="center">
  <img src="plugin/assets/icon.svg" width="64" height="64" alt="MarkAtlas icon">
</p>

<h1 align="center">MarkAtlas</h1>
<p align="center"><strong>Collect comments. Let AI act.</strong><br>Developed by Zihao Jing</p>

MarkAtlas turns your file review into a clear request for your AI assistant. Read a document, select the passages that need attention, and leave comments where they belong. When you are ready, click **Send** to submit a short request with each comment as a separate context attachment, including file locations, concise excerpts, and screenshots.

Review the whole picture before asking AI to act.

## From reading to action

1. **Open a file or project.** Select a local file to open its parent folder and focus that file, or connect a project folder directly.
2. **Mark what matters.** Select text to comment, or capture a PDF region to discuss a figure, table, or layout.
3. **Keep working.** Edit Markdown and code while collecting comments. Connected text files autosave, and comments follow your edits.
4. **Review and send.** Preview the queue, remove individual comments or cancel them all, then click **Send** to submit the request immediately with separate context attachments.

The review bar shows how many files and annotations are queued. Each context piece includes its file location, and numbered comments keep screenshots connected to their requests. Attached and deleted annotations leave no lingering highlights in the viewer.

## One workspace for different files

| Format | What you can do |
| --- | --- |
| **Markdown** | Read and edit rendered content or source, including tables, and comment in either view. |
| **Code and plain text** | Edit with syntax highlighting for supported languages, autosave connected files, and annotate specific selections. |
| **PDF** | Read continuous pages, zoom around the pointer, select available text, and comment on screenshot regions. No source document is required to view a PDF. |
| **LaTeX projects** | Map PDF selections to `.tex` locations using SyncTeX when available, with text matching as a fallback. Ask AI to edit the source and rebuild using your installed toolchain. |
| **Images** | Preview images alongside the rest of your project. |

Office files opened from the project tree use the host application's native viewer. MarkAtlas also includes a read-only DOCX preview for supported document inputs.

## Understand before you change

Choose **Explanation** on a selection and select a detail level. MarkAtlas displays the AI explanation in the selection panel without opening another chat tab. It uses host MCP sampling when available, with a fresh background Codex CLI conversation as the fallback. These requests include the complete selection and any attached screenshot, so the explanation model has the context it needs.

## Comments that follow your work

Annotations track edits before you send. Deleting an annotated passage removes its comment; screenshot comments tied to an older PDF are removed as well. Sending finishes pending autosaves and checks the remaining file references. If a file changed externally, refresh it before sending the review.

The final request uses the current locations and preserves your existing edits. Files can still change after sending, so the assistant is instructed to match the quoted passages before making changes.

## File access and AI context

The file tree lists names first and reads file contents when you open them. A folder connection does not upload the directory. Opening a local file also connects its containing folder. Host-provided original paths are preserved; attachments without a local path use an isolated working copy. Draft comments stay local until you send them to chat or request an explanation. Those actions share the relevant comments, selected text or excerpts, and screenshots with the host's AI service.

Markdown and code editing write to connected project files. Ordinary PDF review does not provide direct PDF content editing. LaTeX compilation uses your own installation and is run by the assistant or by you; MarkAtlas does not bundle a compiler or expose a Build button.

## Get started

Install MarkAtlas in a compatible desktop host, open it from the plugin's global or conversation entry, and connect a project folder if the host has not supplied one. Start with any Markdown, code, or PDF file from the tree.

See the [plugin guide](plugin/README.md) for requirements, controls, and local development. Native folder selection currently uses a macOS helper. Background explanations require host MCP sampling or an installed, signed-in Codex CLI; PDF viewing requires local Poppler utilities. Scanned PDFs can be displayed, but text selection requires an existing text layer.

---

**MarkAtlas** · Developed by **Zihao Jing**<br>
Collect comments. Let AI act.

## Support and policies

[Support](docs/SUPPORT.md) · [Privacy](docs/PRIVACY.md) · [Terms](docs/TERMS.md)

The Apple Silicon desktop distribution bundles Node and PDF tools; the source distribution requires building. See the release README for installation and platform requirements.
