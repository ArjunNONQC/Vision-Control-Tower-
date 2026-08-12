// Shared between city.html and explore.html
const charts = {};

// Single consistent theme across every chart, matching the AWS Quick reference:
// combo charts = light-blue bars + navy line; single-metric charts = one light-blue line.
const COLOR = {
  bar: 'rgba(125, 199, 240, 0.75)',
  barBorder: '#4FB3E8',
  navyLine: '#16324F',
  singleLine: '#4FB3E8',   // uniform color for every single-metric chart (NPS, TAT x4)
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
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const sameMonth = mon.getMonth() === sun.getMonth();
  return sameMonth
    ? `${mon.getDate()}-${sun.getDate()} ${MONTHS[mon.getMonth()]}`
    : `${mon.getDate()} ${MONTHS[mon.getMonth()]} - ${sun.getDate()} ${MONTHS[sun.getMonth()]}`;
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
    const out = { date: w.date, _isWeekStart: true };
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

function round1_(n) { return Math.round(n * 10) / 10; }

function baselineLineDataset(value, len) {
  if (value == null) return null;
  return {
    type: 'line', label: 'Baseline', yAxisID: 'yPct',
    data: Array(len).fill(round1_(value * 100)),
    borderColor: COLOR.baseline, borderDash: [6, 4], pointRadius: 0, borderWidth: 2, fill: false,
    datalabels: { display: false },
  };
}

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
      data: pctValues, borderColor: COLOR.navyLine, backgroundColor: 'rgba(22,50,79,0.08)',
      borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: COLOR.navyLine,
      pointBorderWidth: 2, tension: 0.3, fill: false, order: 1,
      datalabels: {
        display: showLabels, align: 'top', offset: 8, color: COLOR.navyLine,
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
          display: true, position: 'top', align: 'start', reverse: false,
          labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' },
        },
        tooltip: { callbacks: tooltipExtra ? { afterBody: tooltipExtra } : undefined },
      },
      scales: {
        yOrders: {
          position: 'left', beginAtZero: true,
          title: { display: true, text: 'Orders', font: { size: 10 } },
          ticks: { font: { size: 10 } }, grid: { display: false },
        },
        yPct: {
          position: 'right', beginAtZero: true,
          title: { display: true, text: '%', font: { size: 10 } },
          ticks: { font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#F0F4F8' },
        },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

// Single-metric line chart, uniform light-blue theme
function makeSingleLineChart(canvasId, labels, values, label, yLabel) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const showLabels = labels.length <= 10;
  const ctx = canvas.getContext('2d');
  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label, data: values,
        borderColor: COLOR.singleLine, backgroundColor: 'rgba(79,179,232,0.10)',
        borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff',
        pointBorderColor: COLOR.singleLine, pointBorderWidth: 2, fill: true, tension: 0.3,
        datalabels: {
          display: showLabels, align: 'top', offset: 6, color: COLOR.singleLine,
          font: { size: 10, weight: '700' },
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
      },
      scales: {
        y: { title: { display: true, text: yLabel, font: { size: 10 } }, ticks: { font: { size: 10 } }, grid: { color: '#F0F4F8' } },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

function chartCardsHTML(cityMeta) {
  return `
    <div class="chart-card">
      <h3>Breach % ${cityMeta.overallBreachBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.overallBreachBaseline*100).toFixed(1)}%</span>` : ''}</h3>
      <div class="chart-canvas-wrap"><canvas id="chartBreach"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>Long Tail % (LM Induced) ${cityMeta.ltBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.ltBaseline*100).toFixed(1)}%</span>` : ''}</h3>
      <div class="chart-canvas-wrap"><canvas id="chartLT"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>Cancellation %</h3>
      <div class="chart-canvas-wrap"><canvas id="chartCancel"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>NPS (Rolling 7 Days)</h3>
      <div class="chart-canvas-wrap"><canvas id="chartNps"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>Retry Rate</h3>
      <div class="chart-canvas-wrap"><canvas id="chartRetry"></canvas></div>
    </div>
    <div class="chart-card" style="visibility:hidden;"></div>

    <div class="section-divider">Queue-Level TAT in Hrs (90th %ile)</div>

    <div class="chart-card">
      <h3>Overall TAT</h3>
      <div class="chart-canvas-wrap"><canvas id="chartTatOverall"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>SQ → MDQ</h3>
      <div class="chart-canvas-wrap"><canvas id="chartTatSqMdq"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>MDQ → Del</h3>
      <div class="chart-canvas-wrap"><canvas id="chartTatMdqDel"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>ETA</h3>
      <div class="chart-canvas-wrap"><canvas id="chartTatEta"></canvas></div>
    </div>`;
}

function orderSummaryHTML(orderSummary) {
  if (!orderSummary) return '';
  return `
    <div class="scorecard-row">
      <div class="scorecard">
        <div class="scorecard-label">Total Orders <span class="scorecard-date">(${fmtDayLabel(orderSummary.date)})</span></div>
        <div class="scorecard-value">${orderSummary.total.toLocaleString()}</div>
        <div class="scorecard-breakdown">
          <span><span class="dot qc"></span>QC: ${orderSummary.qc.toLocaleString()}</span>
          <span><span class="dot nonqc"></span>Non-QC: ${orderSummary.nonQc.toLocaleString()}</span>
        </div>
      </div>
    </div>`;
}

function renderCityCharts(cityMeta, rawSeries, period) {
  const fields = ['breachPct','ltPct','cancellationPct','nps','overallTat','sqToMdq','mdqToDel','eta','retryRate'];
  const series = period === 'WoW' ? toWeekly(rawSeries, fields) : rawSeries;
  const labels = series.map(r => period === 'WoW' ? fmtWeekLabel(r.date) : fmtDayLabel(r.date));
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

  const retryPct = series.map(r => (r.retryRate != null ? round1_(r.retryRate * 100) : null));
  makeComboChart('chartRetry', labels, series.map(r => r.ofdOrders ?? 0), retryPct, 'Retry %', null, (items) => {
    const r = series[items[0].dataIndex];
    return [`Retries: ${r.retries ?? '—'} of ${r.ofdOrders ?? '—'} OFD orders`];
  });

  makeSingleLineChart('chartNps', labels, series.map(r => r.nps), 'NPS', 'Score');
  makeSingleLineChart('chartTatOverall', labels, series.map(r => r.overallTat), 'Overall TAT (min)', 'Minutes');
  makeSingleLineChart('chartTatSqMdq', labels, series.map(r => r.sqToMdq), 'SQ→MDQ (min)', 'Minutes');
  makeSingleLineChart('chartTatMdqDel', labels, series.map(r => r.mdqToDel), 'MDQ→Del (min)', 'Minutes');
  makeSingleLineChart('chartTatEta', labels, series.map(r => r.eta), 'ETA (min)', 'Minutes');
}

async function fetchCityData(city, service) {
  const url = `${WEBAPP_URL}?action=city&city=${encodeURIComponent(city)}&service=${encodeURIComponent(service)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
