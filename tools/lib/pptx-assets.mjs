import fs from 'node:fs';
import path from 'node:path';

export const PPTX_ASSETS = Object.freeze({
  image: 'assets/presentation.pptx',
  editable: 'assets/presentation-editable.pptx',
});
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function readPageWithPptxDownload(courseDir) {
  const files = Object.entries(PPTX_ASSETS).filter(([, asset]) =>
    fs.statSync(path.join(courseDir, asset), { throwIfNoEntry: false })?.isFile());
  if (!files.length) return null;
  const entry = path.join(courseDir, 'index.html');
  if (!fs.existsSync(entry)) return null;

  const html = fs.readFileSync(entry, 'utf8');
  const links = files.map(([mode, asset]) =>
    `<link rel="alternate" type="${PPTX_MIME}" data-pptx-mode="${mode}" href="./${asset}">`)
    .filter(link => !html.includes(link));
  if (!links.length) return null;
  const metadata = links.join('\n') + '\n';
  const headEnd = /<\/head\s*>/i;
  return headEnd.test(html)
    ? html.replace(headEnd, metadata + '$&')
    : html.replace(/^(\s*<!doctype[^>]*>\s*)?(<html\b[^>]*>\s*)?/i, '$&' + metadata);
}
