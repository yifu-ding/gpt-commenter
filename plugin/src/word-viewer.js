import {renderAsync} from 'docx-preview';
import createDOMPurify from 'dompurify';
import JSZip from 'jszip';

export const WORD_MIN_ZOOM = 0.5;
export const WORD_MAX_ZOOM = 16;
export async function renderWordPreview(data, doc = document) {
  try {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    if (bytes.length > 20 * 1024 * 1024) throw Error("Word previews are limited to 20 MB.");
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files);
    const expanded = entries.reduce((size, entry) => size + (entry._data?.uncompressedSize || 0), 0);
    if (entries.length > 5e3 || expanded > 100 * 1024 * 1024) throw Error("The expanded Word document exceeds the preview limit.");
    if (!zip.file("word/document.xml") || !zip.file("[Content_Types].xml")) throw Error("This is not a valid DOCX document.");
    const body = doc.createElement("div"), styles = doc.createElement("div");
    await renderAsync(bytes, body, styles, {
      className: "word-page",
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderAltChunks: false,
      renderComments: false,
      renderChanges: false,
      experimental: false
    });
    const purifier = createDOMPurify(doc.defaultView);
    const fragment = purifier.sanitize(`${styles.innerHTML}${body.innerHTML}`, {
      RETURN_DOM_FRAGMENT: true,
      FORCE_BODY: true,
      ADD_TAGS: ["style"],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "base", "video", "audio"],
      FORBID_ATTR: ["srcset"]
    });
    for (const anchor of fragment.querySelectorAll("a")) {
      if (!anchor.getAttribute("href")?.startsWith("#")) anchor.removeAttribute("href");
      anchor.removeAttribute("target");
    }
    const safe = doc.createElement("div");
    safe.append(fragment);
    const text = indexWordText(safe).text;
    if (text.length > 5 * 1024 * 1024) throw Error("Extracted Word text exceeds 5 MB.");
    const digest = await doc.defaultView.crypto.subtle.digest("SHA-256", bytes);
    const fingerprint = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:#eef0f3;color:#222;font-family:Arial,sans-serif}body{overflow:auto}.word-page-wrapper{display:flex!important;flex-direction:column!important;align-items:center!important;gap:24px!important;padding:24px!important;box-sizing:border-box!important;background:transparent!important;min-width:100%}section.word-page{margin:0!important;transform-origin:top left;box-shadow:none!important}.word-frame{position:relative;flex-shrink:0;box-sizing:content-box;background:white;border:1px solid #cdd3dc;border-radius:3px;box-shadow:0 3px 18px #00000012;overflow:hidden}img{max-width:100%}a{color:#3977c6;text-decoration:underline}.word-review-overlay{position:absolute;inset:0;z-index:10;pointer-events:none}.word-review-highlight{position:absolute;background:transparent;border-bottom:2px solid #888;border-radius:0}.word-review-note{position:absolute;pointer-events:auto;border:1px solid #91b9ed;background:#e4f0ff;color:#245c9e;border-radius:4px;font:11px system-ui;cursor:pointer}</style></head><body>${safe.innerHTML}</body></html>`;
    return { html: html, text: text, fingerprint };
  } catch (error) {
    throw Error(`Cannot render Word document: ${error.message}`);
  }
}
export function indexWordText(root) {
  const doc = root.ownerDocument, walker = doc.createTreeWalker(root, 4), entries = [];
  let text = "", previousBlock = null, node2;
  while (node2 = walker.nextNode()) {
    if (!node2.nodeValue || node2.parentElement.closest("style,script,.word-review-overlay")) continue;
    const block = node2.parentElement.closest("p,td,th,header,footer") || node2.parentElement;
    if (previousBlock && block !== previousBlock) text += "\n";
    const start = text.length;
    text += node2.nodeValue;
    entries.push({ node: node2, start, end: text.length });
    previousBlock = block;
  }
  return { text: text, entries: entries };
}
export function createWordViewer(container, { onSelection, onNote, onDismiss = () => {
}, onZoom = () => {
}, onPage = () => {
} }) {
  let current = null, frame = null, index = null, notes = [], pages = [], zoom = 1, currentPage = 1;
  function updatePage() {
    if (!frame || !pages.length) return;
    let best = -1;
    pages.forEach(({ outer }, i) => {
      const r = outer.getBoundingClientRect(), visible = Math.max(0, Math.min(r.bottom, frame.contentWindow.innerHeight) - Math.max(r.top, 0));
      if (visible > best) {
        best = visible;
        currentPage = i + 1;
      }
    });
    onPage(currentPage, pages.length);
  }
  function layout() {
    if (!frame || !pages.length) return;
    const available = Math.max(100, (frame.contentDocument.documentElement.clientWidth || frame.clientWidth || container.clientWidth || 900) - 48);
    let widest = available;
    for (const page of pages) {
      const scale = Math.min(1, available / page.width) * zoom, width = page.width * scale;
      page.element.style.transform = `scale(${scale})`;
      page.outer.style.width = `${width}px`;
      page.outer.style.height = `${page.height * scale}px`;
      widest = Math.max(widest, width);
    }
    const stack = frame.contentDocument.querySelector(".word-page-wrapper");
    if (stack) stack.style.width = `${widest + 48}px`;
    marks();
    updatePage();
  }
  function setZoom(value, point3) {
    if (!Number.isFinite(value)) return;
    const next = Math.max(WORD_MIN_ZOOM, Math.min(WORD_MAX_ZOOM, value));
    if (next === zoom) return;
    const win = frame?.contentWindow;
    point3 ??= win ? { x: win.innerWidth / 2, y: win.innerHeight / 2 } : null;
    let anchor2 = null, distance = Infinity;
    if (point3) for (const page of pages) {
      const r = page.outer.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const d = Math.max(r.top - point3.y, 0, point3.y - r.bottom);
      if (d < distance) {
        distance = d;
        anchor2 = { page, x: (point3.x - r.left) / r.width, y: (point3.y - r.top) / r.height };
      }
    }
    zoom = next;
    onDismiss();
    layout();
    if (anchor2) {
      const r = anchor2.page.outer.getBoundingClientRect();
      win.scrollBy({ left: r.left + anchor2.x * r.width - point3.x, top: r.top + anchor2.y * r.height - point3.y, behavior: "instant" });
    }
    onZoom(zoom);
    updatePage();
  }
  function wheelZoom(event) {
    if (!frame || !event.deltaY) return;
    event.preventDefault();
    const win = frame.contentWindow, inside = event.target?.ownerDocument === frame.contentDocument;
    const point3 = inside ? { x: event.clientX, y: event.clientY } : { x: win.innerWidth / 2, y: win.innerHeight / 2 };
    const amount = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? win.innerHeight : 1);
    setZoom(zoom * Math.exp(-Math.max(-100, Math.min(100, amount)) * 45e-4), point3);
  }
  const anchor = (rect) => {
    const outer = frame.getBoundingClientRect();
    return { left: outer.left + rect.left, right: outer.left + rect.right, top: outer.top + rect.top, bottom: outer.top + rect.bottom, width: rect.width, height: rect.height };
  };
  function marks() {
    if (!index || !frame.contentDocument?.body) return;
    const doc = frame.contentDocument, win = frame.contentWindow;
    doc.querySelector(".word-review-overlay")?.remove();
    const overlay = doc.createElement("div");
    overlay.className = "word-review-overlay";
    doc.body.append(overlay);
    for (const note of notes) {
      const first = index.entries.find((entry) => entry.end > note.startOffset), last2 = index.entries.findLast((entry) => entry.start < note.endOffset);
      if (!first || !last2 || note.endOffset <= note.startOffset) continue;
      const range = doc.createRange();
      range.setStart(first.node, Math.max(0, note.startOffset - first.start));
      range.setEnd(last2.node, Math.min(last2.node.length, note.endOffset - last2.start));
      const rects = Array.from(range.getClientRects());
      for (const rect2 of rects) {
        const mark = doc.createElement("span");
        mark.className = "word-review-highlight";
        Object.assign(mark.style, { left: `${rect2.left + win.scrollX}px`, top: `${rect2.top + win.scrollY}px`, width: `${rect2.width}px`, height: `${rect2.height}px` });
        if(!note.temporary){mark.dataset.annotation=note.id;mark.tabIndex=0;mark.setAttribute('role','button');mark.setAttribute('aria-label','Open Word review note');const activate=event=>{event.stopPropagation();onNote(note,anchor(mark.getBoundingClientRect()));};mark.addEventListener('click',activate);mark.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();activate(event);}});}
        overlay.append(mark);
      }

    }
  }
  function capture(event) {
    if (event.target.closest?.(".word-review-overlay")) return;
    const selected = frame.contentWindow.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) return;
    const range = selected.getRangeAt(0);
    function endpoint(node2, offset, end2) {
      const direct = index.entries.find((entry) => entry.node === node2);
      if (direct) return direct.start + offset;
      const child = node2.childNodes[end2 ? offset - 1 : offset];
      if (!child) return null;
      const candidates = index.entries.filter((entry) => child === entry.node || child.contains?.(entry.node));
      return end2 ? candidates.at(-1)?.end : candidates[0]?.start;
    }
    const start = endpoint(range.startContainer, range.startOffset, false), end = endpoint(range.endContainer, range.endOffset, true);
    if (start == null || end == null || end <= start) return;
    const rect = Array.from(range.getClientRects()).at(-1);
    if (!rect) return;
    onSelection({ startOffset: start, endOffset: end, startLine: index.text.slice(0, start).split("\n").length, endLine: index.text.slice(0, end - 1).split("\n").length, selectedText: index.text.slice(start, end), mappingStatus: "exact", word: { fingerprint: current.fingerprint } }, anchor(rect));
  }
  return {
    show(preview, items2) {
      notes = items2;
      if (current === preview && frame?.isConnected) {
        marks();
        return;
      }
      current = preview;
      index = null;
      pages = [];
      currentPage = 1;
      container.replaceChildren();
      frame = container.ownerDocument.createElement("iframe");
      frame.className = "word-preview";
      frame.title = "Word document preview";
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.referrerPolicy = "no-referrer";
      const expectedFrame = frame;
      frame.addEventListener("load", () => {
        if (current !== preview || frame !== expectedFrame || !frame?.contentDocument?.body) return;
        index = indexWordText(frame.contentDocument.body);
        const doc = frame.contentDocument;
        pages = Array.from(doc.querySelectorAll("section.word-page"), (element, i) => {
          const outer = element.parentElement.classList.contains("word-frame") ? element.parentElement : doc.createElement("div");
          outer.className = "word-frame";
          outer.dataset.wordPage = i + 1;
          outer.setAttribute("aria-label", `Word page ${i + 1}`);
          if (element.parentElement !== outer) {
            element.before(outer);
            outer.append(element);
          }
          const width = element.offsetWidth || parseFloat(element.style.width) * 4 / 3 || 816, height = element.offsetHeight || parseFloat(element.style.minHeight) * 4 / 3 || 1056;
          return { element: element, outer, width, height };
        });
        currentPage = 1;
        layout();
        onZoom(zoom);
        frame.contentDocument.addEventListener("pointerdown", (event) => {
          if (!event.target.closest?.(".word-review-overlay")) onDismiss();
        });
        frame.contentDocument.addEventListener('click',event=>{if(!frame.contentWindow.getSelection()?.isCollapsed || event.target.closest?.('.word-review-overlay'))return;const marks=[...frame.contentDocument.querySelectorAll('.word-review-highlight[data-annotation]')].reverse();const mark=marks.find(node=>{const r=node.getBoundingClientRect();return event.clientX>=r.left && event.clientX<=r.right && event.clientY>=r.top && event.clientY<=r.bottom;});mark?.click();});
        frame.contentDocument.addEventListener("pointerup", capture);
        frame.contentDocument.addEventListener("keyup", capture);
        frame.contentDocument.addEventListener("keydown", (event) => {
          if (event.key === "Escape") onDismiss();
        });
        frame.contentDocument.addEventListener("wheel", (event) => {
          if (event.ctrlKey || event.metaKey) wheelZoom(event);
        }, { passive: false });
        frame.contentWindow.addEventListener("resize", layout);
        frame.contentWindow.addEventListener("scroll", updatePage, { passive: true });
        marks();
      });
      frame.srcdoc = preview.html;
      container.append(frame);
    },
    destroy() {
      current = null;
      index = null;
      frame?.remove();
      frame = null;
      notes = [];
      pages = [];
    },
    setZoom,
    wheelZoom,
    zoom: () => zoom,
    currentPage: () => currentPage,
    goToPage(number) {
      const page = pages[Math.max(1, Math.min(pages.length, number)) - 1];
      if (page) frame.contentWindow.scrollTo({ top: page.outer.getBoundingClientRect().top + frame.contentWindow.scrollY - 24, left: frame.contentWindow.scrollX, behavior: "smooth" });
    }
  };
}
