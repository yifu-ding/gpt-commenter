# MarkAtlas submission status

Package preparation is in progress. No portal upload, submission, or publication
has been performed. A draft ZIP is not an approved public release.

Confirmed by the publisher: Zihao Jing; availability in all supported countries;
no payments or purchases; GitHub Issues for support; no publisher-operated
analytics, crash reporting, or external document storage. AI context sharing
through the host/CLI is disclosed separately from local file processing.

## Prepared

- Listing text and GitHub-based URL fields in plugin/plugin.json.
- Five positive and three negative review cases, with expected tools and results.
- Synthetic Markdown, JavaScript, and PDF fixtures under review-fixtures/.
- Release notes, no-commerce declaration, unrestricted country targeting.
- PNG light/dark/composer icons, 512 square pixels, visually checked.
- Support, privacy, and terms pages under docs/.
- A demo walkthrough and reviewer setup instructions; these are not a recording.
- Reproducible desktop packaging and extracted-package checks.

## Evidence and outstanding work

| Check | Status | Evidence / next action |
| --- | --- | --- |
| Plugin automated suite | Passed | All plugin test scripts passed during preparation. |
| PDF fixture and icon appearance | Passed | PDF rendered and inspected; PNG icons checked on light/dark backgrounds. |
| Clean extracted-package checks | Passed | Final 230,034,726-byte ZIP: startup, tools, viewer, read/save, traversal rejection, settings, PDF text extraction, SVG and PNG rendering; only bundled tools/system PATH used. |
| Case 1: open viewer | Not run in host | Packaging check exercises the tool/resource, not visible ChatGPT installation. |
| Case 2: latest annotated text | Not run | Needs real host annotation attachments. |
| Case 3: two-file comment handoff | Not run | Needs live host queue/send and model response. |
| Case 4: PDF text and screenshot | Not run | Needs live host PDF selection, screenshot handoff, and response. |
| Case 5: settings read | Not run in host | Packaging checks can read settings; model-triggered review remains unrun. |
| Negative cases 1–3 | Not run | Must observe model refusing unsupported mail, signing, and OCR actions. |
| Policy pages | Approved by publisher | Publisher authorized finalization and GitHub publication on 21 October 2026. |
| Public URLs and fixture links | Not verified | Publish approved pages, then inspect public content without login. |
| Demo recording and playable URL | Missing | Follow DEMO.md in the real desktop host, play back and host recording. |
| Developer verification | Unverified | Publisher completes identity verification in the intended organization. |
| Local-MCP allowlisting | Unverified | OpenAI representative must confirm submitting organization eligibility. |
| Portal checks and attestations | Not started | Complete on the exact saved package version after preparation. |

The packed tools use local ad-hoc signatures for relocation; this is not an
Apple Developer ID signature or notarization. Full clean-machine installation,
host support, PDF font/encoding coverage, and portal acceptance remain unverified.
Do not describe automated smoke checks as those broader checks.

Run `python3 submission/check-package.py releases/markatlas-0.16.2-macos-arm64.zip`
to inspect structural readiness of the actual archive. The report deliberately
does not equate structural validity with submission readiness.
