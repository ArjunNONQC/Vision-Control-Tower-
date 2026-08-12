// Shared between city.html and explore.html
const charts = {};

const COLOR = {
  bar: 'rgba(125, 199, 240, 0.75)',
  barBorder: '#4FB3E8',
  line: '#16324F',
  baseline: '#E74C3C',
  cancel: '#E74C3C',
  nps: '#1E8449',
  retryLine: '#D68910',
};

if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
  Chart.register(ChartDataLabels);
}

function toWeekly(series, fields) {
  const weeks = {};
  series.forEach(row => {
    const d = new Date(row.date + 'T00:00:00');
    const day = d.getDay();
    const monOffset = (day === 0 ? -6 : 1 - day);
    const monday = new Date(d);
    monday.setDate(d.getDate() + monOffset);
    const key = monday.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = { date: key, _rows: [] };
    weeks[key]._rows.push(row);
  });
  return Object.values(weeks).sort((a, b) => a.date.localeCompare(b.date)).map(w => {
    const out = { date: 'wk ' + w.date };
    const rows = w._rows;
    const totalOrders = rows.reduce((s, r) => s + (r.orders || 0), 0);
    fields.forEach(f => {
      if (f === 'breachPct') {
        const totalBreach = rows.reduce((s, r) => s + (r.breachOrders || 0), 0);
        out[f] = totalOrders ? totalBreach / totalOrders : 0;
      } else if (['ltPct', 'cancellationPct'].includes(f)) {
        out[f] = totalOrders ? rows.reduce((s, r) => s + (r[f] || 0) * (r.orders || 0), 0) / totalOrders : 0;
      } else {
        const vals = rows.map(r => r[f]).filter(v => v != null);
        out[f] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      }
    });
    out.orders = totalOrders;
    out.breachOrders = rows.reduce((s, r) => s + (r.breachOrders || 0), 0);
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

function round1_(n) { return Math.round(n * 10) / 10; }

// Combo chart: light-blue bars = order volume (left axis), navy line = headline % metric (right axis)
function makeComboChart(canvasId, labels, orders, pctValues, pctLabel, extraLineDatasets, tooltipExtra) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const showLabels = labels.length <= 10;
  const ctx = canvas.getContext('2d');

  const datasets = [
    {
      type: 'bar', label: 'Orders', yAxisID: 'yOrders',
      data: orders, backgroundColor: COLOR.bar, borderColor: COLOR.barBorder, borderWidth: 1,
      borderRadius: 4, order: 2,
      datalabels: {
        display: showLabels, anchor: 'end', align: 'top', color: '#3E7CA6',
        font: { size: 10, weight: '600' },
        formatter: v => v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v,
      },
    },
    {
      type: 'line', label: pctLabel, yAxisID: 'yPct',
      data: pctValues, borderColor: COLOR.line, backgroundColor: 'rgba(22,50,79,0.08)',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.line,
      pointBorderWidth: 2, tension: 0.3, fill: false, order: 1,
      datalabels: {
        display: showLabels, align: 'top', offset: 8, color: COLOR.line,
        font: { size: 11, weight: '700' },
        formatter: v => v.toFixed(1) + '%',
      },
    },
  ];
  if (extraLineDatasets) datasets.push(...extraLineDatasets);

  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'top', reverse: false,
          labels: { boxWidth: 12, font: { size: 11, weight: '600' }, usePointStyle: true },
        },
        tooltip: { callbacks: tooltipExtra ? { afterBody: tooltipExtra } : undefined },
      },
      scales: {
        yOrders: {
          position: 'left', beginAtZero: true,
          title: { display: true, text: 'Orders', font: { size: 11 } },
          ticks: { font: { size: 10 } }, grid: { display: false },
        },
        yPct: {
          position: 'right', beginAtZero: true,
          title: { display: true, text: '%', font: { size: 11 } },
          ticks: { font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#F0F4F8' },
        },
        x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45 }, grid: { display: false } },
      },
    },
  });
}

function makeLineOnlyChart(canvasId, labels, datasets, yLabel) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const showLabels = labels.length <= 10;
  datasets.forEach(ds => {
    ds.datalabels = ds.datalabels || {
      display: showLabels, align: 'top', offset: 6, color: ds.borderColor,
      font: { size: 10, weight: '700' },
    };
  });
  const ctx = canvas.getContext('2d');
  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: '600' }, usePointStyle: true } },
      },
      scales: {
        y: { title: { display: true, text: yLabel, font: { size: 11 } }, ticks: { font: { size: 10 } }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45 }, grid: { display: false } },
      },
    },
  });
}

function chartCardsHTML(cityMeta) {
  return `
    <div class="chart-card">
      <h3>Breach % ${cityMeta.overallBreachBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.overallBreachBaseline*100).toFixed(1)}%</span>` : '<span class="baseline-legend">No baseline set</span>'}</h3>
      <div class="sub">Bars = order volume · Line = breach %</div>
      <div class="chart-canvas-wrap"><canvas id="chartBreach"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>Long Tail % (LM Induced) ${cityMeta.ltBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.ltBaseline*100).toFixed(1)}%</span>` : ''}</h3>
      <div class="sub">Bars = order volume · Line = long tail %</div>
      <div class="chart-canvas-wrap"><canvas id="chartLT"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>Cancellation %</h3>
      <div class="sub">Bars = order volume · Line = cancellation % · No baseline set yet</div>
      <div class="chart-canvas-wrap"><canvas id="chartCancel"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>NPS (Rolling 7 Days)</h3>
      <div class="sub">No baseline set yet</div>
      <div class="chart-canvas-wrap"><canvas id="chartNps"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>TAT Breakdown (90th %ile)</h3>
      <div class="sub">Overall / SQ→MDQ / MDQ→Del / ETA — no baselines set yet</div>
      <div class="chart-canvas-wrap"><canvas id="chartTat"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>Retry Rate</h3>
      <div class="sub">Bars = OFD orders · Line = retry %</div>
      <div class="chart-canvas-wrap"><canvas id="chartRetry"></canvas></div>
    </div>`;
}

function renderCityCharts(cityMeta, rawSeries, period) {
  const fields = ['breachPct','ltPct','cancellationPct','nps','overallTat','sqToMdq','mdqToDel','eta','retryRate'];
  const series = period === 'WoW' ? toWeekly(rawSeries, fields) : rawSeries;
  const labels = series.map(r => r.date);
  const orders = series.map(r => r.orders);

  const breachPct = series.map(r => round1_(r.breachPct * 100));
  const breachExtra = [baselineLineDataset(cityMeta.overallBreachBaseline, series.length)].filter(Boolean);
  makeComboChart('chartBreach', labels, orders, breachPct, 'Breach %', breachExtra, (items) => {
    const r = series[items[0].dataIndex];
    return [`Breach orders: ${r.breachOrders ?? '—'} of ${r.orders ?? '—'}`];
  });

  const ltPct = series.map(r => round1_(r.ltPct * 100));
  const ltExtra = [baselineLineDataset(cityMeta.ltBaseline, series.length)].filter(Boolean);
  makeComboChart('chartLT', labels, orders, ltPct, 'Long Tail %', ltExtra);

  const cancelPct = series.map(r => round1_(r.cancellationPct * 100));
  makeComboChart('chartCancel', labels, orders, cancelPct, 'Cancellation %', null);

  makeLineOnlyChart('chartNps', labels, [{
    label: 'NPS (rolling 7d)', data: series.map(r => r.nps),
    borderColor: COLOR.nps, backgroundColor: 'rgba(30,132,73,0.10)', borderWidth: 3,
    pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.nps, pointBorderWidth: 2,
    fill: true, tension: 0.3,
  }], 'Score');

  makeLineOnlyChart('chartTat', labels, [
    { label: 'Overall TAT (min)', data: series.map(r => r.overallTat), borderColor: '#16324F', borderWidth: 2.5, pointRadius: 3, tension: 0.3, datalabels: { display: false } },
    { label: 'SQ→MDQ (min)', data: series.map(r => r.sqToMdq), borderColor: '#D68910', borderWidth: 2.5, pointRadius: 3, tension: 0.3, datalabels: { display: false } },
    { label: 'MDQ→Del (min)', data: series.map(r => r.mdqToDel), borderColor: '#8E44AD', borderWidth: 2.5, pointRadius: 3, tension: 0.3, datalabels: { display: false } },
    { label: 'ETA (min)', data: series.map(r => r.eta), borderColor: '#E74C3C', borderWidth: 2.5, pointRadius: 3, tension: 0.3, datalabels: { display: false } },
  ], 'Minutes');

  const retryPct = series.map(r => (r.retryRate != null ? round1_(r.retryRate * 100) : null));
  makeComboChart('chartRetry', labels, series.map(r => r.ofdOrders ?? 0), retryPct, 'Retry %', null, (items) => {
    const r = series[items[0].dataIndex];
    return [`Retries: ${r.retries ?? '—'} of ${r.ofdOrders ?? '—'} OFD orders`];
  });
}

async function fetchCityData(city, service) {
  const url = `${WEBAPP_URL}?action=city&city=${encodeURIComponent(city)}&service=${encodeURIComponent(service)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
