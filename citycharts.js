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

// Shared tooltip look — nothing on the chart itself is ever a static label;
// every value (the metric, Orders, Baseline, all of it) only appears here,
// on hover. This is the one thing that can never collide, at any data
// density, because only a single tooltip is ever rendered at a time.
const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(74,20,32,0.96)', titleColor: '#fff', bodyColor: '#F5E6E9',
  padding: 10, cornerRadius: 8, displayColors: true, boxPadding: 4,
  titleFont: { size: 12, weight: '700' }, bodyFont: { size: 11.5 },
};

// Bars = order volume (left axis) . Line = one % metric (right axis)
function makeComboChart(canvasId, labels, orders, pctValues, pctLabel, extraLineDatasets, tooltipExtra) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const datasets = [
    { type: 'bar', label: 'Orders', yAxisID: 'yOrders', data: orders, backgroundColor: COLOR.bar,
      borderColor: COLOR.barBorder, borderWidth: 1, borderRadius: 4, order: 2, maxBarThickness: 56, barPercentage: 0.55, categoryPercentage: 0.65,
      datalabels: { display: false } },
    { type: 'line', label: pctLabel, yAxisID: 'yPct', data: pctValues, borderColor: COLOR.navyLine,
      backgroundColor: 'rgba(74,20,32,0.08)', borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff',
      pointBorderColor: COLOR.navyLine, pointBorderWidth: 2, tension: 0.3, fill: false, order: 1,
      datalabels: { display: 'auto', clamp: true, align: ctx => ctx.dataIndex % 2 === 0 ? 'top' : 'bottom',
        offset: 8, color: COLOR.navyLine, font: { size: 11, weight: '700' },
        formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
  ];
  if (extraLineDatasets) datasets.push(...extraLineDatasets);
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10 } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center', reverse: false,
          padding: 12, labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${ctx.dataset.yAxisID === 'yPct' ? ctx.formattedValue + '%' : ctx.formattedValue}`,
          afterBody: tooltipExtra,
        } },
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

// TRUE stacked bar (matches the "Long Tail Bifurcation %" reference style):
// BBD% forms the base segment, Breach% stacks on top of it, each segment
// labeled with its own value directly inside the bar.
function makeNestedBarChart(canvasId, labels, breachValues, breachLabel, bddValues, bddLabel, baselineValue) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const datasets = [
    { type: 'bar', label: bddLabel, data: bddValues, backgroundColor: 'rgba(196,120,138,0.85)',
      stack: 'breachStack', order: 2, maxBarThickness: 56, barPercentage: 0.55, categoryPercentage: 0.65,
      datalabels: { display: 'auto', clamp: true, anchor: 'center', align: 'center', color: '#3A0E17',
        font: { size: 10, weight: '700' }, formatter: v => v > 0.05 ? v.toFixed(1) + '%' : '' } },
    { type: 'bar', label: breachLabel, data: breachValues, backgroundColor: COLOR.navyLine,
      stack: 'breachStack', order: 1, maxBarThickness: 56, barPercentage: 0.55, categoryPercentage: 0.65,
      datalabels: { display: 'auto', clamp: true, anchor: 'center', align: 'center', color: '#fff',
        font: { size: 10, weight: '700' }, formatter: v => v > 0.05 ? v.toFixed(1) + '%' : '' } },
  ];
  const baseline = baselineLineDataset(baselineValue, labels.length, 'y');
  if (baseline) { baseline.order = 0; datasets.push(baseline); }
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10 } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center', reverse: true,
          padding: 12, labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: {
          label: ctx => ctx.dataset.label === 'Baseline' ? ` Baseline: ${ctx.formattedValue}%` : ` ${ctx.dataset.label}: ${ctx.formattedValue}%`,
        } },
      },
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
  const datasets = [
    { type: 'bar', label: barLabel, data: barValues, backgroundColor: COLOR.bar, borderColor: COLOR.barBorder,
      borderWidth: 1, borderRadius: 4, order: 2, maxBarThickness: 56, barPercentage: 0.55, categoryPercentage: 0.65,
      datalabels: { display: 'auto', clamp: true, anchor: 'end', align: 'top', color: '#8B2F45',
        font: { size: 10, weight: '600' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
    { type: 'line', label: lineLabel, data: lineValues, borderColor: COLOR.navyLine, backgroundColor: 'rgba(74,20,32,0.08)',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.navyLine, pointBorderWidth: 2,
      tension: 0.3, fill: false, order: 1,
      datalabels: { display: 'auto', clamp: true, align: 'top', offset: 8, color: COLOR.navyLine,
        font: { size: 11, weight: '700' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
  ];
  const baseline = baselineLineDataset(baselineValue, labels.length);
  if (baseline) datasets.push(baseline);
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10 } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center', reverse: false,
          padding: 12, labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.formattedValue}%` } },
      },
      scales: {
        y: { position: 'left', beginAtZero: true, title: { display: true, text: '%', font: { size: 10 } },
          ticks: { font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
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
          font: { size: 10, weight: '700' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
      { label: label2, data: series2, borderColor: COLOR.secondLine, backgroundColor: 'transparent',
        borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.secondLine, pointBorderWidth: 2,
        tension: 0.3, fill: false,
        datalabels: { display: 'auto', clamp: true, align: 'bottom', offset: 6, color: COLOR.secondLine,
          font: { size: 10, weight: '700' }, formatter: v => v > 0 ? v.toFixed(1) + '%' : '' } },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10 } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center',
          padding: 12, labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.formattedValue}%` } },
      },
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
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{
      label, data: values, borderColor: COLOR.singleLine, backgroundColor: 'rgba(176,67,95,0.10)',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.singleLine,
      pointBorderWidth: 2, fill: true, tension: 0.3,
      datalabels: { display: 'auto', clamp: true, align: ctx => ctx.dataIndex % 2 === 0 ? 'top' : 'bottom',
        offset: 6, color: COLOR.singleLine, font: { size: 10, weight: '700' } },
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 10 } }, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', align: 'center',
          padding: 12, labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...TOOLTIP_STYLE, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.formattedValue}` } },
      },
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
    <div class="chart-card"><h3><span class="card-dot dot-share"></span>Rider Share (Inhouse vs 3P)</h3><div class="chart-canvas-wrap"><canvas id="chartRiderShare"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-breach"></span>Breach % + BBD % ${cityMeta.overallBreachBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.overallBreachBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartBreachBdd"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-lt"></span>Long Tail % ${cityMeta.ltBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.ltBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartLT"></canvas></div></div>
    <div class="chart-card"><h3><span class="card-dot dot-tat"></span>P80 LM TAT (hrs)</h3><div class="chart-canvas-wrap"><canvas id="chartLmTat"></canvas></div></div>
    <div class="chart-card span-2"><h3><span class="card-dot dot-retry"></span>Retry Rate</h3><div class="chart-canvas-wrap"><canvas id="chartRetry"></canvas></div></div>`;
}

function storeChartCardsHTML() {
  return `
    <div class="chart-card"><h3><span class="card-dot dot-share"></span>Rider Share (Inhouse vs 3P)</h3><div class="chart-canvas-wrap"><canvas id="chartRiderShare"></canvas></div></div>
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
  const pctFields = ['breachPct','breachWithTolPct','bbdBreachPct','ltPct','dmSharePct','tpSharePct'];
  const avgFields = ['p80LmTat'];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields, avgFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));
  const orders = series.map(r => r.orders);

  makeDualLineChart('chartRiderShare', labels,
    series.map(r => r.dmSharePct != null ? round1_(r.dmSharePct * 100) : null), 'Inhouse Share %',
    series.map(r => r.tpSharePct != null ? round1_(r.tpSharePct * 100) : null), '3P Share %', '%');
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
  const pctFields = ['breachPct','breachWithTolPct','bbdBreachPct','ltPct','dmSharePct','tpSharePct'];
  const avgFields = ['p80LmTat'];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields, avgFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));

  makeDualLineChart('chartRiderShare', labels,
    series.map(r => r.dmSharePct != null ? round1_(r.dmSharePct * 100) : null), 'Inhouse Share %',
    series.map(r => r.tpSharePct != null ? round1_(r.tpSharePct * 100) : null), '3P Share %', '%');
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
      <div class="pan-india-total">
        <div class="pan-india-label">Ageing &gt; (D-0)</div>
        <div class="pan-india-value" style="font-size:22px;">${ageing.total.toLocaleString()}</div>
      </div>
      ${panIndia && panIndia.retryPct != null ? `
      <div class="pan-india-metric">
        <div class="pan-india-metric-val">${(panIndia.retryPct*100).toFixed(1)}%</div>
        <div class="pan-india-bucket-label"><span class="stat-icon">🔁</span> Current Retry Rate</div>
      </div>` : ''}
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
  const canc = schemaWarnings.cancellationNonQcMissingColumns || [];
  if (!nq.length && !qc.length && !sdd.length && !canc.length) return '';
  const parts = [];
  if (nq.length) parts.push(`Dump NONQC: couldn't find column(s) for ${nq.join(', ')}`);
  if (qc.length) parts.push(`Dump QC: couldn't find column(s) for ${qc.join(', ')}`);
  if (sdd.length) parts.push(`SDD & Faster %: couldn't find column(s) for ${sdd.join(', ')}`);
  if (canc.length) parts.push(`Cancellation Non-QC: couldn't find column(s) for ${canc.join(', ')}`);
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

function cityIconHTML_(cityName) {
  const key = (cityName || '').toString().trim().toUpperCase();
  const data = CITY_ICON_DATA[key] || CITY_ICON_FALLBACK;
  return `<svg class="city-icon" viewBox="0 0 24 24" fill="none" stroke="${data.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${data.path}</svg>`;
}

function coldChainHTML(coldChain) {
  if (!coldChain) return '';
  const pct = v => (v * 100).toFixed(1) + '%';
  return `
    <div class="scorecard cold-scorecard">
      <div class="scorecard-label"><span class="stat-icon">🌡️</span> Cold Chain Breach <span class="scorecard-date">(${coldChain.dateRange})</span></div>
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
