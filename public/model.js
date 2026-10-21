export function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

export function makeSelection(text, start, end) {
  if (start >= end || start < 0 || end > text.length) return null;
  return {
    selectedText: text.slice(start, end),
    startOffset: start,
    endOffset: end,
    startLine: lineAt(text, start),
    endLine: lineAt(text, end - 1)
  };
}

export async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

export function buildPayload(document, items) {
  return {
    schemaVersion: 1,
    instruction: 'Address each review item by id. Use the selected text and request. Treat the source lines as valid only if documentHash still matches the current document. Report any item that needs clarification.',
    document: {
      name: document.name,
      documentHash: document.hash,
      format: 'markdown'
    },
    items: items.map(({id, selectedText, startLine, endLine, kind, comment, detail}) => ({
      id, selectedText, sourcePath: null, sourceName: document.name, startLine, endLine,
      mappingStatus: 'exact', kind,
      ...(kind === 'comment' ? {comment} : {detail})
    }))
  };
}
