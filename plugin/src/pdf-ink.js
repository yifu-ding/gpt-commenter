export function weightPdfGlyphs(image, browserWindow) {
  if (!image.startsWith('data:image/svg+xml;base64,')) return image;
  const source = browserWindow.atob(image.slice(image.indexOf(',') + 1));
  const bytes = Uint8Array.from(source, character => character.charCodeAt(0));
  const svg = new browserWindow.DOMParser().parseFromString(new TextDecoder().decode(bytes), 'image/svg+xml');
  if (svg.querySelector('parsererror')) return image;
  let weighted = 0;
  for (const glyph of svg.querySelectorAll('use')) {
    if (!/^#glyph-/.test(glyph.getAttribute('href') || glyph.getAttribute('xlink:href') || '')) continue;
    const fill = glyph.closest('[fill]')?.getAttribute('fill');
    if (!fill || fill === 'none') continue;
    glyph.setAttribute('stroke', fill);
    glyph.setAttribute('stroke-width', '0.15');
    glyph.setAttribute('stroke-linejoin', 'round');
    glyph.setAttribute('paint-order', 'stroke fill');
    weighted++;
  }
  if (!weighted) return image;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new browserWindow.XMLSerializer().serializeToString(svg))}`;
}
