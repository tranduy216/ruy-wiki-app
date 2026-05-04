#!/usr/bin/env node
// ================================================================
//  update-pivot-score.js
//  Fetches macro data from FRED, scores each criterion, and
//  updates the "pivot-score-data" GitHub Issue.
//
//  Required env vars:
//    FRED_API_KEY  – free key from https://fred.stlouisfed.org/
//    GITHUB_TOKEN  – auto-provided by GitHub Actions (issues:write)
//    GITHUB_OWNER  – repo owner  (e.g. tranduy216)
//    GITHUB_REPO   – repo name   (e.g. ruy-wiki-app)
// ================================================================
'use strict';

const FRED_BASE  = 'https://api.stlouisfed.org/fred/series/observations';
const GH_API     = 'https://api.github.com';
const DATA_LABEL = 'pivot-score-data';
const DATA_TITLE = '📊 Pivot Score Data';

// ──────────────────────────────────────────────────────────────
//  Logging helpers
// ──────────────────────────────────────────────────────────────
const SEP  = '='.repeat(56);
const DASH = '-'.repeat(56);

function banner(title) {
  console.log(`\n${SEP}`);
  console.log(`  ${title}`);
  console.log(SEP);
}

function step(emoji, msg) { console.log(`\n${emoji}  ${msg}`); }
function ok(msg)           { console.log(`  ✅  ${msg}`); }
function warn(msg)         { console.warn(`  ⚠️   ${msg}`); }
function fail(msg)         { console.error(`  ❌  ${msg}`); }
function info(msg)         { console.log(`  ℹ️   ${msg}`); }

// ──────────────────────────────────────────────────────────────
//  Environment validation
// ──────────────────────────────────────────────────────────────
banner('Environment check');

const FRED_KEY = process.env.FRED_API_KEY;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GITHUB_OWNER;
const GH_REPO  = process.env.GITHUB_REPO;

let envOk = true;
if (!FRED_KEY)  { fail('FRED_API_KEY  not set'); envOk = false; }
else            { ok(`FRED_API_KEY  set (length: ${FRED_KEY.length})`); }

if (!GH_TOKEN)  { fail('GITHUB_TOKEN  not set'); envOk = false; }
else            { ok('GITHUB_TOKEN  set'); }

if (!GH_OWNER)  { fail('GITHUB_OWNER  not set'); envOk = false; }
else            { ok(`GITHUB_OWNER  = ${GH_OWNER}`); }

if (!GH_REPO)   { fail('GITHUB_REPO   not set'); envOk = false; }
else            { ok(`GITHUB_REPO   = ${GH_REPO}`); }

if (!envOk) {
  fail('One or more required environment variables are missing. Aborting.');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────
//  Date helpers
// ──────────────────────────────────────────────────────────────
function getMondayISO() {
  const now  = new Date();
  const day  = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(now);
  mon.setUTCDate(now.getUTCDate() + diff);
  return mon.toISOString().split('T')[0];
}

// ──────────────────────────────────────────────────────────────
//  FRED fetcher (with per-series logging)
// ──────────────────────────────────────────────────────────────
async function fredFetch(seriesId, limit = 100) {
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${FRED_KEY}&sort_order=desc&limit=${limit}&file_type=json`;
  info(`FRED fetch  ${seriesId.padEnd(16)} limit=${limit}`);
  const t0  = Date.now();
  const res = await fetch(url);
  const ms  = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FRED ${seriesId} HTTP ${res.status} (${ms}ms) – ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  if (data.error_message) {
    throw new Error(`FRED ${seriesId}: ${data.error_message}`);
  }
  const obs = (data.observations || []).filter(o => o.value !== '.' && o.value !== 'NA');
  info(`             → ${obs.length} valid obs (${ms}ms); latest: ${obs[0]?.date} = ${obs[0]?.value}`);
  return obs;
}

// ──────────────────────────────────────────────────────────────
//  Scoring helpers
// ──────────────────────────────────────────────────────────────
function obsVal(obs, idx = 0) {
  return obs[idx] ? parseFloat(obs[idx].value) : null;
}

function idxMonthsAgo(obs, months) {
  if (!obs.length) return obs.length - 1;
  const target = new Date(obs[0].date);
  target.setMonth(target.getMonth() - months);
  const ts = target.toISOString().split('T')[0];
  for (let i = 0; i < obs.length; i++) {
    if (obs[i].date <= ts) return i;
  }
  return obs.length - 1;
}

function getAction(total) {
  if (total > 80)  return 'aggressive';
  if (total >= 60) return 'tăng risk';
  if (total >= 40) return 'build vị thế';
  return 'phòng thủ';
}

// ──────────────────────────────────────────────────────────────
//  Individual scorers
// ──────────────────────────────────────────────────────────────

// 1.1 US 2Y Yield (DGS2)
async function scoreUs2y() {
  const obs = await fredFetch('DGS2', 120);
  if (!obs.length) return { score: 0, max: 15, value: 'N/A', condition: 'Không có dữ liệu' };
  const cur  = obsVal(obs, 0);
  const i3m  = idxMonthsAgo(obs, 3);
  const ago  = obsVal(obs, i3m);
  const chg  = ago != null ? +(cur - ago).toFixed(3) : null;
  info(`  DGS2: cur=${cur?.toFixed(2)}  ago(3m)[${obs[i3m]?.date}]=${ago?.toFixed(2)}  Δ=${chg}`);
  let score, condition;
  if      (chg == null)  { score = 0;  condition = 'Không đủ dữ liệu'; }
  else if (chg <= -0.50) { score = 15; condition = 'Giảm mạnh, liên tục'; }
  else if (chg < -0.05)  { score = 8;  condition = 'Giảm nhẹ'; }
  else                   { score = 0;  condition = 'Sideway / tăng'; }
  const arrow = chg == null ? '' : chg < 0 ? '↓' : '↑';
  const value = chg != null
    ? `${cur.toFixed(2)}% (${arrow}${Math.abs(chg).toFixed(2)}% / 3 tháng)` : `${cur.toFixed(2)}%`;
  return { score, max: 15, value, condition };
}

// 1.2 Fed Funds Futures (DFF vs DGS2)
async function scoreFedFutures() {
  const [dff, dgs2] = await Promise.all([fredFetch('DFF', 10), fredFetch('DGS2', 10)]);
  if (!dff.length || !dgs2.length) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
  const ffr    = obsVal(dff, 0);
  const twoY   = obsVal(dgs2, 0);
  const spread = +(ffr - twoY).toFixed(3);
  info(`  DFF=${ffr?.toFixed(2)}  DGS2=${twoY?.toFixed(2)}  spread=${spread}`);
  let score, condition;
  if      (spread >= 0.50) { score = 10; condition = 'Market pricing giảm lãi rõ (≥ 2 cuts)'; }
  else if (spread > 0.15)  { score = 5;  condition = 'Pricing nhẹ'; }
  else                     { score = 0;  condition = 'Không pricing'; }
  const value = `FFR ${ffr.toFixed(2)}% vs 2Y ${twoY.toFixed(2)}% → spread ${spread >= 0 ? '+' : ''}${spread.toFixed(2)}%`;
  return { score, max: 10, value, condition };
}

// 2.1 Yield Curve (T10Y2Y)
async function scoreYieldCurve() {
  const [obs, dgs2] = await Promise.all([fredFetch('T10Y2Y', 90), fredFetch('DGS2', 90)]);
  if (!obs.length) return { score: 0, max: 15, value: 'N/A', condition: 'Không có dữ liệu' };
  const cur     = obsVal(obs, 0);
  const i3m     = idxMonthsAgo(obs, 3);
  const ago     = obsVal(obs, i3m);
  const steepen = ago != null && cur > ago;
  info(`  T10Y2Y: cur=${cur?.toFixed(2)}  ago(3m)=${ago?.toFixed(2)}  steepen=${steepen}`);
  let score, condition;
  if (steepen) {
    const us2yCur = dgs2.length ? obsVal(dgs2, 0) : null;
    const us2yAgo = dgs2.length ? obsVal(dgs2, idxMonthsAgo(dgs2, 3)) : null;
    info(`  DGS2 for steepen check: cur=${us2yCur?.toFixed(2)}  ago=${us2yAgo?.toFixed(2)}`);
    if (us2yCur != null && us2yAgo != null && us2yCur < us2yAgo) {
      score = 15; condition = 'Steepening do short-term yield ↓';
    } else {
      score = 5;  condition = 'Steepening do long-term ↑';
    }
  } else {
    score = 0; condition = cur < 0 ? 'Vẫn inverted sâu' : 'Sideway / tăng';
  }
  const arrow = ago == null ? '' : cur > ago ? '↑' : '↓';
  const value = ago != null
    ? `${cur.toFixed(2)}% (${arrow} từ ${ago.toFixed(2)}% / 3T)` : `${cur.toFixed(2)}%`;
  return { score, max: 15, value, condition };
}

// 3.1 Unemployment (UNRATE)
async function scoreUnemployment() {
  const obs  = await fredFetch('UNRATE', 12);
  if (!obs.length) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
  const cur   = obsVal(obs, 0);
  const idx6m = Math.min(obs.length - 1, 6);
  const ago   = obsVal(obs, idx6m);
  const chg   = ago != null ? +(cur - ago).toFixed(2) : null;
  info(`  UNRATE: cur=${cur?.toFixed(1)}  ago(6m)[${obs[idx6m]?.date}]=${ago?.toFixed(1)}  Δ=${chg}`);
  let score, condition;
  if      (chg == null)  { score = 0;  condition = 'Không đủ dữ liệu'; }
  else if (chg >= 0.40)  { score = 10; condition = 'Tăng nhanh ≥ 0.4–0.5% trong 3–6 tháng'; }
  else if (chg >= 0.10)  { score = 5;  condition = 'Tăng nhẹ'; }
  else                   { score = 0;  condition = 'Ổn định'; }
  const agoMonth = obs[idx6m] ? obs[idx6m].date.slice(0, 7) : '';
  const value = chg != null
    ? `${cur.toFixed(1)}% (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% từ ${agoMonth})` : `${cur.toFixed(1)}%`;
  return { score, max: 10, value, condition };
}

// 3.2 Jobless Claims (ICSA)
async function scoreJoblessClaims() {
  const obs = await fredFetch('ICSA', 20);
  if (obs.length < 5) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
  const ma4 = (start) => {
    let sum = 0, cnt = 0;
    for (let i = start; i < Math.min(start + 4, obs.length); i++) { sum += obsVal(obs, i); cnt++; }
    return cnt ? sum / cnt : null;
  };
  const curMA  = ma4(0);
  const oldIdx = Math.min(obs.length - 1, 12);
  const oldMA  = ma4(oldIdx);
  const pct    = (curMA != null && oldMA != null && oldMA > 0)
    ? ((curMA - oldMA) / oldMA) * 100 : null;
  info(`  ICSA: MA4(cur)=${curMA?.toFixed(0)}  MA4(12w ago)=${oldMA?.toFixed(0)}  Δ%=${pct?.toFixed(1)}`);
  let score, condition;
  if      (pct == null) { score = 0;  condition = 'Không đủ dữ liệu'; }
  else if (pct >= 15)   { score = 10; condition = 'Tăng mạnh, liên tục'; }
  else if (pct >= 5)    { score = 5;  condition = 'Tăng nhẹ'; }
  else                  { score = 0;  condition = 'Flat'; }
  const curK  = curMA ? Math.round(curMA / 1000) : '?';
  const value = pct != null
    ? `${curK}K (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% / 12 tuần)` : `${curK}K`;
  return { score, max: 10, value, condition };
}

// 4.1 Core CPI (CPILFESL)
async function scoreCoreCpi() {
  const obs = await fredFetch('CPILFESL', 18);
  if (obs.length < 13) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
  const curVal  = obsVal(obs, 0);
  const yoy12   = obsVal(obs, 12);
  const curYoY  = yoy12 ? +(((curVal / yoy12) - 1) * 100).toFixed(2) : null;
  const idx3m   = Math.min(obs.length - 1, 3);
  const val3m   = obsVal(obs, idx3m);
  const yoy3m12 = obs[idx3m + 12] ? obsVal(obs, idx3m + 12) : null;
  const yoY3m   = (val3m && yoy3m12) ? +(((val3m / yoy3m12) - 1) * 100).toFixed(2) : null;
  const yoyChg  = (curYoY != null && yoY3m != null) ? +(curYoY - yoY3m).toFixed(2) : null;
  info(`  CPILFESL: curYoY=${curYoY}%  yoY3mAgo=${yoY3m}%  Δpp=${yoyChg}`);
  let score, condition;
  if      (yoyChg == null)  { score = 0;  condition = 'Không đủ dữ liệu'; }
  else if (yoyChg <= -0.30) { score = 10; condition = 'Giảm rõ ràng, liên tục'; }
  else if (yoyChg < 0)      { score = 5;  condition = 'Giảm nhẹ'; }
  else                      { score = 0;  condition = 'Flat / tăng'; }
  const value = curYoY != null
    ? `${curYoY.toFixed(2)}% YoY (${yoyChg != null ? (yoyChg >= 0 ? '+' : '') + yoyChg.toFixed(2) + 'pp / 3T' : ''})`
    : 'N/A';
  return { score, max: 10, value, condition };
}

// 4.2 PCE (PCEPILFE)
async function scorePce() {
  const obs = await fredFetch('PCEPILFE', 18);
  if (obs.length < 13) return { score: 0, max: 5, value: 'N/A', condition: 'Không có dữ liệu' };
  const curVal  = obsVal(obs, 0);
  const yoy12   = obsVal(obs, 12);
  const curYoY  = yoy12 ? +(((curVal / yoy12) - 1) * 100).toFixed(2) : null;
  const idx3m   = Math.min(obs.length - 1, 3);
  const val3m   = obsVal(obs, idx3m);
  const yoy3m12 = obs[idx3m + 12] ? obsVal(obs, idx3m + 12) : null;
  const yoY3m   = (val3m && yoy3m12) ? +(((val3m / yoy3m12) - 1) * 100).toFixed(2) : null;
  const yoyChg  = (curYoY != null && yoY3m != null) ? +(curYoY - yoY3m).toFixed(2) : null;
  info(`  PCEPILFE: curYoY=${curYoY}%  yoY3mAgo=${yoY3m}%  Δpp=${yoyChg}`);
  let score, condition;
  if      (yoyChg == null) { score = 0; condition = 'Không đủ dữ liệu'; }
  else if (yoyChg < 0)     { score = 5; condition = 'Giảm'; }
  else                     { score = 0; condition = 'Không giảm'; }
  const value = curYoY != null ? `${curYoY.toFixed(2)}% YoY` : 'N/A';
  return { score, max: 5, value, condition };
}

// 5. Fed Communication – manual, carry over or default neutral
function scoreFedCommunication(prevScore = 5) {
  const score     = [0, 5, 10].includes(prevScore) ? prevScore : 5;
  const map       = { 10: '"Ready to adjust policy"', 5: '"Risks balanced"', 0: 'Vẫn hawkish' };
  const condition = map[score];
  info(`  Fed Comm: carried=${score}  condition=${condition}`);
  return { score, max: 10, value: 'Manual – xem phát biểu Powell gần nhất', condition };
}

// 6. Credit Spread (BAMLH0A0HYM2)
async function scoreCreditSpread() {
  const obs = await fredFetch('BAMLH0A0HYM2', 90);
  if (!obs.length) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
  const cur  = obsVal(obs, 0);
  const i3m  = idxMonthsAgo(obs, 3);
  const ago  = obsVal(obs, i3m);
  const chg  = ago != null ? +(cur - ago).toFixed(3) : null;
  info(`  BAMLH0A0HYM2: cur=${cur?.toFixed(2)}  ago(3m)=${ago?.toFixed(2)}  Δ=${chg}`);
  let score, condition;
  if      (chg == null) { score = 0;  condition = 'Không đủ dữ liệu'; }
  else if (chg >= 2.0)  { score = 10; condition = 'Mở rộng mạnh'; }
  else if (chg >= 0.30) { score = 5;  condition = 'Mở rộng nhẹ'; }
  else                  { score = 0;  condition = 'Bình thường'; }
  const value = chg != null
    ? `${cur.toFixed(2)}% (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% / 3T)` : `${cur.toFixed(2)}%`;
  return { score, max: 10, value, condition };
}

// 7. Market Behavior – manual, carry over or default 0
function scoreMarketBehavior(prevScore = 0) {
  const score     = [0, 5].includes(prevScore) ? prevScore : 0;
  const condition = score === 5 ? 'Có' : 'Không';
  info(`  Market Behavior: carried=${score}  condition=${condition}`);
  return { score, max: 5, value: 'Manual – theo dõi reaction thị trường', condition };
}

// ──────────────────────────────────────────────────────────────
//  GitHub API helpers (with response logging)
// ──────────────────────────────────────────────────────────────
async function ghFetch(path, opts = {}) {
  const headers = {
    'Accept':               'application/vnd.github+json',
    'Authorization':        `Bearer ${GH_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(opts.headers || {})
  };
  const res = await fetch(GH_API + path, { ...opts, headers });
  info(`  GitHub ${opts.method || 'GET'} ${path} → HTTP ${res.status}`);
  return res;
}

async function ensureLabel() {
  step('🏷️', `Checking label "${DATA_LABEL}"…`);
  const res = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/labels/${DATA_LABEL}`);
  if (res.status === 404) {
    info('Label not found – creating it.');
    const cr = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DATA_LABEL, color: '0052cc', description: 'Pivot score weekly data' })
    });
    if (cr.ok) { ok(`Label "${DATA_LABEL}" created.`); }
    else { const b = await cr.text(); warn(`Label create failed: ${cr.status} – ${b.slice(0,120)}`); }
  } else if (res.ok) {
    ok(`Label "${DATA_LABEL}" already exists.`);
  } else {
    warn(`Label check returned HTTP ${res.status}.`);
  }
}

async function findDataIssue() {
  step('��', 'Looking for existing data issue…');
  const res  = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues?labels=${DATA_LABEL}&state=open&per_page=1`);
  if (!res.ok) throw new Error(`GitHub issue list failed: HTTP ${res.status}`);
  const list = await res.json();
  if (list.length) {
    ok(`Found issue #${list[0].number}: "${list[0].title}"`);
    info(`  Updated at: ${list[0].updated_at}`);
    info(`  Body length: ${(list[0].body || '').length} chars`);
  } else {
    info('No existing data issue found – will create one.');
  }
  return list.length ? list[0] : null;
}

async function createDataIssue(body) {
  step('➕', 'Creating new data issue…');
  const res    = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ title: DATA_TITLE, body, labels: [DATA_LABEL] })
  });
  if (!res.ok) {
    const b = await res.text();
    throw new Error(`Create issue failed HTTP ${res.status}: ${b.slice(0, 200)}`);
  }
  const issue = await res.json();
  ok(`Issue #${issue.number} created: ${issue.html_url}`);
  return issue;
}

async function updateDataIssue(number, body) {
  step('✏️', `Updating issue #${number}…`);
  const res  = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues/${number}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ body })
  });
  if (!res.ok) {
    const b = await res.text();
    throw new Error(`Update issue failed HTTP ${res.status}: ${b.slice(0, 200)}`);
  }
  const issue = await res.json();
  ok(`Issue #${issue.number} updated: ${issue.html_url}`);
  return issue;
}

function parseEntries(issueBody) {
  const match = (issueBody || '').match(/<!--\s*PIVOT_DATA_START\s*([\s\S]*?)\s*PIVOT_DATA_END\s*-->/);
  if (!match) return [];
  try { return JSON.parse(match[1]); } catch (e) { warn(`JSON parse error: ${e.message}`); return []; }
}

function buildIssueBody(entries) {
  const json = JSON.stringify(entries, null, 2);
  return `# 📊 Pivot Score Data\n\nDữ liệu tự động cập nhật mỗi thứ Hai bởi GitHub Actions.\nChỉnh sửa JSON bên dưới để điều chỉnh điểm thủ công (Fed Communication, Market Behavior).\n\n<!-- PIVOT_DATA_START\n${json}\nPIVOT_DATA_END -->\n`;
}

// ──────────────────────────────────────────────────────────────
//  Main
// ──────────────────────────────────────────────────────────────
async function main() {
  const startMs = Date.now();
  const week    = getMondayISO();

  banner(`Pivot Score Update – week ${week}`);
  info(`Run timestamp: ${new Date().toISOString()}`);
  info(`Target repo:   ${GH_OWNER}/${GH_REPO}`);

  // ── Step 1: Load existing data ──────────────────────────────
  banner('Step 1 – Load existing GitHub Issue data');
  await ensureLabel();
  const existingIssue = await findDataIssue();
  const prevEntries   = existingIssue ? parseEntries(existingIssue.body || '') : [];
  info(`Previous entries in issue: ${prevEntries.length}`);
  if (prevEntries.length) {
    info(`Most recent week: ${prevEntries[0].week}  total: ${prevEntries[0].total}/100`);
  }
  const prevEntry   = prevEntries[0] || null;
  const prevFedComm = prevEntry?.scores?.fed_communication?.score ?? 5;
  const prevMktBeh  = prevEntry?.scores?.market_behavior?.score   ?? 0;
  info(`Carrying over – Fed Comm score: ${prevFedComm}  Market Behavior score: ${prevMktBeh}`);

  // ── Step 2: Fetch FRED data ──────────────────────────────────
  banner('Step 2 – Fetch FRED data (parallel)');
  const SCORER_NAMES = ['us2y', 'fed_futures', 'yield_curve', 'unemployment',
                        'jobless_claims', 'core_cpi', 'pce', 'credit_spread'];
  const SCORER_MAXES = [15, 10, 15, 10, 10, 10, 5, 10];

  step('📡', 'Sending all FRED requests concurrently…');
  const t0      = Date.now();
  const settled = await Promise.allSettled([
    scoreUs2y(),
    scoreFedFutures(),
    scoreYieldCurve(),
    scoreUnemployment(),
    scoreJoblessClaims(),
    scoreCoreCpi(),
    scorePce(),
    scoreCreditSpread()
  ]);
  info(`FRED parallel fetch completed in ${Date.now() - t0}ms`);

  const fredScores = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      fredScores[SCORER_NAMES[i]] = r.value;
    } else {
      warn(`${SCORER_NAMES[i]} scorer failed: ${r.reason?.message}`);
      fredScores[SCORER_NAMES[i]] = { score: 0, max: SCORER_MAXES[i], value: 'Lỗi lấy dữ liệu', condition: 'N/A' };
    }
  });

  // ── Step 3: Manual / carry-over scores ──────────────────────
  banner('Step 3 – Manual scores (carried over)');
  const scores = {
    ...fredScores,
    fed_communication: scoreFedCommunication(prevFedComm),
    market_behavior:   scoreMarketBehavior(prevMktBeh)
  };

  // ── Step 4: Tally ────────────────────────────────────────────
  banner('Step 4 – Score summary');
  const COL = 22;
  console.log(`  ${'Criterion'.padEnd(COL)} ${'Score'.padStart(5)}   Condition`);
  console.log(`  ${DASH.slice(0, COL)} ${'-----'} ${'----------'}`);
  for (const [k, v] of Object.entries(scores)) {
    console.log(`  ${k.padEnd(COL)} ${String(v.score).padStart(3)}/${v.max}  ${v.condition}`);
  }
  const total = Object.values(scores).reduce((s, v) => s + (v.score || 0), 0);
  console.log(`\n  ${'TOTAL'.padEnd(COL)} ${String(total).padStart(3)}/100`);
  console.log(`  ${'ACTION'.padEnd(COL)} ${getAction(total).toUpperCase()}`);

  // ── Step 5: Build & save issue ──────────────────────────────
  banner('Step 5 – Save to GitHub Issue');
  const newEntry = {
    week,
    scores,
    total,
    action:     getAction(total),
    updated_at: new Date().toISOString()
  };

  const entries = [...prevEntries];
  if (entries.length && entries[0].week === week) {
    info(`Entry for ${week} already exists – replacing it.`);
    entries[0] = newEntry;
  } else {
    info(`Prepending new entry for ${week}.`);
    entries.unshift(newEntry);
  }
  info(`Total entries after update: ${entries.length}`);

  const issueBody = buildIssueBody(entries);
  info(`New issue body length: ${issueBody.length} chars`);

  if (existingIssue) {
    await updateDataIssue(existingIssue.number, issueBody);
  } else {
    await createDataIssue(issueBody);
  }

  // ── Done ─────────────────────────────────────────────────────
  banner(`✅ Done in ${Date.now() - startMs}ms`);
  console.log(`  Week:   ${week}`);
  console.log(`  Score:  ${total}/100  →  ${getAction(total)}`);
  console.log(SEP);
}

main().catch(err => {
  fail(`Unhandled error: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
