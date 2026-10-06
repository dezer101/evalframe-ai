const $ = (selector) => document.querySelector(selector);
const runButton = $('#run-button');
const results = $('#results');
const dialog = $('#case-dialog');
const dialogContent = $('#dialog-content');
let lastRun = null;

function safe(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function pct(n) { return `${Number(n).toFixed(1)}%`; }
function metric(name, value, suffix = '') {
  return `<div class="metric"><span>${name}</span><strong>${value}${suffix}</strong></div>`;
}

function renderSummary(data) {
  const base = data.baseline.metrics;
  const next = data.contextual.metrics;
  const delta = (a, b) => `${b - a > 0 ? '+' : ''}${(b-a).toFixed(1)}%`;
  const deltaClass = (a, b) => b > a ? 'up' : b < a ? 'down' : 'flat';
  const scores = [
    ['Scenario pass rate', base.scenario_pass_rate, next.scenario_pass_rate],
    ['Hit@k', base.hit_at_k, next.hit_at_k],
    ['Mean reciprocal rank', base.mrr, next.mrr],
    ['Abstention accuracy', base.abstention_accuracy, next.abstention_accuracy],
  ];
  const changed = data.contextual.cases.reduce((acc, c) => (acc[c.change] += 1, acc), {improved:0, regression:0, steady:0});
  results.innerHTML = `
    <div class="result-head"><div><span class="micro-label">04 — BENCHMARK RESULTS</span><h2>Compare the run</h2></div><span class="run-stamp"><i></i> ${data.case_count} CASES · TOP ${data.contextual.top_k} · THRESHOLD ${data.contextual.threshold.toFixed(2)}</span></div>
    <div class="metric-grid">${scores.map(([label,a,b]) => `<div class="metric-card"><span>${label}</span><div class="metric-values"><div><small>BASELINE</small><strong>${pct(a)}</strong></div><b class="delta ${deltaClass(a,b)}">${delta(a,b)}</b><div><small>CONTEXTUAL</small><strong>${pct(b)}</strong></div></div><div class="metric-track"><i style="width:${Math.max(0,Math.min(100,b))}%"></i></div></div>`).join('')}</div>
    <div class="run-totals"><span><b>${next.passed_cases}/${data.case_count}</b> contextual checks passed</span><span><i class="legend improved"></i>${changed.improved} improved</span><span><i class="legend regression"></i>${changed.regression} regressions</span><span><i class="legend steady"></i>${changed.steady} unchanged</span><span class="metric-foot">Precision@k: ${pct(next.precision_at_k)} contextual · ${pct(base.precision_at_k)} baseline</span></div>
    <div class="case-table-wrap"><table><thead><tr><th>CASE</th><th>SCENARIO</th><th>BASELINE</th><th>CONTEXTUAL</th><th>CHANGE</th><th></th></tr></thead><tbody>${data.contextual.cases.map((c,i) => {
      const b = data.baseline.cases[i];
      const status = c.pass ? 'PASS' : 'MISS';
      const change = c.change === 'improved' ? '↑ IMPROVED' : c.change === 'regression' ? '↓ REGRESSION' : '— STEADY';
      return `<tr class="case-row ${c.change}" data-case-index="${i}" tabindex="0"><td><span class="case-id">${safe(c.id)}</span></td><td><strong>${safe(c.group)}</strong><small>${safe(c.query)}</small></td><td><span class="pill ${b.pass?'pass':'miss'}">${b.pass?'PASS':'MISS'}</span></td><td><span class="pill ${c.pass?'pass':'miss'}">${status}</span></td><td><span class="change-label ${c.change}">${change}</span></td><td><button class="inspect-button" data-case-index="${i}" aria-label="Inspect ${safe(c.id)}">↗</button></td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="result-note">Hit@k and scenario pass rate depend on the selected threshold and result count. Mean reciprocal rank uses the first expected source’s position in the full ranking. These labels are illustrative, hand-written examples.</p>`;
  lastRun = data;
  document.querySelectorAll('[data-case-index]').forEach((el) => {
    el.addEventListener(el.matches('tr') ? 'click' : 'click', () => showCase(Number(el.dataset.caseIndex)));
    if (el.matches('tr')) el.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') showCase(Number(el.dataset.caseIndex)); });
  });
}

function showCase(index) {
  if (!lastRun) return;
  const current = lastRun.contextual.cases[index];
  const baseline = lastRun.baseline.cases[index];
  const formatSources = (items) => items.length ? items.map((item, i) => `<article class="source-card"><div><span>RANK 0${i+1}</span><b>${safe(item.category)}</b></div><h4>${safe(item.title)}</h4><p>${safe(item.body)}</p><small>HEURISTIC SCORE · ${Number(item.score).toFixed(3)}</small></article>`).join('') : '<p class="no-evidence">No document matched this question.</p>';
  const expected = current.expected_sources.length ? current.expected_sources.map((id) => `<code>${safe(id)}</code>`).join(' ') : 'None — should abstain';
  dialogContent.innerHTML = `<span class="micro-label">CASE ${safe(current.id)} · ${safe(current.group)}</span><h2>${safe(current.query)}</h2><p class="case-explanation">${safe(current.note)}</p><div class="expected-line"><span>EXPECTED</span>${expected}</div><div class="dialog-columns"><div><h3>Baseline <span class="pill ${baseline.pass?'pass':'miss'}">${baseline.pass?'PASS':'MISS'}</span></h3>${formatSources(baseline.ranked)}</div><div><h3>Contextual <span class="pill ${current.pass?'pass':'miss'}">${current.pass?'PASS':'MISS'}</span></h3>${formatSources(current.ranked)}</div></div><p class="result-note">${current.abstained ? 'Contextual strategy abstained because the best score was below the selected threshold.' : `Contextual best score: ${Number(current.best_score).toFixed(3)}. Threshold: ${lastRun.contextual.threshold.toFixed(2)}.`} Scores are ranking heuristics, not probabilities.</p>`;
  dialog.showModal();
}

$('#threshold').addEventListener('input', (event) => { $('#threshold-value').textContent = Number(event.target.value).toFixed(2); });
$('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  runButton.innerHTML = '<span>Running checks…</span><b class="spin">↻</b>';
  results.innerHTML = '<div class="loading-state"><i></i><span>Evaluating the fixed case set…</span></div>';
  try {
    const response = await fetch('/api/run', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({top_k:Number($('#top-k').value), threshold:Number($('#threshold').value)})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The benchmark could not be completed.');
    renderSummary(data);
    results.scrollIntoView({behavior:'smooth',block:'start'});
  } catch (error) {
    results.innerHTML = `<div class="error-state"><span>RUN INTERRUPTED</span><p>${safe(error.message)}</p><button id="retry-button">Try again ↗</button></div>`;
    $('#retry-button').addEventListener('click', () => runButton.click());
  } finally {
    runButton.disabled = false;
    runButton.innerHTML = '<span>Run benchmark</span><b>↗</b>';
  }
});

fetch('/api/bench').then((r) => r.json()).then((data) => {
  $('#case-nav-count').textContent = String(data.case_count).padStart(2,'0');
  $('#case-count-label').textContent = `${data.case_count} labelled scenarios · fictional knowledge base`;
  $('#case-strip').innerHTML = data.groups.map((group, i) => `<div class="case-chip"><span>${String(i+1).padStart(2,'0')}</span><b>${safe(group.name)}</b><i>${String(group.count).padStart(2,'0')} ${group.count === 1 ? 'CASE' : 'CASES'}</i></div>`).join('');
}).catch(() => { $('#case-count-label').textContent = 'Sample-case summary unavailable'; });

