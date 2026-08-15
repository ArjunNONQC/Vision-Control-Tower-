// Shared between city.html, explore.html, store.html
const charts = {};

const COLOR = {
  bar: 'rgba(125, 199, 240, 0.75)',
  barBorder: '#4FB3E8',
  navyLine: '#16324F',
  singleLine: '#4FB3E8',
  secondLine: '#16324F',
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
    return out;
  });
}

function baselineLineDataset(value, len, yAxisID) {
  if (value == null) return null;
  return {
    type: 'line', label: 'Baseline', yAxisID: yAxisID || 'yPct',
    data: Array(len).fill(round1_(value * 100)),
    borderColor: COLOR.baseline, borderDash: [6, 4], pointRadius: 0, borderWidth: 2, fill: false,
    datalabels: { display: false },
  };
}

// Bars = order volume (left axis) . Line = one % metric (right axis)
function makeComboChart(canvasId, labels, orders, pctValues, pctLabel, extraLineDatasets, tooltipExtra) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const showLabels = labels.length <= 10;
  const datasets = [
    { type: 'bar', label: 'Orders', yAxisID: 'yOrders', data: orders, backgroundColor: COLOR.bar,
      borderColor: COLOR.barBorder, borderWidth: 1, borderRadius: 4, order: 2, maxBarThickness: 56, barPercentage: 0.55, categoryPercentage: 0.65,
      datalabels: { display: showLabels, anchor: 'end', align: 'top', color: '#3E7CA6', font: { size: 10, weight: '600' },
        formatter: v => v > 0 ? (v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v) : '' } },
    { type: 'line', label: pctLabel, yAxisID: 'yPct', data: pctValues, borderColor: COLOR.navyLine,
      backgroundColor: 'rgba(22,50,79,0.08)', borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff',
      pointBorderColor: COLOR.navyLine, pointBorderWidth: 2, tension: 0.3, fill: false, order: 1,
      datalabels: { display: showLabels, align: 'top', offset: 8, color: COLOR.navyLine, font: { size: 11, weight: '700' },
        formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
  ];
  if (extraLineDatasets) datasets.push(...extraLineDatasets);
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 32 } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'start', reverse: false,
          padding: 14, labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { callbacks: tooltipExtra ? { afterBody: tooltipExtra } : undefined },
      },
      scales: {
        yOrders: { position: 'left', beginAtZero: true, title: { display: true, text: 'Orders', font: { size: 10 } },
          ticks: { font: { size: 10 } }, grid: { display: false } },
        yPct: { position: 'right', beginAtZero: true, title: { display: true, text: '%', font: { size: 10 } },
          ticks: { font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

// Two % bars sharing one category, layered (not side-by-side): outer bar wider/
// full-width (Breach%), inner bar narrower and lighter-shaded, drawn on top,
// centered inside the outer bar's footprint (BBD%). Uses grouped:false so
// Chart.js doesn't offset them side-by-side like a normal multi-series bar chart.
// TRUE stacked bar (matches the "Long Tail Bifurcation %" reference style):
// BBD% forms the base segment, Breach% stacks on top of it, each segment
// labeled with its own value directly inside the bar.
function makeNestedBarChart(canvasId, labels, breachValues, breachLabel, bddValues, bddLabel, baselineValue) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const showLabels = labels.length <= 10;
  const datasets = [
    { type: 'bar', label: bddLabel, data: bddValues, backgroundColor: 'rgba(79,179,232,0.85)',
      stack: 'breachStack', order: 2, maxBarThickness: 56, barPercentage: 0.55, categoryPercentage: 0.65,
      datalabels: { display: showLabels, anchor: 'center', align: 'center', color: '#0B2138', font: { size: 10, weight: '700' }, formatter: v => v > 0.05 ? v.toFixed(1) + '%' : '' } },
    { type: 'bar', label: breachLabel, data: breachValues, backgroundColor: COLOR.navyLine,
      stack: 'breachStack', order: 1, maxBarThickness: 56, barPercentage: 0.55, categoryPercentage: 0.65,
      datalabels: { display: showLabels, anchor: 'center', align: 'center', color: '#fff', font: { size: 10, weight: '700' }, formatter: v => v > 0.05 ? v.toFixed(1) + '%' : '' } },
  ];
  const baseline = baselineLineDataset(baselineValue, labels.length, 'y');
  if (baseline) { baseline.order = 0; datasets.push(baseline); }
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 32 } }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'start', reverse: true,
        padding: 14, labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        y: { stacked: true, position: 'left', beginAtZero: true, title: { display: true, text: '%', font: { size: 10 } },
          ticks: { font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#F0F4F8' } },
        x: { stacked: true, ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

// Two % metrics, one bar one line, sharing a single % axis (e.g. LM% bar + Long Tail% line)
function makeDualMetricCombo(canvasId, labels, barValues, barLabel, lineValues, lineLabel, baselineValue) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const showLabels = labels.length <= 10;
  const datasets = [
    { type: 'bar', label: barLabel, data: barValues, backgroundColor: COLOR.bar, borderColor: COLOR.barBorder,
      borderWidth: 1, borderRadius: 4, order: 2, maxBarThickness: 56, barPercentage: 0.55, categoryPercentage: 0.65,
      datalabels: { display: showLabels, anchor: 'end', align: 'top', color: '#3E7CA6', font: { size: 10, weight: '600' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
    { type: 'line', label: lineLabel, data: lineValues, borderColor: COLOR.navyLine, backgroundColor: 'rgba(22,50,79,0.08)',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.navyLine, pointBorderWidth: 2,
      tension: 0.3, fill: false, order: 1,
      datalabels: { display: showLabels, align: 'top', offset: 8, color: COLOR.navyLine, font: { size: 11, weight: '700' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
  ];
  const baseline = baselineLineDataset(baselineValue, labels.length);
  if (baseline) datasets.push(baseline);
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 32 } }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'start', reverse: false,
        padding: 14, labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        y: { position: 'left', beginAtZero: true, title: { display: true, text: '%', font: { size: 10 } },
          ticks: { font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

// Two plain lines sharing one axis (e.g. DM share vs 3P share)
function makeDualLineChart(canvasId, labels, series1, label1, series2, label2, yLabel) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const showLabels = labels.length <= 10;
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [
      { label: label1, data: series1, borderColor: COLOR.singleLine, backgroundColor: 'transparent',
        borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.singleLine, pointBorderWidth: 2,
        tension: 0.3, fill: false,
        datalabels: { display: showLabels, align: 'top', offset: 6, color: COLOR.singleLine, font: { size: 10, weight: '700' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
      { label: label2, data: series2, borderColor: COLOR.secondLine, backgroundColor: 'transparent',
        borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.secondLine, pointBorderWidth: 2,
        tension: 0.3, fill: false,
        datalabels: { display: showLabels, align: 'bottom', offset: 6, color: COLOR.secondLine, font: { size: 10, weight: '700' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 32 } }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'start',
        padding: 14, labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        y: { title: { display: true, text: yLabel, font: { size: 10 } }, ticks: { font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

function makeSingleLineChart(canvasId, labels, values, label, yLabel) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const showLabels = labels.length <= 10;
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{
      label, data: values, borderColor: COLOR.singleLine, backgroundColor: 'rgba(79,179,232,0.10)',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.singleLine,
      pointBorderWidth: 2, fill: true, tension: 0.3,
      datalabels: { display: showLabels, align: 'top', offset: 6, color: COLOR.singleLine, font: { size: 10, weight: '700' } },
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 32 } }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'start',
        padding: 14, labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        y: { title: { display: true, text: yLabel, font: { size: 10 } }, ticks: { font: { size: 10 } }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

// ======================= CARD LAYOUTS PER SERVICE =======================
function nonQcChartCardsHTML(cityMeta) {
  return `
    <div class="chart-card"><h3><span class="card-dot dot-breach"></span>Breach % + BBD % ${cityMeta.overallBreachBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.overallBreachBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartBreachBdd"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-lt"></span>Long Tail % (LM Induced) ${cityMeta.ltBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.ltBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartLT"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-cancel"></span>Cancellation %</h3><div class="chart-canvas-wrap"><canvas id="chartCancel"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-sdd"></span>SDD & Faster %</h3><div class="chart-canvas-wrap"><canvas id="chartSddFaster"></canvas></div></div>
    <div class="chart-card span-2"><h3><span class="card-dot dot-retry"></span>Retry Rate</h3><div class="chart-canvas-wrap"><canvas id="chartRetry"></canvas></div></div>
    <div class="section-divider">Queue-Level TAT in Hrs (P80)</div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>Overall TAT</h3><div class="chart-canvas-wrap"><canvas id="chartTatOverall"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>SQ &rarr; MDQ</h3><div class="chart-canvas-wrap"><canvas id="chartTatSqMdq"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>MDQ &rarr; Del</h3><div class="chart-canvas-wrap"><canvas id="chartTatMdqDel"></canvas></div></div>`;
}

function qcChartCardsHTML(cityMeta) {
  return `
    <div class="chart-card"><h3><span class="card-dot dot-breach"></span>Breach % + BBD % ${cityMeta.overallBreachBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.overallBreachBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartBreachBdd"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-lt"></span>Long Tail % ${cityMeta.ltBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.ltBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartLT"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>P80 LM TAT (hrs)</h3><div class="chart-canvas-wrap"><canvas id="chartLmTat"></canvas></div></div>
    <div class="chart-card span-2"><h3><span class="card-dot dot-retry"></span>Retry Rate</h3><div class="chart-canvas-wrap"><canvas id="chartRetry"></canvas></div></div>`;
}

function storeChartCardsHTML() {
  return `
    <div class="chart-card"><h3><span class="card-dot dot-breach"></span>Breach % + BBD % <span class="baseline-legend"><span class="baseline-swatch"></span>Baseline 40.0%</span></h3><div class="chart-canvas-wrap"><canvas id="chartBreachBdd"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-lt"></span>Long Tail % <span class="baseline-legend"><span class="baseline-swatch"></span>Baseline 4.0%</span></h3><div class="chart-canvas-wrap"><canvas id="chartLT"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>P80 LM TAT (hrs)</h3><div class="chart-canvas-wrap"><canvas id="chartLmTat"></canvas></div></div>`;
}

function renderNonQcCharts(cityMeta, rawSeries, period) {
  const pctFields = ['breachPct','ltPct','bddPct','cancellationPct','sddFasterPct'];
  const avgFields = ['overallTat','sqToMdq','mdqToDel'];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields, avgFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));
  const orders = series.map(r => r.orders);

  makeNestedBarChart('chartBreachBdd', labels,
    series.map(r => round1_(r.breachPct * 100)), 'Breach %',
    series.map(r => round1_(r.bddPct * 100)), 'BBD %',
    cityMeta.overallBreachBaseline);
  makeComboChart('chartLT', labels, orders, series.map(r => round1_(r.ltPct * 100)), 'Long Tail %',
    [baselineLineDataset(cityMeta.ltBaseline, series.length)].filter(Boolean));
  makeComboChart('chartCancel', labels, orders, series.map(r => round1_(r.cancellationPct * 100)), 'Cancellation %', null);
  makeComboChart('chartSddFaster', labels, series.map(r => r.sddOrders ?? 0),
    series.map(r => r.sddFasterPct != null ? round1_(r.sddFasterPct * 100) : null), 'SDD & Faster %', null);
  makeComboChart('chartRetry', labels, series.map(r => r.ofdOrders ?? 0), series.map(r => r.retryRate != null ? round1_(r.retryRate * 100) : null), 'Retry %', null,
    items => [`Retries: ${series[items[0].dataIndex].retries ?? '\u2014'} of ${series[items[0].dataIndex].ofdOrders ?? '\u2014'} OFD orders`]);

  makeSingleLineChart('chartTatOverall', labels, series.map(r => r.overallTat), 'Overall TAT (hrs)', 'Hours');
  makeSingleLineChart('chartTatSqMdq', labels, series.map(r => r.sqToMdq), 'SQ\u2192MDQ (hrs)', 'Hours');
  makeSingleLineChart('chartTatMdqDel', labels, series.map(r => r.mdqToDel), 'MDQ\u2192Del (hrs)', 'Hours');
}

function renderQcCharts(cityMeta, rawSeries, period) {
  const pctFields = ['breachPct','breachWithTolPct','bbdBreachPct','ltPct'];
  const avgFields = ['p80LmTat'];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields, avgFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));
  const orders = series.map(r => r.orders);

  makeNestedBarChart('chartBreachBdd', labels,
    series.map(r => round1_(r.breachWithTolPct * 100)), 'Breach %',
    series.map(r => round1_(r.bbdBreachPct * 100)), 'BBD %',
    cityMeta.overallBreachBaseline);
  makeComboChart('chartLT', labels, orders, series.map(r => round1_(r.ltPct * 100)), 'Long Tail %',
    [baselineLineDataset(cityMeta.ltBaseline, series.length)].filter(Boolean));
  makeSingleLineChart('chartLmTat', labels, series.map(r => r.p80LmTat), 'P80 LM TAT (hrs)', 'Hours');
  makeComboChart('chartRetry', labels, series.map(r => r.ofdOrders ?? 0), series.map(r => r.retryRate != null ? round1_(r.retryRate * 100) : null), 'Retry %', null,
    items => [`Retries: ${series[items[0].dataIndex].retries ?? '\u2014'} of ${series[items[0].dataIndex].ofdOrders ?? '\u2014'} OFD orders`]);
}

function renderStoreCharts(rawSeries, period) {
  const pctFields = ['breachPct','breachWithTolPct','bbdBreachPct','ltPct'];
  const avgFields = ['p80LmTat'];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields, avgFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));

  makeNestedBarChart('chartBreachBdd', labels,
    series.map(r => round1_(r.breachWithTolPct * 100)), 'Breach %',
    series.map(r => round1_(r.bbdBreachPct * 100)), 'BBD %',
    0.40);
  makeComboChart('chartLT', labels, series.map(r => r.orders), series.map(r => round1_(r.ltPct * 100)), 'Long Tail %',
    [baselineLineDataset(0.04, series.length)].filter(Boolean));
  makeSingleLineChart('chartLmTat', labels, series.map(r => r.p80LmTat), 'P80 LM TAT (hrs)', 'Hours');
}

// ======================= STAT PANELS =======================
function statPanelsHTML(orderSummary, coldChain, ageing, ageingLabel) {
  const cold = coldChainHTML(coldChain);
  const ageingCard = ageingHTML(ageing, ageingLabel);
  return `<div class="scorecard-row">
      ${orderSummary ? `
      <div class="scorecard">
        <div class="scorecard-label">📦 Total Orders <span class="scorecard-date">(${fmtDayLabel(orderSummary.date)})</span></div>
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

function ageingHTML(ageing, label) {
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
    <div class="scorecard ageing-scorecard">
      <div class="scorecard-label">⏳ Ageing Orders ${label ? `<span class="scorecard-date">(${label})</span>` : ''}</div>
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
    return `<div class="pan-india-bar"><div class="pan-india-icon">🌐</div><div class="pan-india-label">PAN INDIA · ${service}</div><div class="pan-india-empty">No data yet</div></div>`;
  }
  const pct = n => (hasAgeing && ageing.total) ? ((n / ageing.total) * 100).toFixed(1) + '%' : '0%';
  const buckets = hasAgeing ? [
    ['d1', 'D-1', ageing.d1], ['d2', 'D-2', ageing.d2], ['d3', 'D-3', ageing.d3],
    ['d4d5', 'D-4 & D-5', ageing.d4 + ageing.d5], ['gt5', '>5 days', ageing.gt5],
  ] : [];
  return `
    <div class="pan-india-bar">
      <div class="pan-india-icon">🌐</div>
      <div class="pan-india-total">
        <div class="pan-india-label">PAN INDIA · ${service}</div>
        <div class="pan-india-value">${hasMetrics ? panIndia.orders.toLocaleString() : '—'}</div>
        <div class="pan-india-sub-label">📦 Total Orders</div>
      </div>
      ${hasMetrics ? `
      <div class="pan-india-metric">
        <div class="pan-india-metric-val">${(panIndia.breachPct*100).toFixed(1)}%</div>
        <div class="pan-india-bucket-label">⚠ Breach %</div>
      </div>
      <div class="pan-india-metric">
        <div class="pan-india-metric-val">${(panIndia.ltPct*100).toFixed(1)}%</div>
        <div class="pan-india-bucket-label">⏱ Long Tail %</div>
      </div>
      ${panIndia.retryPct != null ? `
      <div class="pan-india-metric">
        <div class="pan-india-metric-val">${(panIndia.retryPct*100).toFixed(1)}%</div>
        <div class="pan-india-bucket-label">🔁 Retry Rate</div>
      </div>` : ''}` : ''}
      ${hasAgeing ? `
      <div class="pan-india-divider"></div>
      <div class="pan-india-total">
        <div class="pan-india-label">Ageing (D-1)</div>
        <div class="pan-india-value" style="font-size:22px;">${ageing.total.toLocaleString()}</div>
      </div>
      <div class="pan-india-buckets">
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
  if (!nq.length && !qc.length && !sdd.length) return '';
  const parts = [];
  if (nq.length) parts.push(`Dump NONQC: couldn't find column(s) for ${nq.join(', ')}`);
  if (qc.length) parts.push(`Dump QC: couldn't find column(s) for ${qc.join(', ')}`);
  if (sdd.length) parts.push(`SDD & Faster %: couldn't find column(s) for ${sdd.join(', ')}`);
  return `<div class="schema-warning">⚠ Sheet column mismatch — ${parts.join(' · ')}. Those fields are reading as 0 until the header names match.</div>`;
}

function coldChainHTML(coldChain) {
  if (!coldChain) return '';
  const pct = v => (v * 100).toFixed(1) + '%';
  return `
    <div class="scorecard cold-scorecard">
      <div class="scorecard-label">🌡️ Cold Chain Breach <span class="scorecard-date">(${coldChain.dateRange})</span></div>
      <div class="scorecard-value">${pct(coldChain.breachPct)} <span class="scorecard-sub">of ${coldChain.totalTrips} trips</span></div>
      <div class="cold-breakdown">
        <div class="cold-bar-row"><span class="cold-bar-label">High only (&gt;8&deg;C)</span><div class="cold-bar-track"><div class="cold-bar-fill high" style="width:${(coldChain.highOnlyPct*100).toFixed(1)}%"></div></div><span class="cold-bar-val">${coldChain.highOnly} (${pct(coldChain.highOnlyPct)})</span></div>
        <div class="cold-bar-row"><span class="cold-bar-label">Low only (&lt;2&deg;C)</span><div class="cold-bar-track"><div class="cold-bar-fill low" style="width:${(coldChain.lowOnlyPct*100).toFixed(1)}%"></div></div><span class="cold-bar-val">${coldChain.lowOnly} (${pct(coldChain.lowOnlyPct)})</span></div>
        <div class="cold-bar-row"><span class="cold-bar-label">Both breaches</span><div class="cold-bar-track"><div class="cold-bar-fill both" style="width:${(coldChain.bothPct*100).toFixed(1)}%"></div></div><span class="cold-bar-val">${coldChain.both} (${pct(coldChain.bothPct)})</span></div>
      </div>
    </div>`;
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

function storeListHTML(storesPayload) {
  if (!storesPayload || storesPayload.error || !storesPayload.stores.length) return '';
  const rows = storesPayload.stores.map(s => `
    <div class="store-row" onclick="window.location.href='store.html?store=${encodeURIComponent(s.storeCode)}'">
      <span class="store-code">${s.storeCode}</span>
      <span>${trendDirectionHTML(s.trend)}</span>
      <span>${s.totalOrders.toLocaleString()}</span>
      <span>${(s.breachWithTolPct*100).toFixed(1)}%</span>
      <span>${(s.orderSharePct*100).toFixed(1)}%</span>
    </div>`).join('');
  return `
    <div class="section-label">Stores in ${storesPayload.city} <span style="font-weight:500;text-transform:none;">(as of ${fmtDayLabel(storesPayload.asOf)})</span></div>
    <div class="store-list">
      <div class="store-row store-header">
        <span>Store</span><span>Trend</span><span>Total Orders</span><span>Breach %</span><span>Order Share</span>
      </div>
      ${rows}
    </div>`;
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

async function fetchAndCache_(url, key) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      const data = await res.json();
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
async function fetchStoreData(storeCode, onRevalidate, force) {
  return cachedFetchJSON(`${WEBAPP_URL}?action=store&storeCode=${encodeURIComponent(storeCode)}`, { onRevalidate, force });
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

// Silently warms the browser cache for every city (and every QC store) right
// after the home page renders, so clicking into any city or store later is
// served instantly from sessionStorage instead of hitting the network.
// QC cities are queued FIRST — they're the slower ones to compute (store-level
// rollup), so they get the head start on warming before you're likely to click one.
async function prefetchAllCitiesAndStores() {
  try {
    const meta = await cachedFetchJSON(`${WEBAPP_URL}?action=meta`, 10 * 60 * 1000);
    const tasks = [];
    const byService = meta.citiesByService || {};

    (byService['QC'] || []).forEach(city => {
      tasks.push(() => fetchCityData(city, 'QC'));
      tasks.push(async () => {
        const sd = await fetchStoresData(city);
        if (sd && sd.stores) {
          sd.stores.forEach(s => tasks.push(() => fetchStoreData(s.storeCode)));
        }
      });
    });
    (byService['Non-QC Inhouse'] || []).forEach(city => {
      tasks.push(() => fetchCityData(city, 'Non-QC Inhouse'));
    });

    await runWithConcurrency_(tasks, 4); // cap concurrent requests so we don't hammer the Apps Script quota
  } catch (e) { /* background warming is best-effort — a failure here shouldn't affect the visible page */ }
}

function loadErrorHTML(message, retryFnName) {
  return `<div class="empty-state">Couldn't load data: ${message}
    <div style="margin-top:10px;"><button class="nav-btn" style="background:var(--header-blue);border:none;" onclick="${retryFnName}()">Retry</button></div>
  </div>`;
}
