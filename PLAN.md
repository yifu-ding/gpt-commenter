# gpt-commenter implementation plan

## Product goal

Let a reader select text, add comments or request an explanation, and send several review items to an AI agent in one round. The default payload is text with a source file and line range when these can be determined. A screenshot is an explicit, per-item option.

The first compatibility prototype uses Markdown to validate selection, source-line capture, draft queue, and batch handoff. The first complete PDF workflow then targets PDFs generated from LaTeX with SyncTeX data. Source-code selections follow. Ordinary PDFs remain useful for commenting, but must not claim a source-code location unless a reliable mapping exists.

## User workflow

1. Open a document in a viewer controlled by gpt-commenter.
2. Select text and press a configurable shortcut. The same action must be available from a visible button.
3. Choose **Add comment** or **Ask for explanation**. Explanation detail has three choices: short, medium, and long.
4. After an explanation, optionally add a comment to the same selection.
5. Choose **Text** (default) or **Screenshot** as context for that item.
6. Review, edit, reorder, or remove queued items.
7. Preview the exact batch payload and send it to the agent once.
8. See which items were addressed and which need a better source location or user input.

## Technical approach

- **Primary language:** TypeScript for the viewer, mapping service, batch model, and MCP tools.
- **Viewer:** React with PDF.js for PDF display and selectable text. Add direct text views for Markdown and code after the PDF workflow works.
- **LaTeX mapping:** compile with SyncTeX enabled; call the installed `synctex` CLI from the backend. Store the PDF path, page, selection rectangle, selected text, and candidate source file and line. Check that the SyncTeX file belongs to the current PDF build.
- **Agent integration:** expose focused MCP tools to retrieve a reviewed batch and its source context. Keep the tool output useful without a custom UI.
- **Persistence:** save the draft queue locally for the MVP. Define a versioned JSON schema so it can later move to a service without changing the UI contract.

The target host is the ChatGPT desktop app. Its documented file entrypoint can open a plugin-owned viewer for supported extensions. Keyboard handling and opened-file resource access still need a live host test. A shortcut inside our own viewer is the baseline; do not assume a plugin can intercept selections in the built-in PDF viewer.

## Review-item contract

Each item should contain:

| Field | Meaning |
| --- | --- |
| `id`, `documentId`, `documentHash` | Stable identity and protection against stale mappings |
| `page`, `rects`, `selectedText` | PDF location and exact selected text |
| `sourcePath`, `startLine`, `endLine` | Optional source location |
| `mappingStatus` | `exact`, `candidate`, or `unavailable` |
| `kind` | `comment` or `explanation` |
| `comment`, `detail` | User request; detail is `short`, `medium`, or `long` for explanations |
| `contextMode` | `text` by default, or `screenshot` |
| `screenshotRef` | Optional image reference, present only when selected |

Use `candidate` for a SyncTeX point that does not clearly cover the full selection. If the selection spans distinct source locations, retain multiple candidates instead of inventing one wide range. The payload preview must show uncertainty.

## Build sequence

### 0. Markdown pipeline spike

- Use a controlled Markdown viewer to capture selected text and exact source lines.
- Queue review items, preview the payload, and hand the batch to Codex.
- Check whether ChatGPT desktop can open a plugin-owned file viewer and deliver selected text, file identity, and shortcut events.
- Build a minimal standalone viewer fallback if host integration is unavailable.
- Record the supported host behavior in this repo before designing around it.

**Exit condition:** a Markdown selection reaches local code with text and source lines; the batch reaches a Codex chat. For the later PDF viewer, a real selection must also provide page and coordinates.

### 1. LaTeX reverse-mapping prototype

- Add a tiny LaTeX fixture with a main file and one included file.
- Compile with SyncTeX enabled and retain the generated `.synctex.gz` beside the PDF.
- Map a point in a selected sentence through `synctex edit`.
- Validate the returned file and line against the selection text. Return a mapping status and candidate location.
- Handle missing SyncTeX data, stale PDF builds, multiple candidates, and line wrapping without fabricating precision.

**Exit condition:** selections in both fixture source files resolve to the correct file and nearby line; missing or stale mapping is clearly flagged.

### 2. One-item viewer workflow

- Render and select text in PDF.js.
- Add the shortcut, visible action button, comment editor, and explanation-length control.
- Save one review item using the versioned schema. Default to text context.
- Show the source candidate and let the user inspect it before sending.

**Exit condition:** a user can create, edit, and delete one item without a screenshot.

### 3. Batch review and agent handoff

- Queue multiple items across pages and files.
- Group the preview by document and source file, preserving each item's ID and order.
- Include selected text, small source excerpts, source ranges when known, and the user's request. Include images only for items set to screenshot mode.
- Add a single send action and a result view that associates agent responses with item IDs.
- Keep sending idempotent so retries do not duplicate comments.

**Exit condition:** three comments can be edited, reviewed, and delivered in one round; the agent can refer to each item unambiguously.

### 4. Additional formats

- For Markdown and code opened directly in the viewer, map selection offsets to file lines.
- For PDFs generated from other sources, use a source map only when the generator supplies one. Text matching can suggest a candidate, but it must be marked uncertain.
- For ordinary PDFs, preserve selected text and PDF location with `mappingStatus: unavailable`.
- For scanned PDFs, defer OCR until text-based PDFs work reliably.

**Exit condition:** each format reports honest mapping status and produces a usable batch item.

### 5. Plugin packaging and release

- Package MCP tools and optional UI with a plugin manifest. Test personal installation in a clean environment.
- Document local file access, screenshot handling, and whether any document content leaves the machine.
- Check current public submission rules before choosing a local-only MCP server: local MCP public submissions may require special approval.
- Submit for public review only after the supported Codex and ChatGPT surfaces are verified.

**Exit condition:** another user can install the package, open the sample document, and complete the batch workflow from written setup steps.

## Acceptance and failure checks

- Text context is selected by default; screenshots are never silently attached.
- The batch preview matches the payload sent to the agent.
- A changed PDF cannot silently reuse old SyncTeX locations.
- Unmapped PDFs never display a made-up source path or line.
- Keyboard users can complete the workflow; all shortcut actions have visible controls.
- The explanation length changes response detail, not the underlying selection or mapping.
- No item is lost when the viewer is closed and reopened during a draft session.

## References

- [OpenAI: plugin architecture and MCP tools](https://developers.openai.com/plugins/concepts/plugins)
- [OpenAI: plugin extensions and file viewers](https://developers.openai.com/plugins/build/extensions)
- [OpenAI: MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)
- [OpenAI: desktop-only plugin submission](https://developers.openai.com/plugins/deploy/desktop-only)
- [Mozilla PDF.js](https://github.com/mozilla/pdf.js)
- [SyncTeX reverse synchronization](https://www.tug.org/TUGboat/tb29-3/tb93laurens.pdf)
