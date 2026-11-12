// 无头浏览器画面与 f(t) 纯函数规范自动巡检工具（404/破损图/无限 @keyframes/拖拽幂等/舞台溢出/字幕遮挡/字数密度）
// 用法：node tools/audit-visual.mjs [video-id ...] [--strict] [--lang en]
import { ROOT, listVideoIds, loadVideoSandbox, loadChromium, findBrowserExecutable } from './lib/paths.mjs';
import { startEphemeralVideoServer } from './lib/http-static.mjs';

function buildSamplePoints(V) {
  const pts = [];
  V.scenes.forEach((sc, si) => {
    if (sc.cues && sc.cues.length) {
      sc.cues.forEach((c, li) => {
        pts.push({ t: Math.min(sc.start + sc.duration - 0.05, sc.start + (c.start + c.end) / 2), label: `S${si}L${li}`, isMid: li === 0 });
      });
    } else {
      pts.push({ t: sc.start + sc.duration * 0.5, label: `S${si}`, isMid: true });
    }
  });
  return pts;
}

const IN_PAGE_CSS_AUDIT = () => {
  const stage = document.getElementById('stage');
  if (stage && document.body.classList.contains('record')) {
    const probe = document.createElement('i');
    stage.appendChild(probe);
    const locked = getComputedStyle(probe).animationPlayState === 'paused';
    probe.remove();
    if (locked) return [];
  }
  const inf = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of Array.from(rules || [])) {
      if (r.style && (r.style.animationIterationCount === 'infinite' || /\binfinite\b/.test(r.style.animation || ''))) {
        inf.push(r.selectorText || '<rule>');
      }
    }
  }
  return inf;
};

const IN_PAGE_SCRUB_CHECK = async ({ sampleT, altT }) => {
  const snap = () => {
    const sc = document.querySelector('#stage .scene');
    if (!sc) return '';
    return Array.from(sc.querySelectorAll('*')).slice(0, 80)
      .map(el => `${el.tagName}:${el.className}:${el.style.opacity}:${el.style.transform}:${el.textContent?.slice(0, 20)}`)
      .join('|');
  };
  await window.V.seekToAsync(sampleT);
  const a = snap();
  await window.V.seekToAsync(altT);
  await window.V.seekToAsync(sampleT);
  return a === snap();
};

function installPageAuditHelpers() {
  const isVisible = (el, minAlpha) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    return parseFloat(cs.opacity || '1') >= minAlpha;
  };
  const rectAreaOverlap = (a, b) => {
    const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return ix * iy;
  };
  const isOutOfRect = (r, sRect, tol) => {
    if (r.left < sRect.left - tol || r.right > sRect.right + tol) return true;
    return r.top < sRect.top - tol || r.bottom > sRect.bottom + tol;
  };
  window.__auditH = { isVisible, rectAreaOverlap, isOutOfRect };
}

const IN_PAGE_BROKEN_IMGS = () => {
  const stage = document.getElementById('stage');
  if (!stage) return [];
  return Array.from(stage.querySelectorAll('img'))
    .filter(img => !img.complete || img.naturalWidth === 0)
    .map(img => img.getAttribute('src') || '<img/>');
};

const IN_PAGE_CHAR_COUNT = () => {
  const sc = document.querySelector('#stage .scene');
  if (!sc) return 0;
  let charCount = 0;
  const walker = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement && window.__auditH.isVisible(node.parentElement, 0.1)) {
      charCount += (node.nodeValue || '').replace(/\s+/g, '').length;
    }
  }
  return charCount;
};

const IN_PAGE_OVERFLOWS = () => {
  const stage = document.getElementById('stage');
  const sc = stage ? stage.querySelector('.scene') : null;
  if (!stage || !sc) return [];
  const sRect = stage.getBoundingClientRect();
  const tol = 28 * (sRect.width / (stage.offsetWidth || 1920) || 1);
  const overflows = [];
  for (const el of Array.from(sc.children)) {
    if (!window.__auditH.isVisible(el, 0.15)) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 2 && r.height >= 2 && window.__auditH.isOutOfRect(r, sRect, tol)) {
      overflows.push(el.className || el.tagName);
    }
  }
  return overflows;
};

const IN_PAGE_SUB_OVERLAPS = () => {
  const stage = document.getElementById('stage');
  const subs = document.getElementById('subs');
  const sc = stage ? stage.querySelector('.scene') : null;
  if (!stage || !subs || !sc || !window.__auditH.isVisible(subs, 0.16)) return [];
  const sRect = stage.getBoundingClientRect();
  const subRect = subs.getBoundingClientRect();
  const minArea = subRect.width * subRect.height * 0.35;
  const overlaps = [];
  for (const el of Array.from(sc.children)) {
    if (!window.__auditH.isVisible(el, 0.15) || getComputedStyle(el).position === 'static') continue;
    const r = el.getBoundingClientRect();
    if (r.height < sRect.height * 0.85 && el.textContent.trim().length > 8 && window.__auditH.rectAreaOverlap(r, subRect) > minArea) {
      overlaps.push(el.className || el.tagName);
    }
  }
  return overlaps;
};

async function inspectSamplePoint(page, pt, duration, vErrors, vWarnings) {
  await page.evaluate(s => window.V.seekToAsync(s), pt.t);
  const [brokenImgs, charCount, overflows, subOverlaps] = await Promise.all([
    page.evaluate(IN_PAGE_BROKEN_IMGS),
    page.evaluate(IN_PAGE_CHAR_COUNT),
    page.evaluate(IN_PAGE_OVERFLOWS),
    page.evaluate(IN_PAGE_SUB_OVERLAPS),
  ]);
  for (const src of brokenImgs) vErrors.push(`${pt.label}: Broken <img> "${src}"`);
  for (const cls of overflows) vWarnings.push(`${pt.label}: Element "${cls}" overflows stage bounds`);
  for (const cls of subOverlaps) vWarnings.push(`${pt.label}: Element "${cls}" overlaps #subs safe zone`);
  if (charCount > 240) vWarnings.push(`${pt.label}: High on-screen text density (${charCount} chars > 240)`);
  if (pt.isMid) {
    const altT = Math.min(duration - 0.05, Math.max(0, pt.t + 1.3));
    const ok = await page.evaluate(IN_PAGE_SCRUB_CHECK, { sampleT: pt.t, altT });
    if (!ok) vErrors.push(`${pt.label}: Non-idempotent f(t) DOM state after scrubbing`);
  }
}

async function auditSingleVideo(browser, port, id, lang) {
  const { sandbox } = loadVideoSandbox(ROOT, id, { ignoreBaked: false, requireTimings: false, lang });
  const V = sandbox.V;
  const cfg = Object.assign({}, V.themeDefaults || {}, V.config || {});
  const page = await browser.newPage({ viewport: { width: cfg.width || 1920, height: cfg.height || 1080 }, deviceScaleFactor: 1 });
  await page.addInitScript(installPageAuditHelpers);
  const vErrors = [], vWarnings = [];

  page.on('pageerror', err => vErrors.push(`Runtime error: ${err.message}`));
  page.on('response', resp => {
    if (resp.status() >= 400 && !resp.url().endsWith('soundtrack.m4a') && !resp.url().endsWith('favicon.ico')) {
      vErrors.push(`HTTP ${resp.status()}: ${resp.url()}`);
    }
  });

  const q = lang ? `?record=1&lang=${encodeURIComponent(lang)}` : '?record=1';
  await page.goto(`http://127.0.0.1:${port}/${id}/${q}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__video && window.V && window.V.seekToAsync, null, { timeout: 15000 });

  for (const sel of await page.evaluate(IN_PAGE_CSS_AUDIT)) {
    vErrors.push(`Forbidden infinite CSS animation on "${sel}"`);
  }
  for (const pt of buildSamplePoints(V)) {
    await inspectSamplePoint(page, pt, V.duration, vErrors, vWarnings);
  }
  await page.close();
  return { vErrors: [...new Set(vErrors)], vWarnings: [...new Set(vWarnings)], sceneCount: V.scenes.length };
}

function reportAuditResult(id, vErrors, vWarnings, sceneCount, strict) {
  const promoted = strict ? vWarnings : [];
  const finalErrs = [...vErrors, ...promoted];
  if (finalErrs.length) {
    console.error(`\n❌ [${id}] VISUAL & SPEC AUDIT FAILED (${finalErrs.length} issue(s)):`);
    for (const e of finalErrs) console.error(`  - ${e}`);
  } else if (vWarnings.length) {
    console.log(`⚠️  [${id}] Visual audit passed with ${vWarnings.length} warning(s):`);
    for (const w of vWarnings) console.log(`  ! ${w}`);
  } else {
    console.log(`✅ [${id}] Visual & f(t) determinism audit PASSED (${sceneCount} scenes).`);
  }
  return { errCount: finalErrs.length, warnCount: vWarnings.length };
}

export async function auditVideos(videoIds, { strict = false, lang = '' } = {}) {
  const targets = videoIds && videoIds.length ? videoIds : listVideoIds();
  if (!targets.length) return { errors: 0, warnings: 0 };

  const { srv, port } = await startEphemeralVideoServer();
  const chromium = await loadChromium(ROOT);
  const browser = await chromium.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });

  let totalErrors = 0, totalWarnings = 0;
  try {
    for (const id of targets) {
      const { vErrors, vWarnings, sceneCount } = await auditSingleVideo(browser, port, id, lang);
      const { errCount, warnCount } = reportAuditResult(id, vErrors, vWarnings, sceneCount, strict);
      totalErrors += errCount;
      totalWarnings += warnCount;
    }
  } finally {
    await browser.close();
    srv.close();
  }
  return { errors: totalErrors, warnings: totalWarnings };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('audit-visual.mjs');
if (isDirectRun) {
  const raw = process.argv.slice(2);
  const langIdx = raw.indexOf('--lang');
  const lang = langIdx >= 0 && raw[langIdx + 1] ? raw[langIdx + 1] : '';
  const ids = raw.filter((a, i) => !a.startsWith('--') && (langIdx < 0 || i !== langIdx + 1));
  const { errors } = await auditVideos(ids, { strict: raw.includes('--strict'), lang });
  if (errors > 0) process.exit(1);
}
