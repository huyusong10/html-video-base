import JSZip from 'jszip';

// Runs in the capture page. Only elements explicitly marked by the course are candidates.
export function prepareEditablePage() {
  const objects = [];
  const hidden = new Set();
  const styleOf = el => el.ownerDocument.defaultView.getComputedStyle(el);

  function visible(el) {
    const { width, height } = el.getBoundingClientRect();
    if (!width && !height) return false;
    if (styleOf(el).visibility !== 'visible') return false;
    for (let node = el; node; node = node.parentElement) {
      if (Number(styleOf(node).opacity) < 0.99) return false;
    }
    return true;
  }

  function stageRect(el, rect = el.getBoundingClientRect()) {
    let { x, y, width, height } = rect;
    let win = el.ownerDocument.defaultView;
    while (win !== window && win.frameElement) {
      const frame = win.frameElement.getBoundingClientRect();
      const sx = frame.width / win.innerWidth;
      const sy = frame.height / win.innerHeight;
      x = frame.x + x * sx;
      y = frame.y + y * sy;
      width *= sx;
      height *= sy;
      win = win.parent;
    }
    return { x, y, width, height };
  }

  const screenPoint = (matrix, x, y) => ({
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  });

  function paint(value, opacity = 1) {
    const match = /^rgba?\(([^)]+)\)$/.exec(value);
    if (!match) return null;
    const [r, g, b, a = 1] = match[1].split(',').map(Number);
    if (!a || !opacity) return null;
    const color = [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    return { color, transparency: Math.round(100 * (1 - a * opacity)) };
  }

  function textObject(el, matrix = null) {
    const text = el.textContent.trim();
    const style = styleOf(el);
    const color = paint(matrix ? style.fill : style.color);
    if (!text || !color || el.children.length || text.includes('\n')) return null;
    const rect = stageRect(el);
    if (!rect.width || !rect.height) return null;
    const fontSize = parseFloat(style.fontSize) * (matrix?.a ?? 1);
    const align = ({ middle: 'center', end: 'right' })[style.textAnchor]
      || (['left', 'center', 'right'].includes(style.textAlign) ? style.textAlign : 'left');
    const padding = fontSize * 0.45;
    const extraLeft = ({ left: 0, center: padding / 2, right: padding })[align];
    const height = Math.max(fontSize * 1.24, rect.height);
    return {
      type: 'text', text, color: color.color, fontSize, align,
      bold: Number(style.fontWeight) >= 600,
      rect: { x: rect.x - extraLeft, y: rect.y + (rect.height - height) / 2, width: rect.width + padding, height },
    };
  }

  function lineObject(el, style, matrix) {
    const stroke = paint(style.stroke, Number(style.strokeOpacity));
    if (!stroke || Math.abs(parseFloat(style.strokeDashoffset)) > 0.1) return null;
    const from = screenPoint(matrix, el.x1.baseVal.value, el.y1.baseVal.value);
    const to = screenPoint(matrix, el.x2.baseVal.value, el.y2.baseVal.value);
    return {
      type: 'shape', shape: 'line', stroke, strokeWidth: parseFloat(style.strokeWidth) * matrix.a,
      flipV: (to.x - from.x) * (to.y - from.y) < 0,
      rect: stageRect(el, { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) }),
    };
  }

  function svgObject(el) {
    const matrix = el.getScreenCTM();
    if (!matrix || matrix.b || matrix.c || matrix.a <= 0 || matrix.d <= 0) return null;
    const tag = el.localName;
    if (tag === 'text') return textObject(el, matrix);
    const style = styleOf(el);
    if (tag === 'line') return lineObject(el, style, matrix);
    if (style.fill.startsWith('url(') || style.stroke.startsWith('url(')) return null;
    const fill = paint(style.fill, Number(style.fillOpacity));
    const stroke = paint(style.stroke, Number(style.strokeOpacity));
    if (!fill && !stroke) return null;
    const shape = tag === 'rect' ? (parseFloat(style.rx) > 0 ? 'roundRect' : 'rect') : 'ellipse';
    return { type: 'shape', shape, fill, stroke, rect: stageRect(el), strokeWidth: parseFloat(style.strokeWidth) * matrix.a };
  }

  function chartRect(el) {
    const box = el.viewBox?.baseVal;
    const matrix = el.getScreenCTM?.();
    if (!box?.width || !matrix) return stageRect(el);
    const origin = screenPoint(matrix, box.x, box.y);
    return stageRect(el, { x: origin.x, y: origin.y, width: box.width * matrix.a, height: box.height * matrix.d });
  }

  function lineChart(el) {
    try {
      const { labels, series, axes } = JSON.parse(el.dataset.pptxChart);
      if (!Array.isArray(labels) || !labels.length || !labels.every(label => typeof label === 'string')) return null;
      if (!Array.isArray(axes) || !axes.length || axes.length > 2 || !axes.every(validAxis)) return null;
      if (!Array.isArray(series) || !series.length || !series.every(s => validSeries(s, labels.length, axes.length))) return null;
      return { type: 'chart', labels, series, axes, rect: chartRect(el) };
    } catch {}
    return null;
  }

  function validAxis({ min, max, step, unit }) {
    return [min, max, step].every(Number.isFinite) && min < max && step > 0 && typeof unit === 'string';
  }

  function validSeries({ name, color, values, axis = 0 }, length, axisCount) {
    return typeof name === 'string' && /^[0-9a-f]{6}$/i.test(color)
      && Number.isInteger(axis) && axis >= 0 && axis < axisCount
      && Array.isArray(values) && values.length === length
      && values.every(value => value === null || Number.isFinite(value));
  }

  function keep(el, object) {
    if (!object) return;
    hidden.add(el);
    objects.push(object);
  }

  function collect(el) {
    if (!visible(el)) return;
    if (el.dataset.pptxNative === 'svg') {
      for (const primitive of el.querySelectorAll('rect, circle, ellipse, line, text')) {
        if (!primitive.closest('defs,[data-pptx-raster]') && visible(primitive)) keep(primitive, svgObject(primitive));
      }
    } else if (el.dataset.pptxNative === 'text') {
      keep(el, textObject(el));
    } else if (el.dataset.pptxNative === 'chart') {
      const chart = lineChart(el);
      if (!chart) return;
      keep(el, chart);
      const legend = el.parentElement.querySelector('[data-pptx-chart-legend]');
      if (legend) hidden.add(legend);
    }
  }

  function visit(doc) {
    doc.querySelectorAll('[data-pptx-native]').forEach(collect);
    for (const iframe of doc.querySelectorAll('iframe')) {
      if (visible(iframe) && iframe.contentDocument) visit(iframe.contentDocument);
    }
  }

  visit(document);
  const originalStyles = [...hidden].map(el => [el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
  for (const [el] of originalStyles) el.style.setProperty('visibility', 'hidden', 'important');
  return {
    objects,
    restore() {
      for (const [el, value, priority] of originalStyles) el.style.setProperty('visibility', value, priority);
    },
  };
}

const FONT = 'Microsoft YaHei';

function addLineChart(slide, chart, box) {
  const activeAxes = chart.axes.filter((_, index) => chart.series.some(series => (series.axis ?? 0) === index));
  const secondary = axis => activeAxes.indexOf(chart.axes[axis ?? 0]) === 1;
  const types = chart.series.map(({ name, values, color, axis, dash }) => ({
    type: 'line',
    // PptxGenJS 4.0.1 drops numeric zero when writing the embedded worksheet.
    data: [{ name, labels: chart.labels, values: values.map(value => value === 0 ? '0' : value) }],
    options: { chartColors: [color], lineSize: 1.25, lineDash: dash || 'solid',
      lineDataSymbol: 'none', secondaryValAxis: secondary(axis), secondaryCatAxis: secondary(axis) },
  }));
  const catAxis = { catAxisLabelFontFace: FONT, catAxisLabelFontSize: 8, catAxisLabelColor: 'B1B6BE',
    catAxisLineShow: false, catAxisMajorTickMark: 'none', catGridLine: { style: 'none' } };
  const valAxes = activeAxes.map(({ min, max, step, unit }, index) => ({
    valAxisMinVal: min, valAxisMaxVal: max, valAxisMajorUnit: step,
    valAxisLabelFormatCode: `0" ${unit}"`,
    valAxisLabelFontFace: FONT, valAxisLabelFontSize: 8, valAxisLabelColor: 'B1B6BE',
    valAxisLineShow: false, valAxisMajorTickMark: 'none', valAxisLabelPos: 'nextTo',
    valGridLine: index ? { style: 'none' } : { color: '35393E', size: 0.5 },
  }));
  slide.addChart(types, {
    ...box, ...catAxis, ...valAxes[0],
    catAxes: activeAxes.map((_, index) => index ? { ...catAxis, catAxisHidden: true } : catAxis),
    valAxes, showTitle: false, showLegend: true, legendPos: 't',
    legendFontFace: FONT, legendFontSize: 8, legendColor: 'DADEE5',
    chartArea: { fill: { color: '17191B', transparency: 100 } },
    plotArea: { fill: { color: '17191B', transparency: 100 } },
    showMarker: false, displayBlanksAs: 'gap', objectName: 'Editable chart',
  });
}

export function addEditableObjects(slide, objects, scale) {
  for (const object of objects) {
    const { x, y, width, height } = object.rect;
    const box = { x: x * scale, y: y * scale, w: width * scale, h: height * scale };
    if (object.type === 'chart') {
      addLineChart(slide, object, box);
    } else if (object.type === 'text') {
      slide.addText(object.text, { ...box, color: object.color, fontFace: FONT,
        fontSize: object.fontSize * scale * 72, bold: object.bold, align: object.align, valign: 'middle',
        margin: 0, wrap: false, objectName: object.text });
    } else {
      const fill = object.fill || { color: '000000', transparency: 100 };
      const stroke = object.stroke || { color: '000000', transparency: 100 };
      slide.addShape(object.shape, { ...box, fill, flipV: object.flipV,
        line: { ...stroke, width: object.strokeWidth * scale * 72 } });
    }
  }
}

function normalizeLineCharts(xml) {
  const groups = new Map();
  const pattern = /<c:lineChart>(.*?)<\/c:lineChart>/gs;
  for (const [, body] of xml.matchAll(pattern)) {
    // PptxGenJS appends a series-axis reference to every 2D line chart (#1534).
    const axes = [...body.matchAll(/<c:axId val="\d+"\/>/g)].slice(0, 2).map(([axis]) => axis).join('');
    const group = groups.get(axes) ?? {
      before: body.slice(0, body.indexOf('<c:ser>')),
      after: body.slice(body.lastIndexOf('</c:ser>') + '</c:ser>'.length).replace(/<c:axId val="\d+"\/>/g, ''),
      series: [],
    };
    group.series.push(...[...body.matchAll(/<c:ser>.*?<\/c:ser>/gs)].map(([series]) => series
      .replace(/<c:invertIfNegative val="0"\/>/g, '')
      .replace(/<\/?c:lvl>/g, '')
      .replaceAll('c:multiLvlStr', 'c:str')
      .replace(/<c:pt idx="\d+"><c:v><\/c:v><\/c:pt>/g, '')));
    groups.set(axes, group);
  }
  const parts = [...groups].map(([axes, { before, after, series }]) =>
    `<c:lineChart>${before}${series.join('')}${after}${axes}</c:lineChart>`);
  return xml.replace(pattern, () => parts.shift() ?? '');
}

async function normalizeChartWorkbook(file) {
  const workbook = await JSZip.loadAsync(await file.async('nodebuffer'));
  const tablePath = 'xl/tables/table1.xml';
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const table = await workbook.file(tablePath).async('string');
  const sheet = await workbook.file(sheetPath).async('string');
  // PptxGenJS writes an invalid range (#1531) and empty numeric values in category charts.
  workbook.file(tablePath, table.replace(/(ref="[A-Z]+\d+:[A-Z]+\d+)'"/, '$1"'));
  workbook.file(sheetPath, sheet.replace(/<c r="([A-Z]+\d+)"><v><\/v><\/c>/g, '<c r="$1"/>'));
  return workbook.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function normalizeEditableCharts(bytes) {
  const deck = await JSZip.loadAsync(bytes);
  const charts = deck.file(/^ppt\/charts\/chart\d+\.xml$/);
  if (!charts.length) return bytes;
  await Promise.all(charts.map(async file => {
    deck.file(file.name, normalizeLineCharts(await file.async('string')));
  }));
  await Promise.all(deck.file(/^ppt\/embeddings\/.*\.xlsx$/).map(async file => {
    deck.file(file.name, await normalizeChartWorkbook(file));
  }));
  return deck.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
