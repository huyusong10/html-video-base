// 无头浏览器画面与 f(t) 纯函数规范自动巡检工具
// 覆盖：404/破损图/无限 @keyframes/拖拽幂等/舞台溢出/字幕遮挡/兄弟卡片压盖/最小字号下限/问题帧自动截图
// 用法：node tools/audit-visual.mjs [video-id ...] [--strict] [--lang en] [--screenshots .runtime/audit]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, listVideoIds, loadVideoSandbox, loadChromium, findBrowserExecutable, getSandboxCfg, localizeMediaRel } from './lib/paths.mjs';
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
    const subs = document.getElementById('subs');
    const subMeta = subs ? `${subs.dataset.subPos || ''}:${subs.style.cssText}:${subs.textContent?.slice(0, 24)}` : '';
    const nodes = Array.from(sc.querySelectorAll('*')).slice(0, 80)
      .map(el => `${el.tagName}:${el.className}:${el.style.cssText}:${el.textContent?.slice(0, 20)}`)
      .join('|');
    return `${sc.style.cssText}|${subMeta}|${nodes}`;
  };
  await window.V.seekToAsync(sampleT);
  const a = snap();
  await window.V.seekToAsync(altT);
  await window.V.seekToAsync(sampleT);
  return a === snap();
};

function installPageAuditHelpers() {
  const effectiveAlpha = el => {
    let cur = el;
    let alpha = 1;
    const stage = document.getElementById('stage');
    while (cur && cur.nodeType === 1) {
      const cs = getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      alpha *= parseFloat(cs.opacity || '1');
      if (alpha < 0.02 || cur === stage) break;
      cur = cur.parentElement;
    }
    return alpha;
  };
  const isVisible = (el, minAlpha) => effectiveAlpha(el) >= minAlpha;
  const rectAreaOverlap = (a, b) => {
    const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return ix * iy;
  };
  const isOutOfRect = (r, sRect, tol) => {
    if (r.left < sRect.left - tol || r.right > sRect.right + tol) return true;
    return r.top < sRect.top - tol || r.bottom > sRect.bottom + tol;
  };
  const labelOf = el => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return cls ? `.${cls}` : el.tagName.toLowerCase();
  };
  const collectAuditBoxes = (root, sRect, depth = 0, out = []) => {
    for (const el of Array.from(root.children)) {
      if (!isVisible(el, 0.15)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const isFull = r.width >= sRect.width * 0.85 && r.height >= sRect.height * 0.85;
      if (isFull && el.children.length > 0 && depth < 2) collectAuditBoxes(el, sRect, depth + 1, out);
      else out.push({ el, r });
    }
    return out;
  };
  window.__auditH = { effectiveAlpha, isVisible, rectAreaOverlap, isOutOfRect, labelOf, collectAuditBoxes };
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
    if (node.parentElement && window.__auditH.isVisible(node.parentElement, 0.15)) {
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
  for (const { el, r } of window.__auditH.collectAuditBoxes(sc, sRect)) {
    if (window.__auditH.isOutOfRect(r, sRect, tol)) overflows.push(window.__auditH.labelOf(el));
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
  for (const { el, r } of window.__auditH.collectAuditBoxes(sc, sRect)) {
    if (getComputedStyle(el).position === 'static') continue;
    if (r.height < sRect.height * 0.85 && el.textContent.trim().length > 8 && window.__auditH.rectAreaOverlap(r, subRect) > minArea) {
      overlaps.push(window.__auditH.labelOf(el));
    }
  }
  return overlaps;
};

const IN_PAGE_SIBLING_COLLISIONS = () => {
  const stage = document.getElementById('stage');
  const sc = stage ? stage.querySelector('.scene') : null;
  if (!stage || !sc) return [];
  const H = window.__auditH;
  const sRect = stage.getBoundingClientRect();
  const stageArea = Math.max(1, sRect.width * sRect.height);

  const isCandidateBox = (el, r) => {
    if (el.hasAttribute('data-allow-overlap') || !H.isVisible(el, 0.35)) return false;
    if (r.width < 90 || r.height < 38 || r.width * r.height > stageArea * 0.68) return false;
    return (el.textContent || '').trim().length >= 2;
  };

  const checkContainer = parent => {
    const boxes = [];
    for (const el of Array.from(parent.children)) {
      const r = el.getBoundingClientRect();
      if (isCandidateBox(el, r)) boxes.push({ el, r, area: r.width * r.height });
    }
    const hits = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const inter = H.rectAreaOverlap(boxes[i].r, boxes[j].r);
        const ratio = inter / Math.min(boxes[i].area, boxes[j].area);
        if (ratio > 0.18) hits.push(`${H.labelOf(boxes[i].el)} ↔ ${H.labelOf(boxes[j].el)} (${Math.round(ratio * 100)}%)`);
      }
    }
    return hits;
  };

  const containers = [sc, ...Array.from(sc.children).filter(c => H.isVisible(c, 0.35))];
  const collisions = [];
  for (const c of containers) collisions.push(...checkContainer(c));
  return collisions.slice(0, 4);
};

const IN_PAGE_SMALL_FONTS = minFontPx => {
  if (!minFontPx || minFontPx <= 0) return [];
  const sc = document.querySelector('#stage .scene');
  if (!sc) return [];
  const H = window.__auditH;
  const seen = new Set();
  const issues = [];
  const checkNode = node => {
    const txt = (node.nodeValue || '').trim();
    const el = node.parentElement;
    if (!txt || !el || el.closest('[data-allow-small-font], pre, code') || !H.isVisible(el, 0.25)) return;
    const px = parseFloat(getComputedStyle(el).fontSize || '18');
    if (px >= minFontPx - 0.5) return;
    const key = `${H.labelOf(el)}:${Math.round(px)}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(`${H.labelOf(el)} (${Math.round(px)}px < ${minFontPx}px: "${txt.slice(0, 14)}")`);
    }
  };
  const walker = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode()) && issues.length < 3) checkNode(node);
  return issues;
};

async function maybeCaptureIssueShot(page, screenshotDir, id, label, savedShots) {
  if (!screenshotDir) return;
  fs.mkdirSync(screenshotDir, { recursive: true });
  const out = path.join(screenshotDir, `${id}-${label}.png`);
  await page.screenshot({ path: out });
  savedShots.push(out);
}

async function inspectSamplePoint(page, ctx, pt) {
  const { id, duration, minFontPx, screenshotDir, vErrors, vWarnings, savedShots } = ctx;
  const errBefore = vErrors.length;
  const warnBefore = vWarnings.length;

  await page.evaluate(s => window.V.seekToAsync(s), pt.t);
  const [brokenImgs, charCount, overflows, subOverlaps, collisions, smallFonts] = await Promise.all([
    page.evaluate(IN_PAGE_BROKEN_IMGS),
    page.evaluate(IN_PAGE_CHAR_COUNT),
    page.evaluate(IN_PAGE_OVERFLOWS),
    page.evaluate(IN_PAGE_SUB_OVERLAPS),
    page.evaluate(IN_PAGE_SIBLING_COLLISIONS),
    page.evaluate(IN_PAGE_SMALL_FONTS, minFontPx),
  ]);

  for (const src of brokenImgs) vErrors.push(`${pt.label}: Broken <img> "${src}"`);
  for (const cls of overflows) vWarnings.push(`${pt.label}: Element "${cls}" overflows stage bounds`);
  for (const cls of subOverlaps) vWarnings.push(`${pt.label}: Element "${cls}" overlaps #subs safe zone`);
  for (const pair of collisions) vWarnings.push(`${pt.label}: Sibling layout overlap ${pair}`);
  for (const sf of smallFonts) vWarnings.push(`${pt.label}: Small font ${sf}`);
  if (charCount > 240) vWarnings.push(`${pt.label}: High on-screen text density (${charCount} chars > 240)`);

  if (pt.isMid) {
    const fwdT = pt.t + 1.3;
    const altT = fwdT <= duration - 0.05 ? fwdT : (pt.t >= 0.3 ? Math.max(0, pt.t - 1.3) : Math.max(0, duration - 0.05));
    const ok = await page.evaluate(IN_PAGE_SCRUB_CHECK, { sampleT: pt.t, altT });
    if (!ok) vErrors.push(`${pt.label}: Non-idempotent f(t) DOM state after scrubbing`);
  }
  if (vErrors.length > errBefore || vWarnings.length > warnBefore) {
    await maybeCaptureIssueShot(page, screenshotDir, id, pt.label, savedShots);
  }
}

function collectConfiguredOptSuffixes(cfg, lang = '') {
  const out = [];
  for (const raw of [cfg.audioSrc, cfg.bgmSrc, cfg.timingsScript]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const clean = '/' + raw.trim().replace(/^\.?\//, '').replace(/\\/g, '/');
    out.push(clean);
    if (lang) out.push(localizeMediaRel(clean, lang));
  }
  return out;
}

function isOptionalAuditResponse(urlStr, optSuffixes) {
  let pathname = urlStr;
  try { pathname = new URL(urlStr).pathname; } catch {}
  if (/\/(soundtrack|bgm)(\.[a-z0-9_-]+)?\.(m4a|mp3|wav|ogg)$/i.test(pathname)) return true;
  if (/\/timings(\.[a-z0-9_-]+)?\.js$/i.test(pathname)) return true;
  if (pathname.endsWith('/favicon.ico')) return true;
  return optSuffixes.some(sfx => pathname.endsWith(sfx));
}

async function auditSingleVideo(browser, port, id, opts) {
  const { lang = '', screenshotDir = '' } = opts;
  const { sandbox } = loadVideoSandbox(ROOT, id, { ignoreBaked: false, requireTimings: false, lang });
  const V = sandbox.V;
  const cfg = getSandboxCfg(V);
  const auditCfg = cfg.audit || {};
  const minFontPx = auditCfg.minFontSize === undefined ? 18 : Number(auditCfg.minFontSize);
  const optSuffixes = collectConfiguredOptSuffixes(cfg, lang);

  const page = await browser.newPage({ viewport: { width: cfg.width || 1920, height: cfg.height || 1080 }, deviceScaleFactor: 1 });
  await page.addInitScript(installPageAuditHelpers);
  const vErrors = [], vWarnings = [], savedShots = [];

  page.on('pageerror', err => vErrors.push(`Runtime error: ${err.message}`));
  page.on('response', resp => {
    const u = resp.url();
    if (resp.status() >= 400 && !isOptionalAuditResponse(u, optSuffixes)) {
      vErrors.push(`HTTP ${resp.status()}: ${u}`);
    }
  });

  const q = lang ? `?record=1&lang=${encodeURIComponent(lang)}` : '?record=1';
  await page.goto(`http://127.0.0.1:${port}/${id}/${q}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__video && window.V && window.V.seekToAsync, null, { timeout: 15000 });

  for (const sel of await page.evaluate(IN_PAGE_CSS_AUDIT)) {
    vErrors.push(`Forbidden infinite CSS animation on "${sel}"`);
  }
  const ptCtx = { id, duration: V.duration, minFontPx, screenshotDir, vErrors, vWarnings, savedShots };
  for (const pt of buildSamplePoints(V)) {
    await inspectSamplePoint(page, ptCtx, pt);
  }
  await page.close();
  return { vErrors: [...new Set(vErrors)], vWarnings: [...new Set(vWarnings)], savedShots, sceneCount: V.scenes.length };
}

function reportAuditResult(id, res, strict) {
  const { vErrors, vWarnings, savedShots, sceneCount } = res;
  const finalErrs = strict ? [...vErrors, ...vWarnings] : vErrors;
  if (finalErrs.length) {
    console.error(`\n❌ [${id}] VISUAL & SPEC AUDIT FAILED (${finalErrs.length} issue(s)):`);
    for (const e of finalErrs) console.error(`  - ${e}`);
  } else if (vWarnings.length) {
    console.log(`⚠️  [${id}] Visual audit passed with ${vWarnings.length} warning(s):`);
    for (const w of vWarnings) console.log(`  ! ${w}`);
  } else {
    console.log(`✅ [${id}] Visual & f(t) determinism audit PASSED (${sceneCount} scenes).`);
  }
  if (savedShots.length) {
    console.log(`  📸 Saved ${savedShots.length} diagnostic frame(s) -> ${path.dirname(savedShots[0])}`);
  }
  return { errCount: finalErrs.length, warnCount: vWarnings.length, screenshots: savedShots };
}

export async function auditVideos(videoIds, { strict = false, lang = '', screenshotDir = '' } = {}) {
  const targets = videoIds && videoIds.length ? videoIds : listVideoIds();
  if (!targets.length) return { errors: 0, warnings: 0, screenshots: [] };

  const { srv, port } = await startEphemeralVideoServer();
  const chromium = await loadChromium(ROOT);
  const browser = await chromium.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });

  let totalErrors = 0, totalWarnings = 0;
  const allShots = [];
  try {
    for (const id of targets) {
      const res = await auditSingleVideo(browser, port, id, { lang, screenshotDir });
      const { errCount, warnCount, screenshots } = reportAuditResult(id, res, strict);
      totalErrors += errCount;
      totalWarnings += warnCount;
      allShots.push(...screenshots);
    }
  } finally {
    await browser.close();
    srv.close();
  }
  return { errors: totalErrors, warnings: totalWarnings, screenshots: allShots };
}

function parseAuditCliArgs(raw) {
  let lang = '', screenshotDir = '';
  const ids = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '--lang' && raw[i + 1]) { lang = raw[++i]; continue; }
    if (a === '--screenshots' && raw[i + 1]) { screenshotDir = path.resolve(raw[++i]); continue; }
    if (!a.startsWith('--')) ids.push(a);
  }
  return { ids, lang, screenshotDir, strict: raw.includes('--strict') };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('audit-visual.mjs');
if (isDirectRun) {
  const parsed = parseAuditCliArgs(process.argv.slice(2));
  const { errors } = await auditVideos(parsed.ids, parsed);
  if (errors > 0) process.exit(1);
}
