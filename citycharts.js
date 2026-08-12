// Shared between city.html and explore.html
const charts = {};

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
    return out;
  });
}

function baselineDataset(value, len, label) {
  if (value == null) return null;
  return {
    label, data: Array(len).fill(value * 100),
    borderColor: '#C0392B', borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5, fill: false,
  };
}

function makeLineChart(canvasId, labels, datasets, yLabel, absoluteTooltipFn) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: absoluteTooltipFn ? { callbacks: { afterBody: absoluteTooltipFn } } : {}
      },
      scales: {
        y: { title: { display: true, text: yLabel, font: { size: 11 } }, ticks: { font: { size: 10 } } },
        x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45 } }
      }
    }
  });
}

function chartCardsHTML(cityMeta) {
  return `
    <div class="chart-card">
      <h3>Breach % ${cityMeta.overallBreachBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.overallBreachBaseline*100).toFixed(1)}%</span>` : '<span class="baseline-legend">No baseline set</span>'}</h3>
      <div class="sub">Hover a point to see absolute order counts</div>
      <canvas id="chartBreach"></canvas>
    </div>
    <div class="chart-card">
      <h3>Long Tail % (LM Induced) ${cityMeta.ltBaseline != null ? `<span class="baseline-legend"><span class="baseline-swatch"></span>Baseline ${(cityMeta.ltBaseline*100).toFixed(1)}%</span>` : ''}</h3>
      <div class="sub">Hover a point to see order volume</div>
      <canvas id="chartLT"></canvas>
    </div>
    <div class="chart-card">
      <h3>Cancellation %</h3>
      <div class="sub">No baseline set yet</div>
      <canvas id="chartCancel"></canvas>
    </div>
    <div class="chart-card">
      <h3>NPS (Rolling 7 Days)</h3>
      <div class="sub">No baseline set yet</div>
      <canvas id="chartNps"></canvas>
    </div>
    <div class="chart-card">
      <h3>TAT Breakdown (90th %ile)</h3>
      <div class="sub">Overall / SQ→MDQ / MDQ→Del / ETA — no baselines set yet</div>
      <canvas id="chartTat"></canvas>
    </div>
    <div class="chart-card">
      <h3>Retry Rate</h3>
      <div class="sub">Hover a point to see absolute retry counts</div>
      <canvas id="chartRetry"></canvas>
    </div>`;
}

function renderCityCharts(cityMeta, rawSeries, period) {
  const fields = ['breachPct','ltPct','cancellationPct','nps','overallTat','sqToMdq','mdqToDel','eta','retryRate'];
  const series = period === 'WoW' ? toWeekly(rawSeries, fields) : rawSeries;
  const labels = series.map(r => r.date);

  const breachDatasets = [{
    label: 'Breach %', data: series.map(r => r.breachPct * 100),
    borderColor: '#1F4E79', backgroundColor: 'rgba(31,78,121,0.08)', fill: true, tension: 0.25
  }];
  const bBaseline = baselineDataset(cityMeta.overallBreachBaseline, series.length, 'Baseline');
  if (bBaseline) breachDatasets.push(bBaseline);
  makeLineChart('chartBreach', labels, breachDatasets, '%', (items) => {
    const r = series[items[0].dataIndex];
    return [`Absolute: ${r.breachOrders ?? '—'} of ${r.orders ?? '—'} orders`];
  });

  const ltDatasets = [{
    label: 'Long Tail %', data: series.map(r => r.ltPct * 100),
    borderColor: '#2E5C8A', backgroundColor: 'rgba(46,92,138,0.08)', fill: true, tension: 0.25
  }];
  const ltBaseline = baselineDataset(cityMeta.ltBaseline, series.length, 'Baseline');
  if (ltBaseline) ltDatasets.push(ltBaseline);
  makeLineChart('chartLT', labels, ltDatasets, '%', (items) => {
    const r = series[items[0].dataIndex];
    return [`Orders that day: ${r.orders ?? '—'}`];
  });

  makeLineChart('chartCancel', labels, [{
    label: 'Cancellation %', data: series.map(r => r.cancellationPct * 100),
    borderColor: '#C0392B', backgroundColor: 'rgba(192,57,43,0.08)', fill: true, tension: 0.25
  }], '%');

  makeLineChart('chartNps', labels, [{
    label: 'NPS (rolling 7d)', data: series.map(r => r.nps),
    borderColor: '#1E8449', backgroundColor: 'rgba(30,132,73,0.08)', fill: true, tension: 0.25
  }], 'Score');

  makeLineChart('chartTat', labels, [
    { label: 'Overall TAT (90th %ile, min)', data: series.map(r => r.overallTat), borderColor: '#1F4E79', tension: 0.25 },
    { label: 'SQ→MDQ (min)', data: series.map(r => r.sqToMdq), borderColor: '#8E6C21', tension: 0.25 },
    { label: 'MDQ→Del (min)', data: series.map(r => r.mdqToDel), borderColor: '#6C3483', tension: 0.25 },
    { label: 'ETA (90th %ile, min)', data: series.map(r => r.eta), borderColor: '#B03A2E', tension: 0.25 },
  ], 'Minutes');

  makeLineChart('chartRetry', labels, [{
    label: 'Retry rate', data: series.map(r => (r.retryRate != null ? r.retryRate * 100 : null)),
    borderColor: '#B8860B', backgroundColor: 'rgba(184,134,11,0.08)', fill: true, tension: 0.25
  }], '%', (items) => {
    const r = series[items[0].dataIndex];
    return [`Absolute: ${r.retries ?? '—'} of ${r.ofdOrders ?? '—'} OFD orders`];
  });
}

async function fetchCityData(city, service) {
  const url = `${WEBAPP_URL}?action=city&city=${encodeURIComponent(city)}&service=${encodeURIComponent(service)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
