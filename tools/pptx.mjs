import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import PptxGenJS from 'pptxgenjs';
import { withAuditSession } from './audit-session.mjs';
import { writeFileAtomic } from './lib/file-output.mjs';
import { ROOT, VIDEOS_DIR, isMainModule, listVideoIds, normalizeCliArgs } from './lib/paths.mjs';
import { PPTX_ASSETS } from './lib/pptx-assets.mjs';
import { addEditableObjects, normalizeEditableCharts, prepareEditablePage } from './lib/pptx-editable.mjs';

function selectPages(pages, specification) {
  if (specification === undefined) return pages;
  const selected = new Set();
  for (const entry of specification.split(',')) {
    const range = /^(\d+)(?:-(\d+))?$/.exec(entry.trim());
    if (!range) throw new Error(`Invalid PPT page selection "${entry}". Use a list such as 1,3-5.`);
    const first = Number(range[1]);
    const last = Number(range[2] ?? range[1]);
    if (first < 1 || last < first || last > pages.length) {
      throw new Error(`PPT page selection "${entry}" is outside 1-${pages.length} or its bounds are reversed.`);
    }
    for (let pageNo = first; pageNo <= last; pageNo++) selected.add(pageNo);
  }
  return pages.filter(page => selected.has(page.pageNo));
}

async function captureEditableSlide(video, time) {
  await video.seek(time);
  const prepared = await video.page.evaluateHandle(prepareEditablePage);
  try {
    const objects = await prepared.evaluate(result => result.objects);
    const image = await video.page.screenshot({ type: 'png', caret: 'initial' });
    return { image, objects };
  } finally {
    try { await prepared.evaluate(result => result.restore()); }
    finally { await prepared.dispose(); }
  }
}

async function addSlide(deck, video, page, size, mode, scale) {
  try {
    await video.page.evaluate(pageNo => V.player.goToPage(pageNo), page.pageNo);
    const { image, objects = [] } = mode === 'editable'
      ? await captureEditableSlide(video, page.globalT)
      : await video.capture(page.globalT);
    const slide = deck.addSlide();
    slide.addImage({ data: `image/png;base64,${image.toString('base64')}`, x: 0, y: 0, w: size.width, h: size.height });
    addEditableObjects(slide, objects, scale);
    if (page.text) slide.addNotes(page.text);
  } catch (error) {
    throw new Error(`Cannot export PPT page ${page.pageNo} at ${page.globalT.toFixed(3)}s: ${error.message}`, { cause: error });
  }
}

export async function exportPptx({ videoId, output, pages: specification, lang, mode = 'image', projectRoot = ROOT }) {
  if (!Object.hasOwn(PPTX_ASSETS, mode)) throw new Error(`Unknown PPTX mode "${mode}". Use image or editable.`);
  const deck = new PptxGenJS();
  const count = await withAuditSession({ projectRoot }, async audit => {
    const video = await audit.openVideo(videoId, { mode: 'ppt-capture', lang });
    const layout = await video.page.evaluate(() => ({
      enabled: V.environment.pptMode,
      width: V.stageWidth,
      height: V.stageHeight,
      pages: V.player.getPptPages(),
    }));
    if (!layout.enabled) throw new Error(`Enable PPT mode (ppt: true) for "${videoId}" before exporting.`);
    if (!layout.pages.length) throw new Error(`"${videoId}" has no PPT pages to export.`);
    const pages = selectPages(layout.pages, specification);
    const size = { width: 40 / 3, height: (40 / 3) * layout.height / layout.width };
    deck.defineLayout({ name: 'COURSE', ...size });
    deck.layout = 'COURSE';
    deck.title = video.metadata.title || videoId;
    await video.page.setViewportSize({ width: layout.width, height: layout.height });
    for (const page of pages) await addSlide(deck, video, page, size, mode, size.width / layout.width);
    if (video.issues.length) {
      throw new Error(`Cannot export "${videoId}": ${video.issues.map(issue => issue.message).join('\n')}`);
    }
    return pages.length;
  });
  const bytes = await deck.write({ outputType: 'nodebuffer', compression: true });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  writeFileAtomic(output, mode === 'editable' ? await normalizeEditableCharts(bytes) : bytes);
  return count;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: normalizeCliArgs(process.argv.slice(2)),
    allowPositionals: true,
    options: { pages: { type: 'string' }, lang: { type: 'string' }, mode: { type: 'string' }, publish: { type: 'boolean' } },
  });
  const [videoId, requestedOutput] = positionals;
  const { publish, pages, lang, mode = 'image' } = values;
  if (!videoId || positionals.length > 2 || (requestedOutput && !/\.pptx$/i.test(requestedOutput))) {
    throw new Error('Usage: html-video pptx <video-id> [out.pptx | --publish] [--mode image|editable] [--pages 1,3-5] [--lang en]');
  }
  if (!listVideoIds().includes(videoId)) throw new Error(`Unknown video "${videoId}".`);
  if (!Object.hasOwn(PPTX_ASSETS, mode)) throw new Error(`Unknown PPTX mode "${mode}". Use image or editable.`);
  if (publish && requestedOutput) throw new Error('Use either an output path or --publish.');
  const suffix = mode === 'editable' ? '-editable' : '';
  let output = path.join(ROOT, 'dist', 'pptx', `${videoId}${suffix}.pptx`);
  if (requestedOutput) output = path.resolve(requestedOutput);
  if (publish) output = path.join(VIDEOS_DIR, videoId, PPTX_ASSETS[mode]);
  const count = await exportPptx({ videoId, output, pages, lang, mode });
  console.log(`Exported ${count} slides to ${output}`);
}

if (isMainModule(import.meta.url)) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
