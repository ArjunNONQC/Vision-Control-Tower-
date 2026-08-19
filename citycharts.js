// Shared between city.html, explore.html, store.html
const charts = {};

// Wine/burgundy theme — RAG (red/amber/green) severity colors and hot/cold
// breach indicators are intentionally left untouched; only the primary
// "Orders" bar / "%" trend line chrome moved off the old blue palette.
const COLOR = {
  bar: 'rgba(196, 120, 138, 0.75)',
  barBorder: '#B0435F',
  navyLine: '#4A1420',
  singleLine: '#B0435F',
  secondLine: '#4A1420',
  baseline: '#E74C3C',
};

if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
  Chart.register(ChartDataLabels);
  Chart.defaults.animation.duration = 250; // snappier rendering, was default 1000ms
  // Keep every datalabel inside the chart's plot area — without this, a label
  // near the top (e.g. 100%) or bottom (e.g. 0%) of a chart spills out into
  // the legend row above or the x-axis tick labels below, overlapping them.
  Chart.defaults.set('plugins.datalabels', { clamp: true });
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function fmtWeekLabel(mondayStr) {
  const mon = new Date(mondayStr + 'T00:00:00');
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const sameMonth = mon.getMonth() === sun.getMonth();
  return sameMonth ? `${mon.getDate()}-${sun.getDate()} ${MONTHS[mon.getMonth()]}`
                    : `${mon.getDate()} ${MONTHS[mon.getMonth()]} - ${sun.getDate()} ${MONTHS[sun.getMonth()]}`;
}
function round1_(n) { return Math.round(n * 10) / 10; }

// All chart typography is scaled through fs() so the whole dashboard's graph
// font size moves together from one place. Currently +10% over the original
// sizes. Purely presentational — never touches a data value.
const FONT_SCALE = 1.1;
function fs(n) { return Math.round(n * FONT_SCALE * 10) / 10; }

// Datalabels are drawn just outside each point, so a value sitting at the very
// top of the plot area gets clipped by the canvas edge (the 64.1% / 64.5%
// problem on Rider Share). Two things prevent that: grace reserves a slice of
// axis range beyond the real min/max, and padding reserves pixels above the
// plot area. grace is proportional, so it scales with the data instead of
// needing a hand-tuned max per chart. Neither one alters a plotted value —
// only the empty space around them.
const Y_GRACE = '12%';
const LABEL_PADDING_TOP = 26;

function toWeekly(series, pctFields, avgFields) {
  const weeks = {};
  series.forEach(row => {
    const d = new Date(row.date + 'T00:00:00');
    const day = d.getDay();
    const monday = new Date(d); monday.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    const key = monday.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = { date: key, _rows: [] };
    weeks[key]._rows.push(row);
  });
  return Object.values(weeks).sort((a, b) => a.date.localeCompare(b.date)).map(w => {
    const out = { date: w.date };
    const rows = w._rows;
    const totalOrders = rows.reduce((s, r) => s + (r.orders || 0), 0);
    out.orders = totalOrders;
    pctFields.forEach(f => {
      out[f] = totalOrders ? rows.reduce((s, r) => s + (r[f] || 0) * (r.orders || 0), 0) / totalOrders : 0;
    });
    (avgFields || []).forEach(f => {
      const vals = rows.map(r => r[f]).filter(v => v != null);
      out[f] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    out.ofdOrders = rows.reduce((s, r) => s + (r.ofdOrders || 0), 0);
    out.retries = rows.reduce((s, r) => s + (r.retries || 0), 0);
    out.sddOrders = rows.reduce((s, r) => s + (r.sddOrders || 0), 0);
    out.sddFasterOrders = rows.reduce((s, r) => s + (r.sddFasterOrders || 0), 0);

    // These two are ratios with their OWN denominator, not delivered orders, so
    // they can't be order-weighted like the pctFields above. retryRate was
    // previously never set at all here, which left the Retry line blank in WoW;
    // sddFasterPct was weighted by delivered orders instead of SDD orders.
    // Recomputing both from the summed parts is exact for any week length.
    out.retryRate = out.ofdOrders ? out.retries / out.ofdOrders : null;
    if (pctFields.indexOf('sddFasterPct') !== -1) {
      out.sddFasterPct = out.sddOrders ? out.sddFasterOrders / out.sddOrders : null;
    }
    return out;
  });
}

// label defaults to 'Baseline' (the fixed Base-Config/QC targets); the
// Retry Rate / Fake Retry % callers below pass 'PAN India' instead, since
// that line is literally today's Pan India value for that metric, not a
// fixed target — the legend/tooltip text says so.
function baselineLineDataset(value, len, yAxisID, label) {
  if (value == null) return null;
  return {
    type: 'line', label: label || 'Baseline', yAxisID: yAxisID || 'yPct',
    data: Array(len).fill(round1_(value * 100)),
    borderColor: COLOR.baseline, borderDash: [6, 4], pointRadius: 0, borderWidth: 2, fill: false,
    datalabels: { display: false },
  };
}

// ======================= PAN INDIA-DERIVED BASELINES (Retry / Fake Retry / Cancellation) =======================
// Retry Rate, Fake Retry %, and Cancellation % have no fixed target in Base
// Config the way Breach %/Long Tail % do, so their baseline is defined
// dynamically per request: "today's" Pan India value for that same metric,
// applied as a flat dashed line across every city's chart (e.g. Pan India
// retry = 13% on 18 Aug -> 13% baseline for every city that day). "Today"
// here means the most recent date present in Pan India's own raw daily
// series — the fields are read straight off the row (retryRate /
// fakeRetryPct / cancellationPct), the same fields the per-city charts
// already plot, so this stays correct even as the sheet grows new days.
// Best-effort: any fetch failure just means no baseline line is drawn, never
// a broken page.
async function fetchPanIndiaRetryBaselines_(service) {
  try {
    const data = await fetchCityData('Pan India', service);
    const series = data && data.series;
    if (!series || !series.length) return { retryBaseline: null, fakeRetryBaseline: null, cancellationBaseline: null };
    const last = series[series.length - 1];
    return {
      retryBaseline: last.retryRate != null ? last.retryRate : null,
      fakeRetryBaseline: last.fakeRetryPct != null ? last.fakeRetryPct : null,
      cancellationBaseline: last.cancellationPct != null ? last.cancellationPct : null,
    };
  } catch (e) {
    return { retryBaseline: null, fakeRetryBaseline: null, cancellationBaseline: null };
  }
}

// Shared tooltip look — nothing on the chart itself is ever a static label;
// every value (the metric, Orders, Baseline, all of it) only appears here,
// on hover. This is the one thing that can never collide, at any data
// density, because only a single tooltip is ever rendered at a time.
const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(74,20,32,0.96)', titleColor: '#fff', bodyColor: '#F5E6E9',
  padding: 10, cornerRadius: 8, displayColors: true, boxPadding: 4,
  titleFont: { size: fs(12), weight: '700' }, bodyFont: { size: fs(11.5) },
};

// Bars = order volume (left axis) . Line = one % metric (right axis)
// ordersLabel (optional) renames the bar series + its left axis for charts
// where the bars aren't plain delivered orders (e.g. Retry Rate plots OFD
// orders). Defaults to 'Orders' so every existing caller is unchanged.
function makeComboChart(canvasId, labels, orders, pctValues, pctLabel, extraLineDatasets, tooltipExtra, ordersLabel) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  ordersLabel = ordersLabel || 'Orders';
  const datasets = [
    { type: 'bar', label: ordersLabel, yAxisID: 'yOrders', data: orders, backgroundColor: COLOR.bar,
      borderColor: COLOR.barBorder, borderWidth: 1, borderRadius: 4, order: 2, maxBarThickness: 56, barPercentage: 0.55, categoryPercentage: 0.65,
      datalabels: { display: false } },
    { type: 'line', label: pctLabel, yAxisID: 'yPct', data: pctValues, borderColor: COLOR.navyLine,
      backgroundColor: 'rgba(74,20,32,0.08)', borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff',
      pointBorderColor: COLOR.navyLine, pointBorderWidth: 2, tension: 0.3, fill: false, order: 1,
      datalabels: { display: 'auto', clamp: true, align: ctx => ctx.dataIndex % 2 === 0 ? 'top' : 'bottom',
        offset: 8, color: COLOR.navyLine, font: { size: fs(11), weight: '700' },
        formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
  ];
  if (extraLineDatasets) datasets.push(...extraLineDatasets);
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: LABEL_PADDING_TOP } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center', reverse: false,
          padding: 12, labels: { boxWidth: 10, font: { size: fs(11), weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${ctx.dataset.yAxisID === 'yPct' ? ctx.formattedValue + '%' : ctx.formattedValue}`,
          afterBody: tooltipExtra,
        } },
      },
      scales: {
        yOrders: { position: 'left', beginAtZero: true, title: { display: true, text: ordersLabel, font: { size: fs(10) } },
          ticks: { font: { size: fs(10) } }, grid: { display: false } },
        yPct: { position: 'right', beginAtZero: true, grace: Y_GRACE, title: { display: true, text: '%', font: { size: fs(10) } },
          ticks: { font: { size: fs(10) }, callback: v => v + '%' }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: fs(10), weight: '700' } }, grid: { display: false } },
      },
    },
  });
}

// TRUE stacked bar (matches the "Long Tail Bifurcation %" reference style):
// BBD% forms the base segment, Breach% stacks on top of it, each segment
// labeled with its own value directly inside the bar.
// Breach % as a bar, BBD % as a line, sharing one % axis. (Previously both
// were stacked bar segments — moved BBD to a line per request, applied to
// both QC and Non-QC since they share this one function.)
function makeBreachBddChart(canvasId, labels, breachValues, breachLabel, bddValues, bddLabel, baselineValue) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const datasets = [
    { type: 'bar', label: breachLabel, data: breachValues, backgroundColor: COLOR.bar, borderColor: COLOR.barBorder,
      borderWidth: 1, borderRadius: 4, order: 2, maxBarThickness: 90, barPercentage: 0.85, categoryPercentage: 0.9,
      datalabels: { display: 'auto', clamp: true, anchor: 'end', align: 'top', color: '#8B2F45',
        font: { size: fs(10), weight: '600' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
    { type: 'line', label: bddLabel, data: bddValues, borderColor: COLOR.navyLine, backgroundColor: 'rgba(74,20,32,0.08)',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.navyLine, pointBorderWidth: 2,
      tension: 0.3, fill: false, order: 1,
      datalabels: { display: 'auto', clamp: true, align: 'top', offset: 8, color: COLOR.navyLine,
        font: { size: fs(11), weight: '700' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
  ];
  const baseline = baselineLineDataset(baselineValue, labels.length, 'y');
  if (baseline) datasets.push(baseline);
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: LABEL_PADDING_TOP } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center', reverse: false,
          padding: 12, labels: { boxWidth: 10, font: { size: fs(11), weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: {
          label: ctx => ctx.dataset.label === 'Baseline' ? ` Baseline: ${ctx.formattedValue}%` : ` ${ctx.dataset.label}: ${ctx.formattedValue}%`,
        } },
      },
      scales: {
        y: { position: 'left', beginAtZero: true, grace: Y_GRACE, title: { display: true, text: '%', font: { size: fs(10) } },
          ticks: { font: { size: fs(10) }, callback: v => v + '%' }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: fs(10), weight: '700' } }, grid: { display: false } },
      },
    },
  });
}

// Two % metrics, one bar one line, sharing a single % axis (e.g. LM% bar + Long Tail% line)
function makeDualMetricCombo(canvasId, labels, barValues, barLabel, lineValues, lineLabel, baselineValue) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const datasets = [
    { type: 'bar', label: barLabel, data: barValues, backgroundColor: COLOR.bar, borderColor: COLOR.barBorder,
      borderWidth: 1, borderRadius: 4, order: 2, maxBarThickness: 56, barPercentage: 0.55, categoryPercentage: 0.65,
      datalabels: { display: 'auto', clamp: true, anchor: 'end', align: 'top', color: '#8B2F45',
        font: { size: fs(10), weight: '600' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
    { type: 'line', label: lineLabel, data: lineValues, borderColor: COLOR.navyLine, backgroundColor: 'rgba(74,20,32,0.08)',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.navyLine, pointBorderWidth: 2,
      tension: 0.3, fill: false, order: 1,
      datalabels: { display: 'auto', clamp: true, align: 'top', offset: 8, color: COLOR.navyLine,
        font: { size: fs(11), weight: '700' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
  ];
  const baseline = baselineLineDataset(baselineValue, labels.length);
  if (baseline) datasets.push(baseline);
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: LABEL_PADDING_TOP } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center', reverse: false,
          padding: 12, labels: { boxWidth: 10, font: { size: fs(11), weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.formattedValue}%` } },
      },
      scales: {
        y: { position: 'left', beginAtZero: true, grace: Y_GRACE, title: { display: true, text: '%', font: { size: fs(10) } },
          ticks: { font: { size: fs(10) }, callback: v => v + '%' }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: fs(10), weight: '700' } }, grid: { display: false } },
      },
    },
  });
}

// Two plain lines sharing one axis (e.g. Inhouse share vs 3P share)
function makeDualLineChart(canvasId, labels, series1, label1, series2, label2, yLabel) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [
      { label: label1, data: series1, borderColor: COLOR.singleLine, backgroundColor: 'transparent',
        borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.singleLine, pointBorderWidth: 2,
        tension: 0.3, fill: false,
        datalabels: { display: 'auto', clamp: true, align: 'top', offset: 6, color: COLOR.singleLine,
          font: { size: fs(10), weight: '700' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
      { label: label2, data: series2, borderColor: COLOR.secondLine, backgroundColor: 'transparent',
        borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.secondLine, pointBorderWidth: 2,
        tension: 0.3, fill: false,
        datalabels: { display: 'auto', clamp: true, align: 'bottom', offset: 6, color: COLOR.secondLine,
          font: { size: fs(10), weight: '700' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: LABEL_PADDING_TOP } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center',
          padding: 12, labels: { boxWidth: 10, font: { size: fs(11), weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.formattedValue}%` } },
      },
      scales: {
        y: { grace: Y_GRACE, title: { display: true, text: yLabel, font: { size: fs(10) } }, ticks: { font: { size: fs(10) }, callback: v => v + '%' }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: fs(10), weight: '700' } }, grid: { display: false } },
      },
    },
  });
}

// yOpts (optional): { beginAtZero, stepSize, suffix }. Used by the Queue-Level
// TAT charts, which are pinned to start at 0 with a fixed 10-unit tick gap so
// the three of them stay visually comparable to each other.
// extraLineDatasets (optional): additional Chart.js line datasets drawn on
// top of the main line — used for the Pan-India baseline overlay (Cancellation
// %). Must target this chart's own axis id ('y', the default), not 'yPct'.
function makeSingleLineChart(canvasId, labels, values, label, yLabel, yOpts, extraLineDatasets) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  yOpts = yOpts || {};
  const suffix = yOpts.suffix || '';
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{
      label, data: values, borderColor: COLOR.singleLine, backgroundColor: 'rgba(176,67,95,0.10)',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.singleLine,
      pointBorderWidth: 2, fill: true, tension: 0.3,
      datalabels: { display: 'auto', clamp: true, align: ctx => ctx.dataIndex % 2 === 0 ? 'top' : 'bottom',
        offset: 6, color: COLOR.singleLine, font: { size: fs(10), weight: '700' },
        formatter: v => v != null ? round1_(v) + suffix : '' },
    }, ...(extraLineDatasets || [])]},
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: LABEL_PADDING_TOP } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center',
          padding: 12, labels: { boxWidth: 10, font: { size: fs(11), weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.formattedValue}${suffix}` } },
      },
      scales: {
        y: {
          beginAtZero: !!yOpts.beginAtZero,
          grace: Y_GRACE,
          title: { display: true, text: yLabel, font: { size: fs(10) } },
          ticks: { font: { size: fs(10) }, stepSize: yOpts.stepSize, callback: v => v + suffix },
          grid: { color: '#F0F4F8' },
        },
        x: { ticks: { font: { size: fs(10), weight: '700' } }, grid: { display: false } },
      },
    },
  });
}

// Generic 1-to-N line chart, one distinct color per series. Used for every
// new Rider Efficiency metric (1-2 lines each) and the 3P Acceptance Rate
// chart (one line per delivery partner, count varies).
const MULTI_LINE_PALETTE = [COLOR.navyLine, COLOR.singleLine, '#2980B9', '#1E8449', '#D68910', '#8E44AD', '#16A085'];

function makeMultiLineChart(canvasId, labels, seriesList, yLabel, isPercent) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const suffix = isPercent ? '%' : '';
  const datasets = seriesList.map((s, i) => {
    const color = MULTI_LINE_PALETTE[i % MULTI_LINE_PALETTE.length];
    return {
      label: s.label, data: s.data, borderColor: color, backgroundColor: 'transparent',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: color, pointBorderWidth: 2,
      tension: 0.3, fill: false,
      datalabels: { display: 'auto', clamp: true, align: i % 2 === 0 ? 'top' : 'bottom', offset: 6, color,
        font: { size: fs(10), weight: '700' }, formatter: v => v != null ? round1_(v) + suffix : '' },
    };
  });
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: LABEL_PADDING_TOP } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center',
          padding: 12, labels: { boxWidth: 10, font: { size: fs(11), weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.formattedValue}${suffix}` } },
      },
      scales: {
        y: { beginAtZero: true, grace: Y_GRACE, title: { display: true, text: yLabel, font: { size: fs(10) } },
          ticks: { font: { size: fs(10) }, callback: v => v + suffix }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: fs(10), weight: '700' } }, grid: { display: false } },
      },
    },
  });
}

// ======================= CARD LAYOUTS PER SERVICE =======================
function nonQcChartCardsHTML(cityMeta) {
  return `
    <div class="chart-card"><h3><span class="card-dot dot-breach"></span>Breach % + BBD % ${cityMeta.overallBreachBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.overallBreachBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartBreachBdd"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-lt"></span>Long Tail % ${cityMeta.ltBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.ltBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartLT"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-cancel"></span>Cancellation % ${cityMeta.cancellationBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>PAN India ${(cityMeta.cancellationBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartCancel"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-sdd"></span>SDD & Faster % Inhouse + 3PL</h3><div class="chart-canvas-wrap"><canvas id="chartSddFaster"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-retry"></span>Retry Rate ${cityMeta.retryBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>PAN India ${(cityMeta.retryBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartRetry"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-retry"></span>Fake Retry % ${cityMeta.fakeRetryBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>PAN India ${(cityMeta.fakeRetryBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartFakeRetry"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-nps"></span>NPS (7d rolling)</h3><div class="chart-canvas-wrap"><canvas id="chartNps"></canvas></div></div>
    <div class="section-divider">Queue-Level TAT in Hrs (P80)</div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>Overall TAT</h3><div class="chart-canvas-wrap"><canvas id="chartTatOverall"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>SQ &rarr; MDQ</h3><div class="chart-canvas-wrap"><canvas id="chartTatSqMdq"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>MDQ &rarr; Del</h3><div class="chart-canvas-wrap"><canvas id="chartTatMdqDel"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>Placed &rarr; ETA</h3><div class="chart-canvas-wrap"><canvas id="chartTatPlacedEta"></canvas></div></div>`;
}

function qcChartCardsHTML(cityMeta) {
  return `
    <div class="chart-card"><h3><span class="card-dot dot-share"></span>Rider Share (Inhouse vs 3P)</h3><div class="chart-canvas-wrap"><canvas id="chartRiderShare"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-share"></span>Batching % / Manual Assigned %</h3><div class="chart-canvas-wrap"><canvas id="chartBatching"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-breach"></span>Breach % ${cityMeta.overallBreachBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.overallBreachBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartBreachPlain"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-breach"></span>Breach with Tol% + BBD%</h3><div class="chart-canvas-wrap"><canvas id="chartBreachBdd"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-lt"></span>Long Tail % ${cityMeta.ltBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.ltBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartLT"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>P80 LM TAT (min)</h3><div class="chart-canvas-wrap"><canvas id="chartLmTat"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-retry"></span>Retry Rate ${cityMeta.retryBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>PAN India ${(cityMeta.retryBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartRetry"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-nps"></span>NPS (7d rolling)</h3><div class="chart-canvas-wrap"><canvas id="chartNps"></canvas></div></div>
    ${riderEfficiencyCardsHTML()}`;
}

function storeChartCardsHTML() {
  return `
    <div class="chart-card"><h3><span class="card-dot dot-share"></span>Rider Share (Inhouse vs 3P)</h3><div class="chart-canvas-wrap"><canvas id="chartRiderShare"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-share"></span>Batching % / Manual Assigned %</h3><div class="chart-canvas-wrap"><canvas id="chartBatching"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-breach"></span>Breach % <span class="baseline-legend"><span class="baseline-swatch"></span>Baseline 40.0%</span></h3><div class="chart-canvas-wrap"><canvas id="chartBreachPlain"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-breach"></span>Breach with Tol% + BBD%</h3><div class="chart-canvas-wrap"><canvas id="chartBreachBdd"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-lt"></span>Long Tail % <span class="baseline-legend"><span class="baseline-swatch"></span>Baseline 4.0%</span></h3><div class="chart-canvas-wrap"><canvas id="chartLT"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>P80 LM TAT (min)</h3><div class="chart-canvas-wrap"><canvas id="chartLmTat"></canvas></div></div>
    ${riderEfficiencyCardsHTML()}`;
}

// Shared by both the QC city page and the store page — new rider-efficiency
// and 3P-partner-acceptance charts, same card markup either way.
function riderEfficiencyCardsHTML() {
  return `
    <div class="section-divider">DM Rider Efficiency</div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>Active Hrs</h3><div class="chart-canvas-wrap"><canvas id="chartActiveHrs"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>Idle Hrs</h3><div class="chart-canvas-wrap"><canvas id="chartIdleHrs"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-share"></span>Efficiency Per Day / Per Hour</h3><div class="chart-canvas-wrap"><canvas id="chartEfficiency"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-retry"></span>Active Riders</h3><div class="chart-canvas-wrap"><canvas id="chartActiveRiders"></canvas></div></div>
    <div class="chart-card span-2"><h3><span class="card-dot dot-sdd"></span>Mg Eligible % / % Not Hitting Upper Threshold</h3><div class="chart-canvas-wrap"><canvas id="chartMgEligible"></canvas></div></div>
    <div class="section-divider">3P Partner Acceptance</div>
    <div class="chart-card span-2"><h3><span class="card-dot dot-share"></span>Acceptance Rate by Partner</h3><div class="chart-canvas-wrap"><canvas id="chartAcceptance"></canvas></div></div>`;
}

function renderNonQcCharts(cityMeta, rawSeries, period) {
  const pctFields = ['breachPct','ltPct','bddPct','cancellationPct','sddFasterPct'];
  const avgFields = ['overallTat','sqToMdq','mdqToDel'];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields, avgFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));
  const orders = series.map(r => r.orders);

  makeBreachBddChart('chartBreachBdd', labels,
    series.map(r => round1_(r.breachPct * 100)), 'Breach %',
    series.map(r => round1_(r.bddPct * 100)), 'BBD %',
    cityMeta.overallBreachBaseline);
  makeComboChart('chartLT', labels, orders, series.map(r => round1_(r.ltPct * 100)), 'Long Tail %',
    [baselineLineDataset(cityMeta.ltBaseline, series.length)].filter(Boolean), null, 'Delivered Order');
  // Cancellation is a line only — the Orders bars were dropped per request, so
  // this is now a plain % line on a single axis (no order-volume axis at all).
  makeSingleLineChart('chartCancel', labels, series.map(r => round1_(r.cancellationPct * 100)),
    'Cancellation %', '%', { beginAtZero: true, suffix: '%' },
    [baselineLineDataset(cityMeta.cancellationBaseline, series.length, 'y', 'PAN India')].filter(Boolean));
  makeComboChart('chartSddFaster', labels, series.map(r => r.sddOrders ?? 0),
    series.map(r => r.sddFasterPct != null ? round1_(r.sddFasterPct * 100) : null), 'SDD & Faster %', null);
  // Bars here are OFD orders, not delivered orders — axis + legend say so.
  makeComboChart('chartRetry', labels, series.map(r => r.ofdOrders ?? 0), series.map(r => r.retryRate != null ? round1_(r.retryRate * 100) : null), 'Retry %',
    [baselineLineDataset(cityMeta.retryBaseline, series.length, null, 'PAN India')].filter(Boolean),
    items => [`Retries: ${series[items[0].dataIndex].retries ?? '\u2014'} of ${series[items[0].dataIndex].ofdOrders ?? '\u2014'} OFD orders`],
    'OFD Orders');

  // Queue-level TAT charts: y axis pinned to 0 with a fixed 10-hr tick gap.
  const tatYOpts = { beginAtZero: true, stepSize: 10 };
  makeSingleLineChart('chartTatOverall', labels, series.map(r => r.overallTat), 'Overall TAT (hrs)', 'Hours', tatYOpts);
  makeSingleLineChart('chartTatSqMdq', labels, series.map(r => r.sqToMdq), 'SQ\u2192MDQ (hrs)', 'Hours', tatYOpts);
  makeSingleLineChart('chartTatMdqDel', labels, series.map(r => r.mdqToDel), 'MDQ\u2192Del (hrs)', 'Hours', tatYOpts);
  // Placed → ETA sits with the queue-level TAT charts and uses the same axis
  // rules so all four read on a comparable scale.
  makeSingleLineChart('chartTatPlacedEta', labels, series.map(r => r.p80PlacedToEta ?? null),
    'Placed\u2192ETA (hrs)', 'Hours', tatYOpts);

  renderNpsChart(rawSeries, period);
  renderFakeRetryChart(rawSeries, cityMeta);
}

// NPS is already a 7-day ROLLING score at source, so re-bucketing it into weeks
// under the WoW toggle would average an average. It always renders from the raw
// daily series regardless of the toggle — the value on any given day already
// carries a week of history. Nulls are preserved so a city with no score that
// day shows a gap rather than a plunge to zero.
function renderNpsChart(rawSeries, period) {
  const labels = rawSeries.map(r => fmtDayLabel(r.date));
  makeMultiLineChart('chartNps', labels,
    [{ label: 'NPS (7d rolling)', data: rawSeries.map(r => r.nps != null ? round1_(r.nps) : null) }],
    'NPS', false);
}

// Fake Retry — Non-QC-only (the source tab has a QC block too, but it's out
// of scope for this app per request). Always renders from the RAW daily
// series, ignoring the DoD/WoW toggle, same reasoning as NPS: the sheet gives
// us the % and a raw count, but not the count's own denominator, so there is
// no correct way to re-weight this into a proper weekly average — showing the
// daily values as-is is more honest than computing a plausible-looking wrong
// one. Bars = fakeRetryCount (a plain count, at least additive — though not
// shown accumulated since the daily grain never changes); line = fakeRetryPct.
function renderFakeRetryChart(rawSeries, cityMeta) {
  const labels = rawSeries.map(r => fmtDayLabel(r.date));
  makeComboChart('chartFakeRetry', labels, rawSeries.map(r => r.fakeRetryCount ?? 0),
    rawSeries.map(r => r.fakeRetryPct != null ? round1_(r.fakeRetryPct * 100) : null), 'Fake Retry %',
    [baselineLineDataset((cityMeta || {}).fakeRetryBaseline, rawSeries.length, null, 'PAN India')].filter(Boolean),
    null, 'Fake Retries');
}

function renderQcCharts(cityMeta, rawSeries, period) {
  const acceptancePartners = cityMeta.acceptancePartners || [];
  const acceptFields = acceptancePartners.map(p => 'accept__' + p);
  const pctFields = ['breachPct','breachWithTolPct','bbdBreachPct','ltPct','dmSharePct','tpSharePct','batchingPct','manualAssignedPct'];
  const avgFields = ['p80LmTat','avgActiveHrs','avgIdleHrs','efficiencyPerDay','efficiencyPerHour',
    'activeRiders','mgEligiblePct','pctNotHittingUpperThreshold', ...acceptFields];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields, avgFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));
  const orders = series.map(r => r.orders);

  makeDualLineChart('chartRiderShare', labels,
    series.map(r => r.dmSharePct != null ? round1_(r.dmSharePct * 100) : null), 'Inhouse Share %',
    series.map(r => r.tpSharePct != null ? round1_(r.tpSharePct * 100) : null), '3P Share %', '%');
  makeDualLineChart('chartBatching', labels,
    series.map(r => r.batchingPct != null ? round1_(r.batchingPct * 100) : null), 'Batching %',
    series.map(r => r.manualAssignedPct != null ? round1_(r.manualAssignedPct * 100) : null), 'Manual Assigned %', '%');
  // Baseline now overlays the plain "Breach %" chart, not the "Breach with
  // Tol% + BBD%" combo — moved per request. The underlying series on each
  // chart are unchanged: chartBreachPlain still plots raw breachPct,
  // chartBreachBdd still plots breachWithTolPct + bbdBreachPct. Only the
  // dashed baseline overlay moved between them.
  makeComboChart('chartBreachPlain', labels, orders, series.map(r => round1_(r.breachPct * 100)), 'Breach %',
    [baselineLineDataset(cityMeta.overallBreachBaseline, series.length)].filter(Boolean));
  makeBreachBddChart('chartBreachBdd', labels,
    series.map(r => round1_(r.breachWithTolPct * 100)), 'Breach with Tol %',
    series.map(r => round1_(r.bbdBreachPct * 100)), 'BBD %');
  makeComboChart('chartLT', labels, orders, series.map(r => round1_(r.ltPct * 100)), 'Long Tail %',
    [baselineLineDataset(cityMeta.ltBaseline, series.length)].filter(Boolean), null, 'Delivered Order');
  makeSingleLineChart('chartLmTat', labels, series.map(r => r.p80LmTat), 'P80 LM TAT (min)', 'Minutes');
  // QC Retry Rate — same construction as the Non-QC one: OFD orders on the
  // left axis, retry % line on the right, retries/OFD in the tooltip.
  makeComboChart('chartRetry', labels, series.map(r => r.ofdOrders ?? 0),
    series.map(r => r.retryRate != null ? round1_(r.retryRate * 100) : null), 'Retry %',
    [baselineLineDataset(cityMeta.retryBaseline, series.length, null, 'PAN India')].filter(Boolean),
    items => [`Retries: ${series[items[0].dataIndex].retries ?? '\u2014'} of ${series[items[0].dataIndex].ofdOrders ?? '\u2014'} OFD orders`],
    'OFD Orders');
  renderNpsChart(rawSeries, period);

  renderRiderEfficiencyCharts(labels, series, acceptancePartners);
}

// Shared by both the QC city page and the store page.
function renderRiderEfficiencyCharts(labels, series, acceptancePartners) {
  makeMultiLineChart('chartActiveHrs', labels,
    [{ label: 'Avg Active Hrs', data: series.map(r => r.avgActiveHrs != null ? round1_(r.avgActiveHrs) : null) }], 'Hours', false);
  makeMultiLineChart('chartIdleHrs', labels,
    [{ label: 'Avg Idle Hrs', data: series.map(r => r.avgIdleHrs != null ? round1_(r.avgIdleHrs) : null) }], 'Hours', false);
  makeMultiLineChart('chartEfficiency', labels, [
    { label: 'Order Per Day', data: series.map(r => r.efficiencyPerDay != null ? round1_(r.efficiencyPerDay) : null) },
    { label: 'Order Per Hour', data: series.map(r => r.efficiencyPerHour != null ? round1_(r.efficiencyPerHour) : null) },
  ], 'Efficiency', false);
  makeMultiLineChart('chartActiveRiders', labels,
    [{ label: 'Active Riders', data: series.map(r => r.activeRiders != null ? round1_(r.activeRiders) : null) }], 'Riders', false);
  // Merged per request: Mg Eligible % and % Not Hitting Upper Threshold now
  // share one chart/one canvas instead of two separate cards.
  makeMultiLineChart('chartMgEligible', labels, [
    { label: 'Mg Eligible %', data: series.map(r => r.mgEligiblePct != null ? round1_(r.mgEligiblePct * 100) : null) },
    { label: '% Not Hitting Upper Threshold', data: series.map(r => r.pctNotHittingUpperThreshold != null ? round1_(r.pctNotHittingUpperThreshold * 100) : null) },
  ], '%', true);
  makeMultiLineChart('chartAcceptance', labels,
    acceptancePartners.map(p => ({
      label: p,
      data: series.map(r => r['accept__' + p] != null ? round1_(r['accept__' + p] * 100) : null),
    })), '%', true);
}

function renderStoreCharts(rawSeries, period, acceptancePartners) {
  acceptancePartners = acceptancePartners || [];
  const acceptFields = acceptancePartners.map(p => 'accept__' + p);
  const pctFields = ['breachPct','breachWithTolPct','bbdBreachPct','ltPct','dmSharePct','tpSharePct','batchingPct','manualAssignedPct'];
  const avgFields = ['p80LmTat','avgActiveHrs','avgIdleHrs','efficiencyPerDay','efficiencyPerHour',
    'activeRiders','mgEligiblePct','pctNotHittingUpperThreshold', ...acceptFields];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields, avgFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));
  const orders = series.map(r => r.orders);

  makeDualLineChart('chartRiderShare', labels,
    series.map(r => r.dmSharePct != null ? round1_(r.dmSharePct * 100) : null), 'Inhouse Share %',
    series.map(r => r.tpSharePct != null ? round1_(r.tpSharePct * 100) : null), '3P Share %', '%');
  makeDualLineChart('chartBatching', labels,
    series.map(r => r.batchingPct != null ? round1_(r.batchingPct * 100) : null), 'Batching %',
    series.map(r => r.manualAssignedPct != null ? round1_(r.manualAssignedPct * 100) : null), 'Manual Assigned %', '%');
  makeComboChart('chartBreachPlain', labels, orders, series.map(r => round1_(r.breachPct * 100)), 'Breach %',
    [baselineLineDataset(0.40, series.length)].filter(Boolean));
  makeBreachBddChart('chartBreachBdd', labels,
    series.map(r => round1_(r.breachWithTolPct * 100)), 'Breach with Tol %',
    series.map(r => round1_(r.bbdBreachPct * 100)), 'BBD %');
  makeComboChart('chartLT', labels, orders, series.map(r => round1_(r.ltPct * 100)), 'Long Tail %',
    [baselineLineDataset(0.04, series.length)].filter(Boolean), null, 'Delivered Order');
  makeSingleLineChart('chartLmTat', labels, series.map(r => r.p80LmTat), 'P80 LM TAT (min)', 'Minutes');

  renderRiderEfficiencyCharts(labels, series, acceptancePartners);
}

// ======================= STAT PANELS =======================
function statPanelsHTML(orderSummary, coldChain, ageing, ageingLabel, service) {
  const cold = coldChainHTML(coldChain);
  const ageingCard = ageingHTML(ageing, ageingLabel, service);
  return `<div class="scorecard-row">
      ${orderSummary ? `
      <div class="scorecard">
        <div class="scorecard-label"><span class="stat-icon">📦</span> Total Orders <span class="scorecard-date">(${fmtDayLabel(orderSummary.date)})</span></div>
        <div class="scorecard-value">${orderSummary.total.toLocaleString()}</div>
        <div class="scorecard-breakdown">
          <span><span class="dot qc"></span>QC: ${orderSummary.qc.toLocaleString()}</span>
          <span><span class="dot nonqc"></span>Non-QC: ${orderSummary.nonQc.toLocaleString()}</span>
        </div>
      </div>` : ''}
      ${ageingCard}
      ${cold}
    </div>`;
}

// RAG (Red/Amber/Green) severity by ageing bucket, used everywhere an ageing
// breakdown is shown: D-1 = green (fresh, expected), D-2 = amber (watch),
// D-3 and older = red (needs action). Reused by both the per-city ageing
// panel and the Pan-India header bar so the color language stays consistent.
function ageingBucketRag_(bucketKey) {
  if (bucketKey === 'd1') return 'rag-green';
  if (bucketKey === 'd2') return 'rag-amber';
  return 'rag-red'; // d3, d4d5, gt5
}

// service is threaded through purely so a click can open the right (QC vs
// Non-QC) full ageing table — this card only ever shows ONE total, the modal
// is where every city's own breakdown lives.
function ageingHTML(ageing, label, service) {
  if (!ageing || !ageing.total) return '';
  const pct = n => ageing.total ? ((n / ageing.total) * 100).toFixed(1) + '%' : '0%';
  const rows = [
    ['d1', 'D-1', ageing.d1],
    ['d2', 'D-2', ageing.d2],
    ['d3', 'D-3', ageing.d3],
    ['d4d5', 'D-4 &amp; D-5', ageing.d4 + ageing.d5],
    ['gt5', '&gt;5 days', ageing.gt5],
  ];
  return `
    <div class="scorecard ageing-scorecard clickable-card" onclick="openAgeingModal_('${service}')" title="View the full ageing table by city">
      <div class="scorecard-label"><span class="stat-icon">⏳</span> Ageing Orders ${label ? `<span class="scorecard-date">(${label})</span>` : ''}</div>
      <div class="scorecard-value">${ageing.total.toLocaleString()}</div>
      <div class="cold-breakdown">
        ${rows.map(([key, lbl, val]) => `
        <div class="cold-bar-row"><span class="cold-bar-label">${lbl}</span><div class="cold-bar-track"><div class="cold-bar-fill ${ageingBucketRag_(key)}" style="width:${pct(val)}"></div></div><span class="cold-bar-val">${val} (${pct(val)})</span></div>`).join('')}
      </div>
    </div>`;
}

// Fixed/sticky Pan-India summary bar for the home page — a prominent header
// strip (like a KPI bar): total orders, breach%, LT%, and the ageing breakdown,
// all pulled straight from the dump sheets' pan-India aggregate.
function panIndiaAgeingBarHTML(ageing, service, panIndia) {
  const hasAgeing = ageing && ageing.total;
  const hasMetrics = panIndia && panIndia.orders != null;
  if (!hasAgeing && !hasMetrics) {
    return `<div class="pan-india-bar"><div class="pan-india-icon"><img src="pan-india-icon.png" alt="India" /></div><div class="pan-india-label">PAN INDIA · ${service}</div><div class="pan-india-empty">No data yet</div></div>`;
  }
  const pct = n => (hasAgeing && ageing.total) ? ((n / ageing.total) * 100).toFixed(1) + '%' : '0%';
  const buckets = hasAgeing ? [
    ['d1', 'D-1', ageing.d1], ['d2', 'D-2', ageing.d2], ['d3', 'D-3', ageing.d3],
    ['d4d5', 'D-4 & D-5', ageing.d4 + ageing.d5], ['gt5', '>5 days', ageing.gt5],
  ] : [];
  return `
    <div class="pan-india-bar">
      <div class="pan-india-icon"><img src="pan-india-icon.png" alt="India" /></div>
      <div class="pan-india-total">
        <div class="pan-india-label">PAN INDIA · ${service}</div>
        <div class="pan-india-value">${hasMetrics ? panIndia.orders.toLocaleString() : '—'}</div>
        <div class="pan-india-sub-label"><span class="stat-icon">📦</span> Total Orders</div>
      </div>
      ${hasMetrics ? `
      <div class="pan-india-metric">
        <div class="pan-india-metric-val">${(panIndia.breachPct*100).toFixed(1)}%</div>
        <div class="pan-india-bucket-label"><span class="stat-icon">⚠</span> Breach %</div>
      </div>
      <div class="pan-india-metric">
        <div class="pan-india-metric-val">${(panIndia.ltPct*100).toFixed(1)}%</div>
        <div class="pan-india-bucket-label"><span class="stat-icon">⏱</span> Long Tail %</div>
      </div>` : ''}
      ${hasAgeing ? `
      <div class="pan-india-divider"></div>
      <div class="pan-india-metric clickable-card" onclick="openAgeingModal_('${service}')" title="View the full ageing table by city">
        <div class="pan-india-metric-val">${ageing.total.toLocaleString()}</div>
        <div class="pan-india-bucket-label">Ageing &gt; (D-0)</div>
      </div>
      ${panIndia && panIndia.retryPct != null ? `
      <div class="pan-india-metric">
        <div class="pan-india-metric-val">${(panIndia.retryPct*100).toFixed(1)}%</div>
        <div class="pan-india-bucket-label"><span class="stat-icon">🔁</span> Current Retry Rate</div>
      </div>` : ''}
      <div class="pan-india-buckets clickable-card" onclick="openAgeingModal_('${service}')" title="View the full ageing table by city">
        ${buckets.map(([key, label, val]) => `
          <div class="pan-india-bucket">
            <div class="pan-india-bucket-val ${ageingBucketRag_(key)}-text">${val.toLocaleString()}</div>
            <div class="pan-india-bucket-pct">${pct(val)}</div>
            <div class="pan-india-bucket-label">${label}</div>
          </div>`).join('')}
      </div>` : ''}
    </div>`;
}

// Shown once if the backend couldn't find an expected column by name in the
// sheet — this is the exact class of bug that caused silent 0% readings before
// (positional parsing quietly reading the wrong column after a sheet edit).
function schemaWarningHTML(schemaWarnings) {
  if (!schemaWarnings) return '';
  const nq = schemaWarnings.dumpNonQcMissingColumns || [];
  const qc = schemaWarnings.dumpQcMissingColumns || [];
  const sdd = schemaWarnings.sddFasterMissingColumns || [];
  const canc = schemaWarnings.cancellationNonQcMissingColumns || [];
  const noBaseline = schemaWarnings.missingBaselineCities || [];
  const eff = schemaWarnings.qcEfficiencyMissingColumns || [];
  const accept = schemaWarnings.qc3pAcceptanceMissingColumns || [];
  const eta = schemaWarnings.nonQcEtaMissingColumns || [];
  const nps = schemaWarnings.npsMissingColumns || [];
  const coldChain = schemaWarnings.coldChainMissingColumns || [];
  const batching = schemaWarnings.qcBatchingMissingColumns || [];
  const fakeRetry = schemaWarnings.fakeRetryMissingColumns || [];
  const missingTabs = schemaWarnings.missingTabs || [];
  const joins = schemaWarnings.joinWarnings || [];
  if (!missingTabs.length && !joins.length && !nq.length && !qc.length && !sdd.length && !canc.length && !noBaseline.length && !eff.length && !accept.length && !eta.length && !nps.length && !coldChain.length && !batching.length && !fakeRetry.length) return '';
  const parts = [];
  // Tab-level failures come first: if the tab itself didn't resolve, every
  // column warning under it is noise.
  if (missingTabs.length) parts.push(`Tab(s) not found: ${missingTabs.join(', ')} — check the tab name matches exactly`);
  joins.forEach(w => parts.push(w));
  if (nq.length) parts.push(`Dump NONQC: couldn't find column(s) for ${nq.join(', ')}`);
  if (qc.length) parts.push(`Dump QC: couldn't find column(s) for ${qc.join(', ')}`);
  if (sdd.length) parts.push(`SDD & Faster %: couldn't find column(s) for ${sdd.join(', ')}`);
  if (canc.length) parts.push(`Cancellation Non-QC: couldn't find column(s) for ${canc.join(', ')}`);
  if (eff.length) parts.push(`QC EFFICIENCY: couldn't find column(s) for ${eff.join(', ')}`);
  if (accept.length) parts.push(`QC 3P Acceptance Rate: couldn't find column(s) for ${accept.join(', ')}`);
  if (eta.length) parts.push(`NON-QC Eta: couldn't find column(s) for ${eta.join(', ')}`);
  if (nps.length) parts.push(`NPS: couldn't find column(s) for ${nps.join(', ')}`);
  if (coldChain.length) parts.push(`ColdChainBreach: couldn't find column(s) for ${coldChain.join(', ')}`);
  if (batching.length) parts.push(`QC BATCHING: couldn't find column(s) for ${batching.join(', ')}`);
  if (fakeRetry.length) parts.push(`Fake Retry: ${fakeRetry.join(', ')}`);
  if (noBaseline.length) parts.push(`Base Config: no matching row for ${noBaseline.join(', ')} — their Breach % baseline won't be drawn until the city name in Base Config exactly matches Dump NONQC`);
  return `<div class="schema-warning">⚠ Sheet column mismatch — ${parts.join(' · ')}. Those fields are reading as 0 until the header names match.</div>`;
}

// City landmark icons — reusable, data-driven system: each city maps to a
// distinct {color, path}, so every landmark reads as its own thing rather
// than a uniform icon set. Keys are normalized (uppercase) city names; any
// city not listed here falls back to a neutral generic landmark icon
// automatically (see cityIconHTML_) — adding a new city to the dashboard
// never breaks the icon system, it just gets the fallback until given its
// own entry here.
const CITY_ICON_DATA = {
  'MUMBAI':        { color: '#C97A2B', path: '<path d="M6 21V8c0-3 2.5-5 6-5s6 2 6 5v13M6 21h12M6 14h12"/>' }, // Gateway of India — sandstone arch
  'DELHI':         { color: '#B5342A', path: '<path d="M6 21V9c0-4 2.5-6 6-6s6 2 6 6v12M6 21h12M6 12h12"/>' }, // India Gate — red sandstone arch
  'NEW DELHI':     { color: '#B5342A', path: '<path d="M6 21V9c0-4 2.5-6 6-6s6 2 6 6v12M6 21h12M6 12h12"/>' },
  'JAIPUR':        { color: '#D6488A', path: '<path d="M5 21V9h3v3H5m3-3h3v3H8m3-3h3v3h-3m3-3h3v3h-3M5 21h14"/>' }, // Hawa Mahal — Pink City
  'KOLKATA':       { color: '#4A6D8C', path: '<path d="M3 15h18M6 15V9l6-3 6 3v6M6 12h12M12 6V3M9 21l3-6 3 6"/>' }, // Howrah Bridge — steel-grey cantilever
  'CHENNAI':       { color: '#1F9E93', path: '<path d="M12 3l2 6h-4l2-6zM10 9h4v10h-4zM8 21h8M11 12h2M11 15h2"/>' }, // Chennai Lighthouse — Marina teal
  'HYDERABAD':     { color: '#7A4FA3', path: '<path d="M4 21V9M9 21V6M15 21V6M20 21V9M4 21h16M9 6l2-3 2 3M15 6l2-3 2 3"/>' }, // Charminar — regal purple
  'BANGALORE':     { color: '#2E8B57', path: '<path d="M4 21h16M6 21V9l3-2h6l3 2v12M9 21V9M15 21V9M12 9V4"/><circle cx="12" cy="4" r="1.5"/>' }, // Vidhana Soudha — Garden City green
  'BENGALURU':     { color: '#2E8B57', path: '<path d="M4 21h16M6 21V9l3-2h6l3 2v12M9 21V9M15 21V9M12 9V4"/><circle cx="12" cy="4" r="1.5"/>' },
  'PUNE':          { color: '#A0522D', path: '<path d="M4 21V13l3-2 3 2v8M11 21V13l3-2 3 2v8M4 21h16M6 8v2M17 8v2"/>' }, // Shaniwar Wada — terracotta fort
  'LUCKNOW':       { color: '#C9A227', path: '<path d="M6 21V13a6 6 0 0 1 12 0v8M6 21h12M12 13a3 3 0 0 0 0-6"/>' }, // Bara Imambara — Nawabi gold
  'BHUBANESHWAR':  { color: '#E06A2C', path: '<circle cx="12" cy="15" r="6"/><path d="M12 9v12M6 15h12M7.8 10.8l8.4 8.4M16.2 10.8l-8.4 8.4"/>' }, // Konark Sun Temple wheel
  'AHMEDABAD':     { color: '#2B7FB0', path: '<path d="M5 21v-4a2 2 0 0 1 2-2 2 2 0 0 1 2 2v4M11 21v-6a2 2 0 0 1 2-2 2 2 0 0 1 2 2v6M17 21v-8a2 2 0 0 1 2-2 2 2 0 0 1 2 2v8M3 21h18"/>' }, // Adalaj Stepwell — stepped tiers, water blue
  'GURGAON':       { color: '#5A6B7A', path: '<path d="M4 21V7l4-2 4 2v14M12 21V4l4-2 4 2v17M4 21h16"/>' }, // Cyber Hub — modern slate
  'NOIDA':         { color: '#5A6B7A', path: '<path d="M3 16a9 5 0 0 1 18 0M3 16v3h18v-3M3 16a9 5 0 0 0 18 0"/>' }, // Noida Stadium — modern slate
  'FARIDABAD':     { color: '#5A6B7A', path: '<path d="M4 21V11l4-2 4 2v10M12 21V8l4-2 4 2v13M4 21h16"/>' }, // NCR skyline — modern slate
  'GREATER NOIDA': { color: '#5A6B7A', path: '<path d="M3 17c4-6 14-6 18 0M3 17h18M6 17c1-3 3-3 4 0M14 17c1-3 3-3 4 0"/>' }, // Buddh Circuit — modern slate
  'GHAZIABAD':     { color: '#8A6D3A', path: '<path d="M6 21V10a6 6 0 0 1 12 0v11M6 21h12M10 21v-5h4v5"/>' }, // Dasna Gate
  'DEHRADUN':      { color: '#3F7D4A', path: '<path d="M12 3l3 5H9l3-5zM12 8l4 6h-8l4-6zM6 21v-4M18 21v-4M4 21h16"/>' }, // FRI — forest green
  'ERNAKULAM':     { color: '#2B8C8C', path: '<path d="M4 20h4M4 20v-6l4-2M4 12v-3M20 20h-4M20 20v-6l-4-2M20 12v-3M12 20V9M8 9h8"/>' }, // Chinese fishing nets — backwater teal
  'JAMSHEDPUR':    { color: '#3F7D4A', path: '<path d="M12 21V11M8 21v-6M16 21v-6M12 11l-3-3M12 11l3-3M4 21h16"/>' }, // Jubilee Park
  'KANPUR':        { color: '#C9A227', path: '<path d="M12 3v3M8 21V10a4 4 0 0 1 8 0v11M4 21h16M9 6h6"/>' }, // JK Temple
  'GUWAHATI':      { color: '#B5342A', path: '<path d="M12 3c-2 3-2 5 0 6s2 3 0 6M6 21v-6a6 6 0 0 1 12 0v6M4 21h16"/>' }, // Kamakhya Temple
  'PANCHKULA':     { color: '#4E8B3F', path: '<path d="M12 21V9M12 9c-2 0-3-1-3-3M12 9c2 0 3-1 3-3M12 6c-1 0-2-1-2-2M12 6c1 0 2-1 2-2M4 21h16"/>' }, // Cactus Garden
  'PATNA':         { color: '#C9A227', path: '<path d="M12 3c4 0 6 4 6 8s-2 5-6 5-6-1-6-5 2-8 6-8zM12 16v5M8 21h8"/>' }, // Golghar
  'ROI':           { color: '#1B4D8F', path: '<path d="M12 2a5 5 0 0 1 5 5c0 4-5 9-5 9s-5-5-5-9a5 5 0 0 1 5-5z"/><circle cx="12" cy="7" r="2"/>' }, // generic India-pin
};

const CITY_ICON_FALLBACK = { color: '#6B7C8C', path: '<path d="M4 21V10l4-2 4 2v11M12 21V6l4-2 4 2v15M4 21h16"/>' };

// "ROI" is being pulled entirely off the dashboard per request — a non-city
// rollup that shouldn't appear as its own card/tile anywhere, QC or Non-QC.
// Centralized here so every list (home grid, trend strip, Explore dropdown,
// background prefetch) filters it the same way.
function isExcludedCity_(name) {
  return (name || '').toString().trim().toUpperCase() === 'ROI';
}

function cityIconHTML_(cityName) {
  const key = (cityName || '').toString().trim().toUpperCase();
  const data = CITY_ICON_DATA[key] || CITY_ICON_FALLBACK;
  return `<svg class="city-icon" viewBox="0 0 24 24" fill="none" stroke="${data.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${data.path}</svg>`;
}

// The whole card opens the team's Cold Chain ops sheet in a new tab — same
// click target whether it's reached from the Home page's Cold Trip Summary
// or a city page's own Cold Chain Breach scorecard, since they share this
// one function.
const COLD_CHAIN_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1O2Wb_W7r3nxFz_6KxhT60FCn2Z0efr_iZnhyXh2RHDw/edit';

function coldChainHTML(coldChain) {
  if (!coldChain) return '';
  const pct = v => (v * 100).toFixed(1) + '%';
  return `
    <div class="scorecard cold-scorecard clickable-card" onclick="window.open('${COLD_CHAIN_SHEET_URL}','_blank')" title="Open the Cold Chain ops sheet">
      <div class="scorecard-label"><span class="stat-icon">🌡️</span> Cold Chain Breach <span class="scorecard-date">(${coldChain.dateRange})</span></div>
      <div class="scorecard-value">${pct(coldChain.breachPct)} <span class="scorecard-sub">of ${coldChain.totalTrips} trips</span></div>
      <div class="cold-breakdown">
        <div class="cold-bar-row"><span class="cold-bar-label">High only (&gt;8&deg;C)</span><div class="cold-bar-track"><div class="cold-bar-fill high" style="width:${(coldChain.highOnlyPct*100).toFixed(1)}%"></div></div><span class="cold-bar-val">${coldChain.highOnly} (${pct(coldChain.highOnlyPct)})</span></div>
        <div class="cold-bar-row"><span class="cold-bar-label">Low only (&lt;2&deg;C)</span><div class="cold-bar-track"><div class="cold-bar-fill low" style="width:${(coldChain.lowOnlyPct*100).toFixed(1)}%"></div></div><span class="cold-bar-val">${coldChain.lowOnly} (${pct(coldChain.lowOnlyPct)})</span></div>
        <div class="cold-bar-row"><span class="cold-bar-label">Both breaches</span><div class="cold-bar-track"><div class="cold-bar-fill both" style="width:${(coldChain.bothPct*100).toFixed(1)}%"></div></div><span class="cold-bar-val">${coldChain.both} (${pct(coldChain.bothPct)})</span></div>
      </div>
    </div>`;
}

// Home page's Cold Trip Summary — same card markup as the per-city cold-chain
// scorecard (coldChainHTML), just fed the sheet's Grand Total row instead of a
// city row and wrapped in its own row so it doesn't crowd the order/ageing
// scorecards on the city page. Renders nothing if the tab has no Grand Total
// row, rather than a misleading "0 trips" card.
function coldTripSummaryHomeHTML(grandTotal) {
  if (!grandTotal) return '';
  return `<div class="scorecard-row" style="margin: 6px 0 20px;">${coldChainHTML(grandTotal)}</div>`;
}

// ======================= AGEING TABLE MODAL =======================
// Clicking either Ageing card (Home's Pan India bar, or a city page's own
// Ageing scorecard) opens this — a full per-city breakdown table for
// whichever service (QC/Non-QC) was actually clicked, not just the single
// rolled-up number the card itself shows. Backed by a new `?action=ageingtable`
// endpoint (see Code.gs) since no existing payload carries every city's row.
// Modal markup is injected into <body> once, on first use, so every page
// (index/city/explore) gets it without needing its own copy in the HTML.
function ensureAgeingModal_() {
  if (document.getElementById('ageingModalOverlay')) return;
  const div = document.createElement('div');
  div.id = 'ageingModalOverlay';
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal-box modal-box-wide">
      <div class="modal-header">
        <h3 id="ageingModalTitle">Ageing Orders</h3>
        <button class="modal-close" onclick="closeAgeingModal_()" aria-label="Close">&times;</button>
      </div>
      <div id="ageingModalBody" class="modal-body"><div class="loading">Loading…</div></div>
    </div>`;
  document.body.appendChild(div);
  // Click on the dimmed backdrop (not the box itself) closes it.
  div.addEventListener('click', (e) => { if (e.target === div) closeAgeingModal_(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAgeingModal_(); });
}

function closeAgeingModal_() {
  const el = document.getElementById('ageingModalOverlay');
  if (el) el.classList.remove('open');
}

async function openAgeingModal_(service) {
  service = (service === 'QC') ? 'QC' : 'Non-QC Inhouse';
  ensureAgeingModal_();
  const overlay = document.getElementById('ageingModalOverlay');
  const body = document.getElementById('ageingModalBody');
  document.getElementById('ageingModalTitle').textContent = `Ageing Orders by City — ${service}`;
  body.innerHTML = '<div class="loading">Loading…</div>';
  overlay.classList.add('open');
  try {
    const data = await cachedFetchJSON(`${WEBAPP_URL}?action=ageingtable&service=${encodeURIComponent(service)}`, 5 * 60 * 1000);
    body.innerHTML = ageingTableHTML_(data);
  } catch (err) {
    body.innerHTML = `<div class="empty-state">Couldn't load the ageing table: ${err.message}</div>`;
  }
}

function ageingTableHTML_(data) {
  if (!data || data.error) return `<div class="empty-state">Couldn't load the ageing table${data && data.error ? ': ' + data.error : ''}.</div>`;
  const rows = data.rows || [];
  if (!rows.length) return '<div class="empty-state">No ageing data for this service yet.</div>';
  const body = rows.map(r => `
    <tr>
      <td class="ageing-table-city">${r.city}</td>
      <td>${r.total.toLocaleString()}</td>
      <td>${r.d1.toLocaleString()}</td>
      <td>${r.d2.toLocaleString()}</td>
      <td>${r.d3.toLocaleString()}</td>
      <td>${r.d4.toLocaleString()}</td>
      <td>${r.d5.toLocaleString()}</td>
      <td>${r.gt5.toLocaleString()}</td>
    </tr>`).join('');
  return `
    <table class="ageing-table">
      <thead><tr><th>City</th><th>Total</th><th>D-1</th><th>D-2</th><th>D-3</th><th>D-4</th><th>D-5</th><th>&gt;5 days</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// ======================= STORE LIST (QC city page) =======================
// Lightweight inline SVG sparkline — no Chart.js instance per row, just a
// plain polyline. Cheap enough to render dozens of these in a store list.
// Text-based trend indicator (replaces the sparkline) — compares the average
// of the first half of the trend window to the second half, so one noisy day
// doesn't flip the verdict. Rising order volume = "Improving" here (more
// store activity), falling = "Worsening" — flip this if that's backwards for
// how volume trend should read.
function trendDirectionHTML(trend) {
  if (!trend || trend.length < 2) return `<span style="color:var(--text-muted);font-size:12px;">—</span>`;
  const mid = Math.floor(trend.length / 2);
  const firstHalf = trend.slice(0, mid || 1);
  const secondHalf = trend.slice(mid || 1);
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const a = avg(firstHalf), b = avg(secondHalf);
  const delta = a ? (b - a) / a : 0;
  if (Math.abs(delta) < 0.03) return `<span style="color:var(--text-muted);font-size:12px;font-weight:700;">→ Stable</span>`;
  if (delta > 0) return `<span style="color:var(--green);font-size:12px;font-weight:700;">↑ Improving</span>`;
  return `<span style="color:var(--red);font-size:12px;font-weight:700;">↓ Worsening</span>`;
}

// Column definitions for the store list — key is the field on each store
// object to sort by (null = not sortable, e.g. Trend has no single scalar to
// compare). Label text lives here so header + sort logic can't drift apart.
const STORE_LIST_COLUMNS = [
  { key: 'storeCode',        label: 'Store',        sortable: true },
  { key: null,               label: 'Trend',        sortable: false },
  { key: 'totalOrders',      label: 'Total Orders', sortable: true },
  { key: 'breachWithTolPct', label: 'Breach %',     sortable: true },
  { key: 'ltPct',            label: 'Long Tail %',  sortable: true },
  { key: 'dmSharePct',       label: 'DM Share',     sortable: true },
  { key: 'tpSharePct',       label: '3P Share',     sortable: true },
  { key: 'activeRiders',     label: 'Active Riders',sortable: true },
  { key: 'p80LmTat',         label: 'TAT (mins)',   sortable: true }, // was mislabeled "(hrs)" — p80LmTat is minutes, same field the LM TAT chart already titles "(min)"
];

function storeRowCellsHTML_(s) {
  return `
      <span class="store-code">${s.storeCode}</span>
      <span>${s.trend ? trendDirectionHTML(s.trend) : '—'}</span>
      <span>${s.totalOrders != null ? Number(s.totalOrders).toLocaleString() : '—'}</span>
      <span>${s.breachWithTolPct != null ? (s.breachWithTolPct*100).toFixed(1) + '%' : '—'}</span>
      <span>${s.ltPct != null ? (s.ltPct*100).toFixed(1) + '%' : '—'}</span>
      <span>${s.dmSharePct != null ? (s.dmSharePct*100).toFixed(1) + '%' : '—'}</span>
      <span>${s.tpSharePct != null ? (s.tpSharePct*100).toFixed(1) + '%' : '—'}</span>
      <span>${s.activeRiders != null ? Number(s.activeRiders).toLocaleString() : '—'}</span>
      <span>${s.p80LmTat != null ? Number(s.p80LmTat).toFixed(1) : '—'}</span>`;
}

// Order-weighted rollup of every store into one "Overall" row (the backend
// payload doesn't hand back a ready-made total). Percentages are weighted by
// each store's totalOrders so a small store's noisy % doesn't skew the city
// figure; Active Riders and Total Orders are plain sums; TAT is a simple
// average across stores that reported a value (P80 doesn't sum meaningfully).
function computeStoreOverallRow_(stores) {
  const totalOrders = stores.reduce((s, r) => s + (r.totalOrders || 0), 0);
  const wavg = (field) => {
    let num = 0, den = 0;
    stores.forEach(r => { if (r[field] != null) { num += r[field] * (r.totalOrders || 0); den += (r.totalOrders || 0); } });
    return den ? num / den : null;
  };
  const avg = (field) => {
    const vals = stores.map(r => r[field]).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    storeCode: 'Overall', trend: null, totalOrders,
    breachWithTolPct: wavg('breachWithTolPct'),
    ltPct: wavg('ltPct'), dmSharePct: wavg('dmSharePct'), tpSharePct: wavg('tpSharePct'),
    activeRiders: stores.reduce((s, r) => s + (r.activeRiders || 0), 0),
    p80LmTat: avg('p80LmTat'),
  };
}

let _storeListPayload = null;
let _storeListSort = { key: null, dir: 1 }; // dir: 1 = ascending, -1 = descending

// Re-sorts and redraws in place — bound to each sortable header's onclick.
// Clicking the same column again flips direction; clicking a new column
// starts it ascending. The Overall row and header never move.
function sortStoreList_(key) {
  if (!key) return;
  if (_storeListSort.key === key) _storeListSort.dir *= -1;
  else _storeListSort = { key, dir: 1 };
  const holder = document.getElementById('storeListHolder');
  if (holder) holder.innerHTML = renderStoreListInner_();
}

function renderStoreListInner_() {
  const storesPayload = _storeListPayload;
  if (!storesPayload || storesPayload.error || !storesPayload.stores.length) return '';
  const cityParam = encodeURIComponent(storesPayload.city);
  let stores = storesPayload.stores.slice();
  if (_storeListSort.key) {
    const key = _storeListSort.key, dir = _storeListSort.dir;
    stores.sort((a, b) => {
      let av = a[key], bv = b[key];
      if (typeof av === 'string' || typeof bv === 'string') {
        return dir * (av || '').toString().localeCompare((bv || '').toString());
      }
      av = av == null ? -Infinity : av;
      bv = bv == null ? -Infinity : bv;
      return dir * (av - bv);
    });
  }
  const headerCells = STORE_LIST_COLUMNS.map(col => {
    if (!col.sortable) return `<span>${col.label}</span>`;
    const arrow = _storeListSort.key === col.key ? (_storeListSort.dir === 1 ? ' \u25B2' : ' \u25BC') : '';
    return `<span class="store-sortable" onclick="sortStoreList_('${col.key}')">${col.label}${arrow}</span>`;
  }).join('');
  const overallRow = `<div class="store-row store-overall">${storeRowCellsHTML_(computeStoreOverallRow_(storesPayload.stores))}</div>`;
  const rows = stores.map(s => `
    <div class="store-row" onclick="window.location.href='store.html?store=${encodeURIComponent(s.storeCode)}&city=${cityParam}'">${storeRowCellsHTML_(s)}</div>`).join('');
  return `
    <div class="section-label">Stores in ${storesPayload.city} <span style="font-weight:500;text-transform:none;">(as of ${fmtDayLabel(storesPayload.asOf)})</span></div>
    <div class="store-list">
      <div class="store-row store-header">${headerCells}</div>
      ${overallRow}
      ${rows}
    </div>`;
}

// Entry point called by city.html/explore.html — stashes the payload (sort
// clicks re-render from this without refetching) and resets any sort left
// over from a previously viewed city.
function storeListHTML(storesPayload) {
  _storeListPayload = storesPayload;
  _storeListSort = { key: null, dir: 1 };
  return renderStoreListInner_();
}

// ======================= PAN INDIA CITY CARD =======================
// A card for the national rollup that sits alongside the per-city cards and
// opens the same city-detail page, so Pan India is reachable for every metric
// rather than only the summary bar. It deliberately does NOT use the breach
// card's red/amber styling: Pan India has no single baseline to breach, so
// showing it as "as per trend" or "breached" would be inventing a verdict.
// Metrics come from the payload's own pan-India block, which is read from the
// sheet's pre-aggregated rows.
function panIndiaCardHTML(data) {
  if (!data.panIndiaAvailable || !data.panIndia) return '';
  const p = data.panIndia;
  const pct = v => (v * 100).toFixed(1) + '%';
  // A metric with no source at all is dropped from the card rather than shown
  // as "—". A dash implies the number exists and happens to be missing today;
  // an absent row correctly says this metric isn't tracked for this service.
  const rows = [
    ['Orders', p.orders != null ? p.orders.toLocaleString() : null],
    ['Breach %', p.breachPct != null ? pct(p.breachPct) : null],
    ['Long Tail %', p.ltPct != null ? pct(p.ltPct) : null],
    ['Retry %', p.retryPct != null ? pct(p.retryPct) : null],
  ].filter(pair => pair[1] != null).map(pair => `
      <div class="metric-row">
        <span class="metric-name">${pair[0]}</span>
        <span class="metric-vals"><span>${pair[1]}</span></span>
      </div>`).join('');
  return `
    <div class="city-card pan-india-card" onclick="goToCity('Pan India','${data.service}')">
      <div class="city-name">🇮🇳 Pan India <span class="pan-india-chip">All cities</span></div>
      <div class="driven-by">National rollup — ${data.service} · ${data.period}</div>
      ${rows}
    </div>`;
}

// ======================= METRIC DISPLAY LABELS =======================
// Canonical display names live HERE, in citycharts.js, not in the page HTML.
// The pages load this file with a ?v= cache-buster, but the HTML itself has no
// such handle — browsers and the Pages CDN will happily serve a months-old
// index.html. A label defined in HTML therefore gets stranded on people's
// screens long after it was changed; defined here, it ships with the version
// bump like every other asset.
//
// The regex also strips a legacy "(LM Induced)" suffix from whatever the
// backend sends. Metric strings are baked into cached payloads, so a warmed
// cache can keep serving the old wording for hours after a deploy — this makes
// the display correct regardless of which vintage of payload arrives.
function metricLabel(m) {
  const s = (m || '').toString().trim();
  if (s === 'Overall Breach') return 'Overall Breach';
  const cleaned = s.replace(/\s*\(\s*LM\s*Induced\s*\)\s*/i, '').trim();
  return cleaned || 'Long Tail';
}

// Every cachedFetchJSON entry lives under this prefix (see 'visioncache:' +
// url above), so sweeping the client side of the cache is just removing every
// key that starts with it. Used by the home page's Hard Refresh button —
// clearing the SERVER cache alone isn't enough, because a stale localStorage
// hit is served without the browser ever making a network call at all.
function clearAllLocalCache_() {
  const doomed = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf('visioncache:') === 0) doomed.push(k);
  }
  doomed.forEach(k => localStorage.removeItem(k));
  return doomed.length;
}

// ======================= NETWORK (localStorage cache + stale-while-revalidate + retrying) =======================
// Fresh cache (< ttlMs old): return instantly, no network call.
// Stale-but-usable cache (< staleMs old): return the stale data immediately so the
// page paints right away, AND kick off a background refetch; if onRevalidate is
// given, it's called with the fresh data once that background fetch completes so
// the page can silently upgrade from stale to fresh — this is the actual trick
// behind dashboards that "feel" instant, borrowed from the Heimdall dashboard's
// pattern of rendering from already-held state instead of blocking on network.
// No usable cache at all: falls back to a normal blocking fetch (with retries).
async function cachedFetchJSON(url, opts) {
  if (typeof opts === 'number') opts = { ttlMs: opts };
  opts = opts || {};
  const ttlMs = opts.ttlMs || 5 * 60 * 1000;
  const staleMs = opts.staleMs || 24 * 60 * 60 * 1000;
  const key = 'visioncache:' + url;

  if (opts.force) {
    // Explicit "refresh" click: skip all caching, ask the backend to bypass its
    // own cache too (refresh=1), and overwrite whatever was stored.
    const liveUrl = url + (url.includes('?') ? '&' : '?') + 'refresh=1';
    return fetchAndCache_(liveUrl, key);
  }

  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(key)); } catch (e) { /* ignore corrupt entry */ }

  const age = cached ? Date.now() - cached.ts : Infinity;
  if (cached && age < ttlMs) return cached.data;

  if (cached && age < staleMs) {
    fetchAndCache_(url, key).then(fresh => {
      if (opts.onRevalidate) opts.onRevalidate(fresh);
    }).catch(() => {});
    return cached.data;
  }

  return fetchAndCache_(url, key);
}

// Every action in this app gets its response parsed through here. A response
// body starting with "<!DOCTYPE" or "<html" means the request never reached
// doGet's JSON-returning logic at all — Apps Script served its own page
// instead (almost always one of: the script was edited but never redeployed
// as a NEW VERSION, the web app's access setting doesn't match how it's being
// requested, or the account hitting the URL needs to re-authorize it). The
// native error for that case — "Unexpected token '<' ... is not valid JSON"
// — names a symptom, not a cause, so this replaces it with something
// actionable instead of leaving the person to guess.
async function parseJsonResponse_(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text);
    if (looksLikeHtml) {
      throw new Error('Apps Script returned a page instead of data — the script most likely needs to be ' +
        'redeployed as a NEW VERSION (Deploy > Manage deployments > Edit > New version; Save alone does not ' +
        'push changes), or its web app access setting doesn\'t match how this page is requesting it.');
    }
    throw new Error('Server returned something that isn\'t valid JSON: ' + text.slice(0, 200));
  }
}

async function fetchAndCache_(url, key) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      const data = await parseJsonResponse_(res);
      if (data.error) throw new Error(data.error);
      try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (e) { /* storage full — skip caching */ }
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function fetchCityData(city, service, onRevalidate, force) {
  return cachedFetchJSON(`${WEBAPP_URL}?action=city&city=${encodeURIComponent(city)}&service=${encodeURIComponent(service)}`, { onRevalidate, force });
}
async function fetchStoresData(city, force) {
  return cachedFetchJSON(`${WEBAPP_URL}?action=stores&city=${encodeURIComponent(city)}`, { force });
}
async function fetchStoreData(storeCode, cityHint, onRevalidate, force) {
  const cityQs = cityHint ? `&city=${encodeURIComponent(cityHint)}` : '';
  return cachedFetchJSON(`${WEBAPP_URL}?action=store&storeCode=${encodeURIComponent(storeCode)}${cityQs}`, { onRevalidate, force });
}

// Runs a growing list of async tasks with a concurrency cap. Tasks are allowed
// to push MORE tasks onto the same queue while running (used below so store
// list fetches can enqueue individual store fetches once they know what exists).
async function runWithConcurrency_(tasks, limit) {
  let i = 0;
  const workers = Array(Math.min(limit, tasks.length || 1)).fill(0).map(async () => {
    while (i < tasks.length) {
      const idx = i++;
      try { await tasks[idx](); } catch (e) { /* best-effort background prefetch — ignore failures */ }
    }
  });
  await Promise.all(workers);
}

// Silently warms the browser cache right after the home page renders, so
// clicking through later is served from localStorage instead of the network.
//
// Priority order matters, because the tail of this queue (every QC store) is
// long and the user may click within seconds:
//   1. The other home toggle combinations. The home payload is per
//      service+period, so flipping QC/Non-QC or DoD/WoW used to hit the network
//      even though the user hadn't left the page — the most likely first click
//      on the home screen was the one thing not being warmed.
//   2. Pan India, for both services. It's the first card on the grid, but it
//      never appeared in the meta city list: that list is built from the dump
//      tabs, which deliberately strip Pan India rows.
//   3. QC cities (slower to compute — store-level rollup), then their stores.
//   4. Non-QC cities.
async function prefetchAllCitiesAndStores(currentService, currentPeriod) {
  try {
    const meta = await cachedFetchJSON(`${WEBAPP_URL}?action=meta`, 10 * 60 * 1000);
    const tasks = [];
    const byService = meta.citiesByService || {};

    ['Non-QC Inhouse', 'QC'].forEach(svc => {
      ['DoD', 'WoW'].forEach(per => {
        if (svc === currentService && per === currentPeriod) return; // already loaded
        tasks.push(() => cachedFetchJSON(
          `${WEBAPP_URL}?action=home&service=${encodeURIComponent(svc)}&period=${per}`));
      });
    });

    ['QC', 'Non-QC Inhouse'].forEach(svc => tasks.push(() => fetchCityData('Pan India', svc)));

    (byService['QC'] || []).filter(city => !isExcludedCity_(city)).forEach(city => {
      tasks.push(() => fetchCityData(city, 'QC'));
      tasks.push(async () => {
        const sd = await fetchStoresData(city);
        if (sd && sd.stores) {
          sd.stores.forEach(s => tasks.push(() => fetchStoreData(s.storeCode, city)));
        }
      });
    });
    (byService['Non-QC Inhouse'] || []).filter(city => !isExcludedCity_(city)).forEach(city => {
      tasks.push(() => fetchCityData(city, 'Non-QC Inhouse'));
    });

    await runWithConcurrency_(tasks, 4); // cap concurrency so we don't hammer the Apps Script quota
  } catch (e) { /* background warming is best-effort — a failure here shouldn't affect the visible page */ }
}

function loadErrorHTML(message, retryFnName) {
  return `<div class="empty-state">Couldn't load data: ${message}
    <div style="margin-top:10px;"><button class="nav-btn" style="background:var(--header-blue);border:none;" onclick="${retryFnName}()">Retry</button></div>
  </div>`;
}
