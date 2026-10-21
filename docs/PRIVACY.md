# MarkAtlas privacy notice

Effective date: 21 October 2026. Publisher: Zihao Jing.

MarkAtlas is a local desktop file-review plugin. It has no publisher-operated
data-collection service. The publisher confirms that MarkAtlas does not add
analytics, crash reporting, or an external document-storage service.

## Local file processing and storage

MarkAtlas lists and reads files in folders made available by the host or selected
by you. Opening a local file can connect its containing folder. Connected text
edits can autosave to the original files. PDFs and DOCX previews are processed
locally using the release's supported components. A directory listing does not
upload the directory to the publisher.

The viewer can retain draft text, comments, screenshots, review queues, and UI
preferences in host-provided local storage. The local server can also retain
document working copies, annotation records, explanation responses, and settings
on disk. It uses the host's `PLUGIN_DATA` directory when provided. Otherwise,
review and explanation records use the system temporary directory's
`gpt-commenter-data` folder, and settings use `~/.config/markatlas/`.

These records do not have a general automatic deletion schedule. An explanation
request expires for reading after 24 hours; expiry does not itself erase its
disk file. Temporary files used for a Codex CLI explanation are removed after
the request completes or fails.

## Content you choose to send to AI

MarkAtlas's local processing does not make AI requests offline. When you send
comments to chat, the host receives the selected context, which can include file
paths, excerpts, comments, and screenshots. Explanation requests send the selected
passage and any screenshot through host MCP sampling or a signed-in Codex CLI.
The host or CLI connects to its AI service. The service's own privacy, retention,
account, and billing terms apply; MarkAtlas does not control those services.

## Your choices and deletion

Do not select or send material you are not authorized to share. Remove queued
comments in the viewer before sending them. Removing a comment cannot retract
messages already sent to the host. Use the host's chat/data controls for those
messages.

To remove retained local plugin data, close the plugin, clear its viewer storage
using the host's supported controls, and remove the MarkAtlas-specific records
from its data locations above. If `PLUGIN_DATA` is managed by the host, use the
host's plugin-data controls or ask the host for the exact location. Do not delete
unrelated host data. Uninstalling the plugin may not erase local drafts or chats.

## Support

Use [GitHub Issues](https://github.com/zihao-jing/gpt-commenter/issues) for support.
Issues are public: avoid including private documents, credentials, or sensitive
personal data. GitHub handles issue/account data under its own terms and privacy
policy. Report technical deletion difficulties using a nonsensitive example.

This notice describes MarkAtlas, not the privacy practices of GitHub, your
desktop host, your AI service, or third-party tools you choose to install.
