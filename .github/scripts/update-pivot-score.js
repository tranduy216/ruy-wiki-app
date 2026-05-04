#!/usr/bin/env node
// ================================================================
//  update-pivot-score.js
//  Fetches macro data from FRED, scores each criterion, and
//  updates the "pivot-score-data" GitHub Issue with the new entry.
//
//  Required env vars:
//    FRED_API_KEY  – FRED API key (free at https://fred.stlouisfed.org/)
//    GITHUB_TOKEN  – GitHub token with issues:write (auto-provided in Actions)
//    GITHUB_OWNER  – Repo owner (e.g. tranduy216)
//    GITHUB_REPO   – Repo name  (e.g. ruy-wiki-app)
// ================================================================
'use strict';

const FRED_BASE   = 'https://api.stlouisfed.org/fred/series/observations';
const GH_API      = 'https://api.github.com';
const DATA_LABEL  = 'pivot-score-data';
const DATA_TITLE  = '📊 Pivot Score Data';

const FRED_KEY    = process.env.FRED_API_KEY;
const GH_TOKEN    = process.env.GITHUB_TOKEN;
const GH_OWNER    = process.env.GITHUB_OWNER;
const GH_REPO     = process.env.GITHUB_REPO;

if (!FRED_KEY)   { console.error('Missing FRED_API_KEY'); process.exit(1); }
if (!GH_TOKEN)   { console.error('Missing GITHUB_TOKEN'); process.exit(1); }
if (!GH_OWNER)   { console.error('Missing GITHUB_OWNER'); process.exit(1); }
if (!GH_REPO)    { console.error('Missing GITHUB_REPO');  process.exit(1); }

// ──────────────────────────────────────────────────────────────
//  Date helpers
// ──────────────────────────────────────────────────────────────
function getMondayISO() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diff);
  return monday.toISOString().split('T')[0];
}

// ──────────────────────────────────────────────────────────────
//  FRED fetcher
// ──────────────────────────────────────────────────────────────
async function fredFetch(seriesId, limit = 100) {
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${FRED_KEY}&sort_order=desc&limit=${limit}&file_type=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  const data = await res.json();
  // Filter out missing values ('.')
  return (data.observations || []).filter(o => o.value !== '.' && o.value !== 'NA');
}

// ──────────────────────────────────────────────────────────────
//  Scoring helpers
// ──────────────────────────────────────────────────────────────
function val(obs, idx = 0) {
  return obs[idx] ? parseFloat(obs[idx].value) : null;
}

// Get observation index closest to N business days ago (rough: 1 month ≈ 22 days)
function getIdxMonthsAgo(obs, months) {
  const target = new Date(obs[0].date);
  target.setMonth(target.getMonth() - months);
  const targetStr = target.toISOString().split('T')[0];
  let best = obs.length - 1;
  for (let i = 0; i < obs.length; i++) {
    if (obs[i].date <= targetStr) { best = i; break; }
  }
  return best;
}

// ──────────────────────────────────────────────────────────────
//  Action matrix
// ──────────────────────────────────────────────────────────────
function getAction(total) {
  if (total > 80)  return 'aggressive';
  if (total >= 60) return 'tăng risk';
  if (total >= 40) return 'build vị thế';
  return 'phòng thủ';
}

// ──────────────────────────────────────────────────────────────
//  Individual scorers
// ──────────────────────────────────────────────────────────────

// 1.1 US 2Y Yield trend (15 pts)  – DGS2 daily
async function scoreUs2y() {
  const obs = await fredFetch('DGS2', 120);
  if (!obs.length) return { score: 0, max: 15, value: 'N/A', condition: 'Không có dữ liệu' };
  const current = val(obs, 0);
  const idx3m   = getIdxMonthsAgo(obs, 3);
  const ago     = val(obs, idx3m);
  const change  = ago != null ? +(current - ago).toFixed(3) : null;
  let score, condition;
  if (change == null)              { score = 0; condition = 'Không đủ dữ liệu'; }
  else if (change <= -0.50)        { score = 15; condition = 'Giảm mạnh, liên tục'; }
  else if (change < -0.05)         { score = 8;  condition = 'Giảm nhẹ'; }
  else                             { score = 0;  condition = 'Sideway / tăng'; }
  const arrow = change == null ? '' : change < 0 ? '↓' : '↑';
  const value = change != null
    ? `${current.toFixed(2)}% (${arrow}${Math.abs(change).toFixed(2)}% / 3 tháng)`
    : `${current.toFixed(2)}%`;
  return { score, max: 15, value, condition };
}

// 1.2 Fed Funds Futures (10 pts) – approximated via DFF vs DGS2
async function scoreFedFutures() {
  const [dff, dgs2] = await Promise.all([fredFetch('DFF', 10), fredFetch('DGS2', 10)]);
  if (!dff.length || !dgs2.length) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
  const ffr    = val(dff, 0);
  const twoY   = val(dgs2, 0);
  const spread = +(ffr - twoY).toFixed(3);
  let score, condition;
  if (spread >= 0.50)  { score = 10; condition = 'Market pricing giảm lãi rõ (≥ 2 cuts)'; }
  else if (spread > 0.15) { score = 5;  condition = 'Pricing nhẹ'; }
  else                 { score = 0;  condition = 'Không pricing'; }
  const value = `FFR ${ffr.toFixed(2)}% vs 2Y ${twoY.toFixed(2)}% → spread ${spread > 0 ? '+' : ''}${spread.toFixed(2)}%`;
  return { score, max: 10, value, condition };
}

// 2.1 Yield Curve 10Y-2Y (15 pts) – T10Y2Y daily + DGS2 trend
async function scoreYieldCurve() {
  const [obs, dgs2] = await Promise.all([fredFetch('T10Y2Y', 90), fredFetch('DGS2', 90)]);
  if (!obs.length) return { score: 0, max: 15, value: 'N/A', condition: 'Không có dữ liệu' };
  const current  = val(obs, 0);
  const idx3m    = getIdxMonthsAgo(obs, 3);
  const ago      = val(obs, idx3m);
  const steepen  = ago != null && current > ago;

  let score, condition;
  if (steepen) {
    // Check if driven by short-term yield falling
    const us2yCur = dgs2.length ? val(dgs2, 0) : null;
    const us2yIdx = dgs2.length ? getIdxMonthsAgo(dgs2, 3) : -1;
    const us2yAgo = us2yIdx >= 0 ? val(dgs2, us2yIdx) : null;
    if (us2yCur != null && us2yAgo != null && us2yCur < us2yAgo) {
      score = 15; condition = 'Steepening do short-term yield ↓';
    } else {
      score = 5;  condition = 'Steepening do long-term ↑';
    }
  } else {
    score = 0; condition = current < 0 ? 'Vẫn inverted sâu' : 'Sideway / tăng';
  }
  const arrow = ago == null ? '' : current > ago ? '↑' : '↓';
  const value = ago != null
    ? `${current.toFixed(2)}% (${arrow} từ ${ago.toFixed(2)}% / 3T)`
    : `${current.toFixed(2)}%`;
  return { score, max: 15, value, condition };
}

// 3.1 Unemployment rate (10 pts) – UNRATE monthly
async function scoreUnemployment() {
  const obs = await fredFetch('UNRATE', 12);
  if (!obs.length) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
  const current = val(obs, 0);
  // Compare vs 6 months ago
  const idx6m   = Math.min(obs.length - 1, 6);
  const ago     = val(obs, idx6m);
  const change  = ago != null ? +(current - ago).toFixed(2) : null;
  let score, condition;
  if (change == null)         { score = 0; condition = 'Không đủ dữ liệu'; }
  else if (change >= 0.40)    { score = 10; condition = 'Tăng nhanh ≥ 0.4–0.5% trong 3–6 tháng'; }
  else if (change >= 0.10)    { score = 5;  condition = 'Tăng nhẹ'; }
  else                        { score = 0;  condition = 'Ổn định'; }
  const agoMonth = obs[idx6m] ? obs[idx6m].date.slice(0, 7) : '';
  const value = change != null
    ? `${current.toFixed(1)}% (${change >= 0 ? '+' : ''}${change.toFixed(2)}% từ ${agoMonth})`
    : `${current.toFixed(1)}%`;
  return { score, max: 10, value, condition };
}

// 3.2 Jobless claims (10 pts) – ICSA weekly
async function scoreJoblessClaims() {
  const obs = await fredFetch('ICSA', 20);
  if (obs.length < 5) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
  // 4-week moving average: current vs ~12 weeks ago
  const ma4 = (o, start) => {
    let sum = 0, cnt = 0;
    for (let i = start; i < Math.min(start + 4, o.length); i++) { sum += val(o, i); cnt++; }
    return cnt ? sum / cnt : null;
  };
  const curMA  = ma4(obs, 0);
  const oldIdx = Math.min(obs.length - 1, 12);
  const oldMA  = ma4(obs, oldIdx);
  const pctChg = (curMA != null && oldMA != null && oldMA > 0)
    ? ((curMA - oldMA) / oldMA) * 100 : null;
  let score, condition;
  if (pctChg == null)       { score = 0; condition = 'Không đủ dữ liệu'; }
  else if (pctChg >= 15)    { score = 10; condition = 'Tăng mạnh, liên tục'; }
  else if (pctChg >= 5)     { score = 5;  condition = 'Tăng nhẹ'; }
  else                      { score = 0;  condition = 'Flat'; }
  const curK = curMA ? Math.round(curMA / 1000) : '?';
  const value = pctChg != null
    ? `${curK}K (${pctChg >= 0 ? '+' : ''}${pctChg.toFixed(1)}% / 12 tuần)`
    : `${curK}K`;
  return { score, max: 10, value, condition };
}

// 4.1 Core CPI trend (10 pts) – CPILFESL monthly
async function scoreCoreCpi() {
  const obs = await fredFetch('CPILFESL', 18);
  if (obs.length < 13) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
  const yoy     = v => v != null ? ((v / val(obs, obs.indexOf(v) + 12) - 1) * 100) : null;
  const curVal  = val(obs, 0);
  const yoy12   = obs.length >= 13 ? val(obs, 12) : null;
  const curYoY  = yoy12 ? +(((curVal / yoy12) - 1) * 100).toFixed(2) : null;

  // YoY 3 months ago
  const idx3m   = Math.min(obs.length - 1, 3);
  const val3m   = val(obs, idx3m);
  const yoy3m12 = obs[idx3m + 12] ? val(obs, idx3m + 12) : null;
  const yoY3m   = (val3m && yoy3m12) ? +(((val3m / yoy3m12) - 1) * 100).toFixed(2) : null;

  const yoyChg  = (curYoY != null && yoY3m != null) ? +(curYoY - yoY3m).toFixed(2) : null;
  let score, condition;
  if (yoyChg == null)         { score = 0; condition = 'Không đủ dữ liệu'; }
  else if (yoyChg <= -0.30)   { score = 10; condition = 'Giảm rõ ràng, liên tục'; }
  else if (yoyChg < 0)        { score = 5;  condition = 'Giảm nhẹ'; }
  else                        { score = 0;  condition = 'Flat / tăng'; }
  const value = curYoY != null
    ? `${curYoY.toFixed(2)}% YoY (${yoyChg != null ? (yoyChg > 0 ? '+' : '') + yoyChg.toFixed(2) + 'pp / 3T' : ''})`
    : 'N/A';
  return { score, max: 10, value, condition };
}

// 4.2 PCE (5 pts) – PCEPILFE monthly
async function scorePce() {
  const obs = await fredFetch('PCEPILFE', 18);
  if (obs.length < 13) return { score: 0, max: 5, value: 'N/A', condition: 'Không có dữ liệu' };
  const curVal  = val(obs, 0);
  const yoy12   = val(obs, 12);
  const curYoY  = yoy12 ? +(((curVal / yoy12) - 1) * 100).toFixed(2) : null;

  const idx3m   = Math.min(obs.length - 1, 3);
  const val3m   = val(obs, idx3m);
  const yoy3m12 = obs[idx3m + 12] ? val(obs, idx3m + 12) : null;
  const yoY3m   = (val3m && yoy3m12) ? +(((val3m / yoy3m12) - 1) * 100).toFixed(2) : null;

  const yoyChg  = (curYoY != null && yoY3m != null) ? +(curYoY - yoY3m).toFixed(2) : null;
  let score, condition;
  if (yoyChg == null)  { score = 0; condition = 'Không đủ dữ liệu'; }
  else if (yoyChg < 0) { score = 5; condition = 'Giảm'; }
  else                 { score = 0; condition = 'Không giảm'; }
  const value = curYoY != null ? `${curYoY.toFixed(2)}% YoY` : 'N/A';
  return { score, max: 5, value, condition };
}

// 5. Fed Communication (10 pts) – manual, default 5 (neutral)
// Cannot be automated. Uses previous entry's value or neutral default.
function scoreFedCommunication(prevScore = 5) {
  const scoreMap = {
    10: '"Ready to adjust policy"',
    5:  '"Risks balanced"',
    0:  'Vẫn hawkish'
  };
  const score     = [0, 5, 10].includes(prevScore) ? prevScore : 5;
  const condition = scoreMap[score] || '"Risks balanced"';
  return { score, max: 10, value: 'Manual – xem phát biểu Powell gần nhất', condition };
}

// 6. Credit spread (10 pts) – BAMLH0A0HYM2 (ICE BofA US HY OAS)
async function scoreCreditSpread() {
  const obs = await fredFetch('BAMLH0A0HYM2', 90);
  if (!obs.length) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
  const current = val(obs, 0);
  const idx3m   = getIdxMonthsAgo(obs, 3);
  const ago     = val(obs, idx3m);
  const change  = ago != null ? +(current - ago).toFixed(3) : null;
  let score, condition;
  if (change == null)        { score = 0; condition = 'Không đủ dữ liệu'; }
  else if (change >= 2.0)    { score = 10; condition = 'Mở rộng mạnh'; }
  else if (change >= 0.30)   { score = 5;  condition = 'Mở rộng nhẹ'; }
  else                       { score = 0;  condition = 'Bình thường'; }
  const value = change != null
    ? `${current.toFixed(2)}% (${change >= 0 ? '+' : ''}${change.toFixed(2)}% / 3T)`
    : `${current.toFixed(2)}%`;
  return { score, max: 10, value, condition };
}

// 7. Market behavior (5 pts) – manual, default 0
// Cannot be automated. Carried over from previous entry or default 0.
function scoreMarketBehavior(prevScore = 0) {
  const score     = [0, 5].includes(prevScore) ? prevScore : 0;
  const condition = score === 5 ? 'Có' : 'Không';
  return { score, max: 5, value: 'Manual – theo dõi reaction thị trường', condition };
}

// ──────────────────────────────────────────────────────────────
//  GitHub Issue helpers
// ──────────────────────────────────────────────────────────────
async function ghFetch(path, opts = {}) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${GH_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(opts.headers || {})
  };
  return fetch(GH_API + path, { ...opts, headers });
}

async function ensureLabel() {
  const res = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/labels/${DATA_LABEL}`);
  if (res.status === 404) {
    await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DATA_LABEL, color: '0052cc', description: 'Pivot score weekly data' })
    });
  }
}

async function findDataIssue() {
  const res  = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues?labels=${DATA_LABEL}&state=open&per_page=1`);
  const list = await res.json();
  return list.length ? list[0] : null;
}

async function createDataIssue(body) {
  const res  = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: DATA_TITLE, body, labels: [DATA_LABEL] })
  });
  return res.json();
}

async function updateDataIssue(number, body) {
  const res = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body })
  });
  return res.json();
}

function parseEntries(issueBody) {
  const match = (issueBody || '').match(/<!--\s*PIVOT_DATA_START\s*([\s\S]*?)\s*PIVOT_DATA_END\s*-->/);
  if (!match) return [];
  try { return JSON.parse(match[1]); } catch { return []; }
}

function buildIssueBody(entries) {
  const json = JSON.stringify(entries, null, 2);
  return `# 📊 Pivot Score Data\n\nDữ liệu tự động cập nhật mỗi thứ Hai bởi GitHub Actions. Chỉnh sửa trực tiếp JSON bên dưới để điều chỉnh điểm thủ công (Fed Communication, Market Behavior).\n\n<!-- PIVOT_DATA_START\n${json}\nPIVOT_DATA_END -->\n`;
}

// ──────────────────────────────────────────────────────────────
//  Main
// ──────────────────────────────────────────────────────────────
async function main() {
  const week = getMondayISO();
  console.log(`\n📊 Updating Pivot Score for week: ${week}\n`);

  // Fetch and score in parallel (independent calls)
  console.log('Fetching FRED data…');
  const [us2y, fedFutures, yieldCurve, unemployment, joblessClaims, coreCpi, pce, creditSpread] =
    await Promise.allSettled([
      scoreUs2y(),
      scoreFedFutures(),
      scoreYieldCurve(),
      scoreUnemployment(),
      scoreJoblessClaims(),
      scoreCoreCpi(),
      scorePce(),
      scoreCreditSpread()
    ]).then(results => results.map((r, i) => {
      if (r.status === 'rejected') {
        const keys = ['us2y','fed_futures','yield_curve','unemployment','jobless_claims','core_cpi','pce','credit_spread'];
        const maxes = [15, 10, 15, 10, 10, 10, 5, 10];
        console.warn(`  ⚠️  ${keys[i]} failed: ${r.reason?.message}`);
        return { score: 0, max: maxes[i], value: 'Lỗi lấy dữ liệu', condition: 'N/A' };
      }
      return r.value;
    }));

  // Find previous entry for carrying over manual scores
  await ensureLabel();
  const existingIssue = await findDataIssue();
  const prevEntries   = existingIssue ? parseEntries(existingIssue.body) : [];
  const prevEntry     = prevEntries[0] || null;
  const prevFedComm   = prevEntry?.scores?.fed_communication?.score ?? 5;
  const prevMktBeh    = prevEntry?.scores?.market_behavior?.score   ?? 0;

  const fedComm   = scoreFedCommunication(prevFedComm);
  const mktBehav  = scoreMarketBehavior(prevMktBeh);

  const scores = {
    us2y,
    fed_futures:       fedFutures,
    yield_curve:       yieldCurve,
    unemployment,
    jobless_claims:    joblessClaims,
    core_cpi:          coreCpi,
    pce,
    fed_communication: fedComm,
    credit_spread:     creditSpread,
    market_behavior:   mktBehav
  };

  const total = Object.values(scores).reduce((s, v) => s + (v.score || 0), 0);

  // Log results
  console.log('\nScores:');
  for (const [k, v] of Object.entries(scores)) {
    console.log(`  ${k.padEnd(20)} ${String(v.score).padStart(3)}/${v.max}  ${v.condition}`);
  }
  console.log(`  ${'TOTAL'.padEnd(20)} ${String(total).padStart(3)}/100  → ${getAction(total)}`);

  const newEntry = {
    week,
    scores,
    total,
    action: getAction(total),
    updated_at: new Date().toISOString()
  };

  // Skip duplicate if same week already exists
  if (prevEntries.length && prevEntries[0].week === week) {
    console.log(`\n⚠️  Entry for ${week} already exists – updating it.`);
    prevEntries[0] = newEntry;
  } else {
    prevEntries.unshift(newEntry);
  }

  const issueBody = buildIssueBody(prevEntries);

  if (existingIssue) {
    console.log(`\nUpdating issue #${existingIssue.number}…`);
    await updateDataIssue(existingIssue.number, issueBody);
  } else {
    console.log('\nCreating new data issue…');
    await createDataIssue(issueBody);
  }

  console.log('\n✅ Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
