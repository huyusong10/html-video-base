// 一键分镜审阅单生成器（Storyboard Sheet）：按幕稳态或 --per-cue 逐句无头截帧，输出单文件 HTML（可选 --pdf）
// 用法：html-video storyboard [video-id] [out.html] [--per-cue] [--pdf] [--lang en]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, listVideoIds, loadVideoSandbox, loadChromium, findBrowserExecutable, getSandboxCfg } from './lib/paths.mjs';
import { startEphemeralVideoServer } from './lib/http-static.mjs';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtTime(s) {
  const sec = Math.max(0, Number(s) || 0);
  const m = Math.floor(sec / 60);
  const rem = (sec - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${rem}`;
}

function parseStoryboardArgs(rawArgs) {
  const langIdx = rawArgs.indexOf('--lang');
  const lang = langIdx >= 0 && rawArgs[langIdx + 1] ? rawArgs[langIdx + 1] : '';
  const pos = rawArgs.filter((a, i) => !a.startsWith('--') && (langIdx < 0 || i !== langIdx + 1));
  const defaultVideo = listVideoIds()[0] || 'starter';
  const firstIsHtml = Boolean(pos[0] && pos[0].endsWith('.html'));
  const videoId = firstIsHtml ? defaultVideo : (pos[0] || defaultVideo);
  const outHtml = firstIsHtml ? path.resolve(pos[0]) : path.resolve(pos[1] || path.join(ROOT, `${videoId}-storyboard.html`));
  return { videoId, outHtml, perCue: rawArgs.includes('--per-cue'), wantPdf: rawArgs.includes('--pdf'), lang };
}

async function captureShot(page, sampleT, quality) {
  await page.evaluate(s => window.V.seekToAsync(s), sampleT);
  const jpg = await page.screenshot({ type: 'jpeg', quality });
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

async function captureSceneCards(page, sc, si, perCue) {
  const cues = sc.cues || [];
  if (perCue && cues.length > 0) {
    const out = [];
    for (let li = 0; li < cues.length; li++) {
      const c = cues[li];
      const sampleT = sc.start + c.start + Math.min((c.end - c.start) * 0.72, Math.max(0.2, c.end - c.start - 0.1));
      out.push({
        idxLabel: `${String(si + 1).padStart(2, '0')}-${li + 1}`,
        title: sc.title,
        timeRange: `${fmtTime(sc.start + c.start)} – ${fmtTime(sc.start + c.end)}`,
        dur: `${(c.end - c.start).toFixed(1)}s`,
        imgData: await captureShot(page, sampleT, 82),
        lines: [{ idx: li, speaker: c.speaker, text: c.text }],
      });
    }
    return out;
  }
  const lastCue = cues.length ? cues[cues.length - 1] : null;
  const sampleT = lastCue ? sc.start + Math.min(sc.duration - 0.15, lastCue.end - 0.08) : sc.start + sc.duration * 0.6;
  return [{
    idxLabel: String(si + 1).padStart(2, '0'),
    title: sc.title,
    timeRange: `${fmtTime(sc.start)} – ${fmtTime(sc.start + sc.duration)}`,
    dur: `${sc.duration.toFixed(1)}s`,
    imgData: await captureShot(page, sampleT, 84),
    lines: cues.map((c, li) => ({ idx: li, speaker: c.speaker, text: c.text })),
  }];
}

function renderCardLinesHtml(lines) {
  if (!lines.length) return '<div class="empty">（纯视觉段落 · 无口播台词）</div>';
  const items = lines.map(l => {
    const spk = l.speaker ? `<span class="spk">${esc(l.speaker)}</span>` : '';
    return `<li><span class="lno">L${l.idx}</span>${spk}<span>${esc(l.text)}</span></li>`;
  }).join('');
  return `<ul class="lines">${items}</ul>`;
}

function buildStoryboardHtml({ title, W, H, sceneCount, totalLines, totalDur, cards }) {
  const cardsHtml = cards.map(c => `
    <section class="item">
      <img class="shot" src="${c.imgData}" alt="${esc(c.title)}">
      <div>
        <div class="hd">
          <div class="title"><span class="badge">#${esc(c.idxLabel)}</span>${esc(c.title)}</div>
          <div class="tc">${esc(c.timeRange)} (${esc(c.dur)})</div>
        </div>
        ${renderCardLinesHtml(c.lines)}
      </div>
    </section>`).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${esc(title)} · 分镜审阅单</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 28px; background: #F8FAFC; color: #0F172A; font: 14px/1.55 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    .wrap { max-width: 1180px; margin: 0 auto; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding-bottom: 14px; border-bottom: 2px solid #0F172A; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .meta { color: #475569; font-size: 13px; font-variant-numeric: tabular-nums; }
    .item { display: grid; grid-template-columns: 440px 1fr; gap: 22px; padding: 18px; margin-bottom: 14px; background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 8px; break-inside: avoid; }
    .shot { width: 100%; aspect-ratio: ${W} / ${H}; object-fit: cover; border: 1px solid #E2E8F0; border-radius: 4px; display: block; background: #0F172A; }
    .hd { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #F1F5F9; }
    .title { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .badge { padding: 2px 7px; border-radius: 4px; background: #0F172A; color: #FFF; font: 600 12px ui-monospace, Consolas, monospace; }
    .tc { color: #64748B; font: 12px ui-monospace, Consolas, monospace; }
    .lines { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .lines li { display: flex; gap: 8px; align-items: baseline; color: #1E293B; }
    .lno { color: #94A3B8; font: 12px ui-monospace, Consolas, monospace; flex: none; }
    .spk { padding: 1px 7px; border-radius: 999px; background: #EFF6FF; border: 1px solid #BFDBFE; color: #1D4ED8; font-size: 12px; font-weight: 600; flex: none; }
    .empty { color: #94A3B8; font-style: italic; }
    @media print { body { background: #FFF; padding: 0; } .item { border-color: #94A3B8; margin-bottom: 10px; padding: 12px; grid-template-columns: 320px 1fr; } }
  </style>
</head>
<body>
  <main class="wrap">
    <header>
      <h1>${esc(title)}</h1>
      <div class="meta">${W}×${H} · ${sceneCount} 幕 · ${totalLines} 句口播 · 总长 ${fmtTime(totalDur)}</div>
    </header>
    ${cardsHtml}
  </main>
</body>
</html>`;
}

async function exportPdfCopy(browser, outHtml) {
  const pdfPath = outHtml.replace(/\.html?$/i, '.pdf');
  const pdfPage = await browser.newPage();
  await pdfPage.goto(pathToFileURL(outHtml).href, { waitUntil: 'load' });
  await pdfPage.pdf({
    path: pdfPath,
    format: 'A4',
    landscape: true,
    printBackground: true,
    margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
  });
  await pdfPage.close();
  console.log(`✅ Storyboard PDF written: ${pdfPath}`);
}

const args = parseStoryboardArgs(process.argv.slice(2));
const { sandbox } = loadVideoSandbox(ROOT, args.videoId, { ignoreBaked: false, requireTimings: false, lang: args.lang });
const cfg = getSandboxCfg(sandbox.V);
const W = cfg.width || 1920;
const H = cfg.height || 1080;
const scenes = sandbox.V.scenes || [];

const { srv, port } = await startEphemeralVideoServer();
const chromium = await loadChromium(ROOT);
const browser = await chromium.launch({
  executablePath: findBrowserExecutable(),
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});

try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const langQuery = args.lang ? `&lang=${encodeURIComponent(args.lang)}` : '';
  await page.goto(`http://127.0.0.1:${port}/${args.videoId}/?record=1&nosubs=1${langQuery}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));

  const cards = [];
  for (let si = 0; si < scenes.length; si++) {
    cards.push(...(await captureSceneCards(page, scenes[si], si, args.perCue)));
  }
  await page.close();

  const totalLines = scenes.reduce((a, s) => a + (s.cues ? s.cues.length : 0), 0);
  const html = buildStoryboardHtml({
    title: cfg.title || args.videoId,
    W,
    H,
    sceneCount: scenes.length,
    totalLines,
    totalDur: sandbox.V.duration || 0,
    cards,
  });

  fs.mkdirSync(path.dirname(args.outHtml), { recursive: true });
  fs.writeFileSync(args.outHtml, html, 'utf8');
  console.log(`✅ Storyboard written (${cards.length} shots): ${args.outHtml}`);
  if (args.wantPdf) await exportPdfCopy(browser, args.outHtml);
} finally {
  await browser.close();
  srv.close();
}
