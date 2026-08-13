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
    return out;
  });
}

function baselineLineDataset(value, len) {
  if (value == null) return null;
  return {
    type: 'line', label: 'Baseline', yAxisID: 'yPct',
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
      borderColor: COLOR.barBorder, borderWidth: 1, borderRadius: 4, order: 2,
      datalabels: { display: showLabels, anchor: 'end', align: 'top', color: '#3E7CA6', font: { size: 10, weight: '600' },
        formatter: v => v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v } },
    { type: 'line', label: pctLabel, yAxisID: 'yPct', data: pctValues, borderColor: COLOR.navyLine,
      backgroundColor: 'rgba(22,50,79,0.08)', borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff',
      pointBorderColor: COLOR.navyLine, pointBorderWidth: 2, tension: 0.3, fill: false, order: 1,
      datalabels: { display: showLabels, align: 'top', offset: 8, color: COLOR.navyLine, font: { size: 11, weight: '700' },
        formatter: v => v.toFixed(1) + '%' } },
  ];
  if (extraLineDatasets) datasets.push(...extraLineDatasets);
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'start', reverse: false,
          labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
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

// Two % metrics, one bar one line, sharing a single % axis (e.g. LM% bar + Long Tail% line)
function makeDualMetricCombo(canvasId, labels, barValues, barLabel, lineValues, lineLabel, baselineValue) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const showLabels = labels.length <= 10;
  const datasets = [
    { type: 'bar', label: barLabel, data: barValues, backgroundColor: COLOR.bar, borderColor: COLOR.barBorder,
      borderWidth: 1, borderRadius: 4, order: 2,
      datalabels: { display: showLabels, anchor: 'end', align: 'top', color: '#3E7CA6', font: { size: 10, weight: '600' }, formatter: v => v.toFixed(1) + '%' } },
    { type: 'line', label: lineLabel, data: lineValues, borderColor: COLOR.navyLine, backgroundColor: 'rgba(22,50,79,0.08)',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.navyLine, pointBorderWidth: 2,
      tension: 0.3, fill: false, order: 1,
      datalabels: { display: showLabels, align: 'top', offset: 8, color: COLOR.navyLine, font: { size: 11, weight: '700' }, formatter: v => v.toFixed(1) + '%' } },
  ];
  const baseline = baselineLineDataset(baselineValue, labels.length);
  if (baseline) datasets.push(baseline);
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'start', reverse: false,
        labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } } },
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
        datalabels: { display: showLabels, align: 'top', offset: 6, color: COLOR.singleLine, font: { size: 10, weight: '700' }, formatter: v => v.toFixed(1) + '%' } },
      { label: label2, data: series2, borderColor: COLOR.secondLine, backgroundColor: 'transparent',
        borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.secondLine, pointBorderWidth: 2,
        tension: 0.3, fill: false,
        datalabels: { display: showLabels, align: 'bottom', offset: 6, color: COLOR.secondLine, font: { size: 10, weight: '700' }, formatter: v => v.toFixed(1) + '%' } },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'start',
        labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } } },
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
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'start',
        labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } } },
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
    <div class="chart-card"><h3>Breach % ${cityMeta.overallBreachBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.overallBreachBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartBreach"></canvas></div></div>
    <div class="chart-card"><h3>Long Tail % (LM Induced) ${cityMeta.ltBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.ltBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartLT"></canvas></div></div>
    <div class="chart-card"><h3>BDD %</h3><div class="chart-canvas-wrap"><canvas id="chartBdd"></canvas></div></div>
    <div class="chart-card"><h3>Cancellation %</h3><div class="chart-canvas-wrap"><canvas id="chartCancel"></canvas></div></div>
    <div class="chart-card"><h3>Retry Rate</h3><div class="chart-canvas-wrap"><canvas id="chartRetry"></canvas></div></div>
    <div class="chart-card"></div>
    <div class="section-divider">Queue-Level TAT in Hrs (P80)</div>
    <div class="chart-card"><h3>Overall TAT</h3><div class="chart-canvas-wrap"><canvas id="chartTatOverall"></canvas></div></div>
    <div class="chart-card"><h3>SQ &rarr; MDQ</h3><div class="chart-canvas-wrap"><canvas id="chartTatSqMdq"></canvas></div></div>
    <div class="chart-card"><h3>MDQ &rarr; Del</h3><div class="chart-canvas-wrap"><canvas id="chartTatMdqDel"></canvas></div></div>`;
}

function qcChartCardsHTML(cityMeta) {
  return `
    <div class="chart-card"><h3>Rider Share (DM vs 3P)</h3><div class="chart-canvas-wrap"><canvas id="chartRiderShare"></canvas></div></div>
    <div class="chart-card"><h3>Breach % ${cityMeta.overallBreachBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.overallBreachBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartBreach"></canvas></div></div>
    <div class="chart-card"><h3>LM Breach + Long Tail Breach ${cityMeta.ltBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>LT Baseline ${(cityMeta.ltBaseline*100).toFixed(1)}%</span>` : ''}</h3><div class="chart-canvas-wrap"><canvas id="chartLmLt"></canvas></div></div>
    <div class="chart-card"><h3>Retry Rate</h3><div class="chart-canvas-wrap"><canvas id="chartRetry"></canvas></div></div>`;
}

function storeChartCardsHTML() {
  return `
    <div class="chart-card"><h3>Rider Share (DM vs 3P)</h3><div class="chart-canvas-wrap"><canvas id="chartRiderShare"></canvas></div></div>
    <div class="chart-card"><h3>Breach % <span class="baseline-legend"><span class="baseline-swatch"></span>Baseline 40.0%</span></h3><div class="chart-canvas-wrap"><canvas id="chartBreach"></canvas></div></div>
    <div class="chart-card"><h3>LM Breach + Long Tail Breach <span class="baseline-legend"><span class="baseline-swatch"></span>LT Baseline 4.0%</span></h3><div class="chart-canvas-wrap"><canvas id="chartLmLt"></canvas></div></div>`;
}

function renderNonQcCharts(cityMeta, rawSeries, period) {
  const pctFields = ['breachPct','ltPct','bddPct','cancellationPct'];
  const avgFields = ['overallTat','sqToMdq','mdqToDel'];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields, avgFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));
  const orders = series.map(r => r.orders);

  makeComboChart('chartBreach', labels, orders, series.map(r => round1_(r.breachPct * 100)), 'Breach %',
    [baselineLineDataset(cityMeta.overallBreachBaseline, series.length)].filter(Boolean),
    items => [`Breach orders: ${series[items[0].dataIndex].breachOrders ?? '\u2014'} of ${series[items[0].dataIndex].orders ?? '\u2014'}`]);
  makeComboChart('chartLT', labels, orders, series.map(r => round1_(r.ltPct * 100)), 'Long Tail %',
    [baselineLineDataset(cityMeta.ltBaseline, series.length)].filter(Boolean));
  makeComboChart('chartBdd', labels, orders, series.map(r => round1_(r.bddPct * 100)), 'BDD %', null);
  makeComboChart('chartCancel', labels, orders, series.map(r => round1_(r.cancellationPct * 100)), 'Cancellation %', null);
  makeComboChart('chartRetry', labels, series.map(r => r.ofdOrders ?? 0), series.map(r => r.retryRate != null ? round1_(r.retryRate * 100) : null), 'Retry %', null,
    items => [`Retries: ${series[items[0].dataIndex].retries ?? '\u2014'} of ${series[items[0].dataIndex].ofdOrders ?? '\u2014'} OFD orders`]);

  makeSingleLineChart('chartTatOverall', labels, series.map(r => r.overallTat), 'Overall TAT (min)', 'Minutes');
  makeSingleLineChart('chartTatSqMdq', labels, series.map(r => r.sqToMdq), 'SQ\u2192MDQ (min)', 'Minutes');
  makeSingleLineChart('chartTatMdqDel', labels, series.map(r => r.mdqToDel), 'MDQ\u2192Del (min)', 'Minutes');
}

function renderQcCharts(cityMeta, rawSeries, period) {
  const pctFields = ['toleranceBreachPct','lmBreachPct','longTailBreachPct','dmSharePct','tpSharePct'];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));
  const orders = series.map(r => r.orders);

  makeDualLineChart('chartRiderShare', labels, series.map(r => round1_(r.dmSharePct * 100)), 'DM Share %',
    series.map(r => round1_(r.tpSharePct * 100)), '3P Share %', '%');
  makeComboChart('chartBreach', labels, orders, series.map(r => round1_(r.toleranceBreachPct * 100)), 'Breach %',
    [baselineLineDataset(cityMeta.overallBreachBaseline, series.length)].filter(Boolean));
  makeDualMetricCombo('chartLmLt', labels, series.map(r => round1_(r.lmBreachPct * 100)), 'LM Breach %',
    series.map(r => round1_(r.longTailBreachPct * 100)), 'Long Tail Breach %', cityMeta.ltBaseline);
  makeComboChart('chartRetry', labels, series.map(r => r.ofdOrders ?? 0), series.map(r => r.retryRate != null ? round1_(r.retryRate * 100) : null), 'Retry %', null,
    items => [`Retries: ${series[items[0].dataIndex].retries ?? '\u2014'} of ${series[items[0].dataIndex].ofdOrders ?? '\u2014'} OFD orders`]);
}

function renderStoreCharts(rawSeries, period) {
  const pctFields = ['toleranceBreachPct','lmBreachPct','longTailBreachPct','dmSharePct','tpSharePct'];
  const series = period === 'WoW' ? toWeekly(rawSeries, pctFields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));

  makeDualLineChart('chartRiderShare', labels, series.map(r => round1_(r.dmSharePct * 100)), 'DM Share %',
    series.map(r => round1_(r.tpSharePct * 100)), '3P Share %', '%');
  makeComboChart('chartBreach', labels, series.map(r => r.orders), series.map(r => round1_(r.toleranceBreachPct * 100)), 'Breach %',
    [baselineLineDataset(0.40, series.length)].filter(Boolean));
  makeDualMetricCombo('chartLmLt', labels, series.map(r => round1_(r.lmBreachPct * 100)), 'LM Breach %',
    series.map(r => round1_(r.longTailBreachPct * 100)), 'Long Tail Breach %', 0.04);
}

// ======================= STAT PANELS =======================
function statPanelsHTML(orderSummary, coldChain, ageing, ageingLabel) {
  const cold = coldChainHTML(coldChain);
  const ageingCard = ageingHTML(ageing, ageingLabel);
  return `<div class="scorecard-row">
      ${orderSummary ? `
      <div class="scorecard">
        <div class="scorecard-label">Total Orders <span class="scorecard-date">(${fmtDayLabel(orderSummary.date)})</span></div>
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

function ageingHTML(ageing, label) {
  if (!ageing || !ageing.total) return '';
  const pct = n => ageing.total ? ((n / ageing.total) * 100).toFixed(1) + '%' : '0%';
  return `
    <div class="scorecard ageing-scorecard">
      <div class="scorecard-label">Ageing Orders ${label ? `<span class="scorecard-date">(${label})</span>` : ''}</div>
      <div class="scorecard-value">${ageing.total.toLocaleString()}</div>
      <div class="cold-breakdown">
        <div class="cold-bar-row"><span class="cold-bar-label">D-1</span><div class="cold-bar-track"><div class="cold-bar-fill low" style="width:${pct(ageing.d1)}"></div></div><span class="cold-bar-val">${ageing.d1} (${pct(ageing.d1)})</span></div>
        <div class="cold-bar-row"><span class="cold-bar-label">D-2</span><div class="cold-bar-track"><div class="cold-bar-fill high" style="width:${pct(ageing.d2)}"></div></div><span class="cold-bar-val">${ageing.d2} (${pct(ageing.d2)})</span></div>
        <div class="cold-bar-row"><span class="cold-bar-label">D-3</span><div class="cold-bar-track"><div class="cold-bar-fill both" style="width:${pct(ageing.d3)}"></div></div><span class="cold-bar-val">${ageing.d3} (${pct(ageing.d3)})</span></div>
        <div class="cold-bar-row"><span class="cold-bar-label">D-4 &amp; D-5</span><div class="cold-bar-track"><div class="cold-bar-fill high" style="width:${pct(ageing.d4+ageing.d5)}"></div></div><span class="cold-bar-val">${ageing.d4+ageing.d5} (${pct(ageing.d4+ageing.d5)})</span></div>
        <div class="cold-bar-row"><span class="cold-bar-label">&gt;5 days</span><div class="cold-bar-track"><div class="cold-bar-fill both" style="width:${pct(ageing.gt5)}"></div></div><span class="cold-bar-val">${ageing.gt5} (${pct(ageing.gt5)})</span></div>
      </div>
    </div>`;
}

function coldChainHTML(coldChain) {
  if (!coldChain) return '';
  const pct = v => (v * 100).toFixed(1) + '%';
  return `
    <div class="scorecard cold-scorecard">
      <div class="scorecard-label">Cold Chain Breach <span class="scorecard-date">(${coldChain.dateRange})</span></div>
      <div class="scorecard-value">${pct(coldChain.breachPct)} <span class="scorecard-sub">of ${coldChain.totalTrips} trips</span></div>
      <div class="cold-breakdown">
        <div class="cold-bar-row"><span class="cold-bar-label">High only (&gt;8&deg;C)</span><div class="cold-bar-track"><div class="cold-bar-fill high" style="width:${(coldChain.highOnlyPct*100).toFixed(1)}%"></div></div><span class="cold-bar-val">${coldChain.highOnly} (${pct(coldChain.highOnlyPct)})</span></div>
        <div class="cold-bar-row"><span class="cold-bar-label">Low only (&lt;2&deg;C)</span><div class="cold-bar-track"><div class="cold-bar-fill low" style="width:${(coldChain.lowOnlyPct*100).toFixed(1)}%"></div></div><span class="cold-bar-val">${coldChain.lowOnly} (${pct(coldChain.lowOnlyPct)})</span></div>
        <div class="cold-bar-row"><span class="cold-bar-label">Both breaches</span><div class="cold-bar-track"><div class="cold-bar-fill both" style="width:${(coldChain.bothPct*100).toFixed(1)}%"></div></div><span class="cold-bar-val">${coldChain.both} (${pct(coldChain.bothPct)})</span></div>
      </div>
    </div>`;
}

// ======================= STORE LIST (QC city page) =======================
function storeListHTML(storesPayload) {
  if (!storesPayload || storesPayload.error || !storesPayload.stores.length) return '';
  const rows = storesPayload.stores.map(s => `
    <div class="store-row" onclick="window.location.href='store.html?store=${encodeURIComponent(s.storeCode)}'">
      <span class="store-code">${s.storeCode}</span>
      <span>${s.totalOrders.toLocaleString()}</span>
      <span>${(s.dmSharePct*100).toFixed(1)}%</span>
      <span>${(s.tpSharePct*100).toFixed(1)}%</span>
    </div>`).join('');
  return `
    <div class="section-label">Stores in ${storesPayload.city} <span style="font-weight:500;text-transform:none;">(as of ${fmtDayLabel(storesPayload.asOf)})</span></div>
    <div class="store-list">
      <div class="store-row store-header">
        <span>Store</span><span>Total Orders</span><span>DM Share</span><span>3P Share</span>
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
  if (typeof opts === 'number') opts = { ttlMs: opts }; // back-compat with old (url, ttlMs) callers
  opts = opts || {};
  const ttlMs = opts.ttlMs || 5 * 60 * 1000;
  const staleMs = opts.staleMs || 24 * 60 * 60 * 1000; // still shown instantly while revalidating
  const key = 'visioncache:' + url;

  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(key)); } catch (e) { /* ignore corrupt entry */ }

  const age = cached ? Date.now() - cached.ts : Infinity;
  if (cached && age < ttlMs) return cached.data; // fresh — no network needed at all

  if (cached && age < staleMs) {
    // Stale but usable: hand back what we have right now, refresh quietly behind it
    fetchAndCache_(url, key).then(fresh => {
      if (opts.onRevalidate) opts.onRevalidate(fresh);
    }).catch(() => { /* background revalidation failure is non-fatal — stale data stays on screen */ });
    return cached.data;
  }

  return fetchAndCache_(url, key); // nothing usable cached — must block on a real fetch
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

async function fetchCityData(city, service, onRevalidate) {
  return cachedFetchJSON(`${WEBAPP_URL}?action=city&city=${encodeURIComponent(city)}&service=${encodeURIComponent(service)}`, { onRevalidate });
}
async function fetchStoresData(city) {
  return cachedFetchJSON(`${WEBAPP_URL}?action=stores&city=${encodeURIComponent(city)}`);
}
async function fetchStoreData(storeCode, onRevalidate) {
  return cachedFetchJSON(`${WEBAPP_URL}?action=store&storeCode=${encodeURIComponent(storeCode)}`, { onRevalidate });
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
async function prefetchAllCitiesAndStores() {
  try {
    const meta = await cachedFetchJSON(`${WEBAPP_URL}?action=meta`, 10 * 60 * 1000);
    const tasks = [];
    Object.entries(meta.citiesByService || {}).forEach(([service, cities]) => {
      cities.forEach(city => {
        tasks.push(() => fetchCityData(city, service));
        if (service === 'QC') {
          tasks.push(async () => {
            const sd = await fetchStoresData(city);
            if (sd && sd.stores) {
              sd.stores.forEach(s => tasks.push(() => fetchStoreData(s.storeCode)));
            }
          });
        }
      });
    });
    await runWithConcurrency_(tasks, 4); // cap concurrent requests so we don't hammer the Apps Script quota
  } catch (e) { /* background warming is best-effort — a failure here shouldn't affect the visible page */ }
}

function loadErrorHTML(message, retryFnName) {
  return `<div class="empty-state">Couldn't load data: ${message}
    <div style="margin-top:10px;"><button class="nav-btn" style="background:var(--header-blue);border:none;" onclick="${retryFnName}()">Retry</button></div>
  </div>`;
}
