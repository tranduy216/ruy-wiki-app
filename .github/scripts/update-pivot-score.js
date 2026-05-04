#!/usr/bin/env node
// ================================================================
//  update-pivot-score.js
//  Fetches macro data from FRED, calls OpenAI + Gemini for scoring,
//  and updates the "pivot-score-data" GitHub Issue.
//
//  Required env vars:
//    FRED_API_KEY   – free key from https://fred.stlouisfed.org/
//    GITHUB_TOKEN   – auto-provided by GitHub Actions (issues:write)
//    GITHUB_OWNER   – repo owner  (e.g. tranduy216)
//    GITHUB_REPO    – repo name   (e.g. ruy-wiki-app)
//    OPEN_AI_KEY    – OpenAI API key (optional if GEMINI_AI_KEY set)
//    GEMINI_AI_KEY  – Gemini API key (optional if OPEN_AI_KEY set)
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
//  Sleep helper
// ──────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ──────────────────────────────────────────────────────────────
//  Environment validation
// ──────────────────────────────────────────────────────────────
banner('Environment check');

const FRED_KEY   = process.env.FRED_API_KEY;
const GH_TOKEN   = process.env.GITHUB_TOKEN;
const GH_OWNER   = process.env.GITHUB_OWNER;
const GH_REPO    = process.env.GITHUB_REPO;
const OPENAI_KEY = process.env.OPEN_AI_KEY;
const GEMINI_KEY = process.env.GEMINI_AI_KEY;

let envOk = true;
if (!FRED_KEY)  { fail('FRED_API_KEY  not set'); envOk = false; }
else            { ok('FRED_API_KEY  set'); }

if (!GH_TOKEN)  { fail('GITHUB_TOKEN  not set'); envOk = false; }
else            { ok('GITHUB_TOKEN  set'); }

if (!GH_OWNER)  { fail('GITHUB_OWNER  not set'); envOk = false; }
else            { ok(`GITHUB_OWNER  = ${GH_OWNER}`); }

if (!GH_REPO)   { fail('GITHUB_REPO   not set'); envOk = false; }
else            { ok(`GITHUB_REPO   = ${GH_REPO}`); }

if (!OPENAI_KEY && !GEMINI_KEY) {
  fail('Both OPEN_AI_KEY and GEMINI_AI_KEY are missing. At least one AI key is required.');
  envOk = false;
} else {
  if (!OPENAI_KEY) warn('OPEN_AI_KEY not set – will use fallback scores for GPT');
  else             ok('OPEN_AI_KEY  set');
  if (!GEMINI_KEY) warn('GEMINI_AI_KEY not set – will use fallback scores for Gemini');
  else             ok('GEMINI_AI_KEY set');
}

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
//  FRED fetcher with retry (4 total attempts: 2s, 5s, 7s delays)
// ──────────────────────────────────────────────────────────────
const RETRY_DELAYS_MS = [2000, 5000, 7000];

async function fredFetchWithRetry(seriesId, limit = 100) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      warn(`  ${seriesId}: Retry ${attempt}/${RETRY_DELAYS_MS.length} after ${delay / 1000}s`);
      await sleep(delay);
    }
    try {
      return await fredFetch(seriesId, limit);
    } catch (err) {
      lastErr = err;
      warn(`  ${seriesId}: Attempt ${attempt + 1} failed – ${err.message}`);
    }
  }
  throw lastErr;
}

// ──────────────────────────────────────────────────────────────
//  FRED data helpers
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

// ──────────────────────────────────────────────────────────────
//  Scoring constants & helpers
// ──────────────────────────────────────────────────────────────
const INDICATOR_GROUPS = {
  bond:      ['2y_yield_trend', '2y_vs_ffr'],
  curve:     ['10y_2y'],
  labor:     ['unemployment', 'jobless_claims'],
  inflation: ['core_cpi', 'pce'],
  fed:       ['fed_tone'],
  credit:    ['credit_spread'],
  market:    ['market_behavior']
};

const WEIGHTS = { bond: 0.25, curve: 0.15, labor: 0.2, inflation: 0.15, fed: 0.1, credit: 0.1, market: 0.05 };

function calcTotal(scores) {
  let total = 0;
  for (const [group, keys] of Object.entries(INDICATOR_GROUPS)) {
    if (!keys.length) continue;
    const avg = keys.reduce((s, k) => s + (scores[k]?.score || 0), 0) / keys.length;
    total += WEIGHTS[group] * avg;
  }
  return Math.round(total * 100) / 10; // scale to 0-100 (each indicator 0-10, weighted sum 0-10), 1 decimal
}

function getAction(total) {
  if (total > 80)  return 'Aggressive';
  if (total >= 60) return 'Tăng risk';
  if (total >= 40) return 'Build vị thế';
  return 'Phòng thủ';
}

// ──────────────────────────────────────────────────────────────
//  Market context builder
// ──────────────────────────────────────────────────────────────
function buildMarketContext(fredData) {
  const dgs2   = fredData['DGS2']         || [];
  const dgs10  = fredData['DGS10']        || [];
  const dff    = fredData['DFF']          || [];
  const t10y2y = fredData['T10Y2Y']       || [];
  const unrate = fredData['UNRATE']       || [];
  const icsa   = fredData['ICSA']         || [];
  const cpi    = fredData['CPILFESL']     || [];
  const pce    = fredData['PCEPILFE']     || [];
  const hy     = fredData['BAMLH0A0HYM2'] || [];

  const cur2y    = dgs2.length ? obsVal(dgs2, 0) : null;
  const ago3m2y  = dgs2.length ? obsVal(dgs2, idxMonthsAgo(dgs2, 3)) : null;
  const chg2y    = (cur2y != null && ago3m2y != null) ? +(cur2y - ago3m2y).toFixed(3) : null;

  const cur10y   = dgs10.length ? obsVal(dgs10, 0) : null;
  const curFFR   = dff.length ? obsVal(dff, 0) : null;
  const curSpread = t10y2y.length ? obsVal(t10y2y, 0) : null;

  const curUNRATE = unrate.length ? obsVal(unrate, 0) : null;
  const ago6mUN   = unrate.length ? obsVal(unrate, Math.min(unrate.length - 1, 6)) : null;
  const chgUN     = (curUNRATE != null && ago6mUN != null) ? +(curUNRATE - ago6mUN).toFixed(2) : null;

  const recentICSA = icsa.slice(0, 4).map(o => parseFloat(o.value)).filter(v => !isNaN(v));
  const avgICSA    = recentICSA.length
    ? Math.round(recentICSA.reduce((a, b) => a + b, 0) / recentICSA.length)
    : null;

  const curCPI    = (cpi.length >= 13)
    ? +(((obsVal(cpi, 0) / obsVal(cpi, 12)) - 1) * 100).toFixed(2) : null;
  const ago3mCPI  = (cpi.length >= 16)
    ? +(((obsVal(cpi, 3) / obsVal(cpi, 15)) - 1) * 100).toFixed(2) : null;
  const chgCPI    = (curCPI != null && ago3mCPI != null) ? +(curCPI - ago3mCPI).toFixed(2) : null;

  const curPCE    = (pce.length >= 13)
    ? +(((obsVal(pce, 0) / obsVal(pce, 12)) - 1) * 100).toFixed(2) : null;

  const curHY    = hy.length ? obsVal(hy, 0) : null;
  const ago3mHY  = hy.length ? obsVal(hy, idxMonthsAgo(hy, 3)) : null;
  const chgHY    = (curHY != null && ago3mHY != null) ? +(curHY - ago3mHY).toFixed(3) : null;

  const lines = [];
  if (cur2y != null)     lines.push(`US 2Y Yield: ${cur2y}%${chg2y != null ? ` (3-month change: ${chg2y >= 0 ? '+' : ''}${chg2y}%)` : ''}`);
  if (curFFR != null)    lines.push(`Fed Funds Rate: ${curFFR}%`);
  if (curSpread != null) lines.push(`10Y-2Y Spread: ${curSpread}%`);
  if (cur10y != null)    lines.push(`US 10Y Yield: ${cur10y}%`);
  if (curUNRATE != null) lines.push(`Unemployment Rate: ${curUNRATE}%${chgUN != null ? ` (6-month change: ${chgUN >= 0 ? '+' : ''}${chgUN}%)` : ''}`);
  if (avgICSA != null)   lines.push(`Initial Jobless Claims (4-week avg): ${avgICSA.toLocaleString()}`);
  if (curCPI != null)    lines.push(`Core CPI YoY: ${curCPI}%${chgCPI != null ? ` (3-month change: ${chgCPI >= 0 ? '+' : ''}${chgCPI}pp)` : ''}`);
  if (curPCE != null)    lines.push(`Core PCE YoY: ${curPCE}%`);
  if (curHY != null)     lines.push(`HY Credit Spread (OAS): ${curHY}%${chgHY != null ? ` (3-month change: ${chgHY >= 0 ? '+' : ''}${chgHY}%)` : ''}`);

  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────
//  AI prompt builder
// ──────────────────────────────────────────────────────────────
function buildPrompt(week, marketContext) {
  return `Bạn là chuyên gia phân tích tài chính, dựa vào các tiêu chí đánh giá của bảng dưới đây và dữ liệu thị trường hiện tại để cho số điểm:

DỮ LIỆU THỊ TRƯỜNG (tuần ${week}):
${marketContext}

BẢNG TIÊU CHÍ:
Nhóm\tIndicator\t0 (xấu)\t2.5\t5\t7.5\t10 (tốt)
Bond\t2Y Yield Trend\t↑ mạnh\t↑ nhẹ\tSideway\t↓ nhẹ\t↓ mạnh
Bond\t2Y vs FFR\t2Y > FFR\t2Y > FFR\t≈\t2Y < FFR\t2Y << FFR
Curve\t10Y–2Y\tFlatten (2Y ↑)\tFlatten nhẹ\tFlat\tSteepen nhẹ\tSteepen mạnh
Labor\tUnemployment\t↓\tStable\t↑ nhẹ\t↑ rõ\tSpike
Labor\tJobless Claims\t↓\tFlat\t↑ nhẹ\t↑ rõ\tSpike
Inflation\tCore CPI\t↑\tFlat\t↓ nhẹ\t↓ rõ\t↓ mạnh
Inflation\tPCE\t↑\tFlat\t↓ nhẹ\t↓ rõ\t↓ mạnh
Fed\tFed Tone (Jerome Powell)\tHawkish mạnh\tHawkish nhẹ\tNeutral\tDovish nhẹ\tDovish rõ
Credit\tCredit Spread\t↓\tStable\t↑ nhẹ\t↑ rõ\tStress
Market\tMarket Behavior\tXấu → giảm mạnh\tGiảm nhẹ\tMixed\tKhông giảm\tTăng

weights = {
  bond: 0.25,
  curve: 0.15,
  labor: 0.2,
  inflation: 0.15,
  fed: 0.1,
  credit: 0.1,
  market: 0.05
}

Hãy trả về JSON với format sau (chỉ trả về JSON, không có text khác):
{
  "2y_yield_trend": {"score": <0|2.5|5|7.5|10>, "reasoning": "<ngắn gọn>"},
  "2y_vs_ffr": {"score": <0|2.5|5|7.5|10>, "reasoning": "<ngắn gọn>"},
  "10y_2y": {"score": <0|2.5|5|7.5|10>, "reasoning": "<ngắn gọn>"},
  "unemployment": {"score": <0|2.5|5|7.5|10>, "reasoning": "<ngắn gọn>"},
  "jobless_claims": {"score": <0|2.5|5|7.5|10>, "reasoning": "<ngắn gọn>"},
  "core_cpi": {"score": <0|2.5|5|7.5|10>, "reasoning": "<ngắn gọn>"},
  "pce": {"score": <0|2.5|5|7.5|10>, "reasoning": "<ngắn gọn>"},
  "fed_tone": {"score": <0|2.5|5|7.5|10>, "reasoning": "<ngắn gọn>"},
  "credit_spread": {"score": <0|2.5|5|7.5|10>, "reasoning": "<ngắn gọn>"},
  "market_behavior": {"score": <0|2.5|5|7.5|10>, "reasoning": "<ngắn gọn>"}
}`;
}

// ──────────────────────────────────────────────────────────────
//  AI response parser
// ──────────────────────────────────────────────────────────────
const VALID_SCORES   = new Set([0, 2.5, 5, 7.5, 10]);
const REQUIRED_KEYS  = ['2y_yield_trend', '2y_vs_ffr', '10y_2y', 'unemployment',
                         'jobless_claims', 'core_cpi', 'pce', 'fed_tone',
                         'credit_spread', 'market_behavior'];

function makeFallbackScores() {
  const s = {};
  for (const k of REQUIRED_KEYS) s[k] = { score: 5, reasoning: 'Fallback – AI unavailable' };
  return s;
}

function parseAIResponse(text) {
  // Strip markdown code blocks (handles ```json ... ``` or ``` ... ```)
  let cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```\s*$/gi, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Try to extract JSON object from surrounding text
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`No JSON object found in AI response: ${e.message}`);
    parsed = JSON.parse(m[0]);
  }
  for (const k of REQUIRED_KEYS) {
    if (!parsed[k]) throw new Error(`Missing key: ${k}`);
    const sc = parsed[k].score;
    if (!VALID_SCORES.has(sc)) throw new Error(`Invalid score ${sc} for key ${k}`);
  }
  return parsed;
}

// ──────────────────────────────────────────────────────────────
//  OpenAI API call
// ──────────────────────────────────────────────────────────────
async function callOpenAI(prompt) {
  if (!OPENAI_KEY) {
    warn('OPEN_AI_KEY not set – using fallback GPT scores');
    return makeFallbackScores();
  }
  step('🤖', 'Calling OpenAI API (gpt-4o-mini)…');
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model:       'gpt-4o-mini',
        temperature: 0,
        max_tokens:  2000,
        messages:    [{ role: 'user', content: prompt }]
      })
    });
  } catch (err) {
    warn(`OpenAI fetch error: ${err.message} – using fallback GPT scores`);
    return makeFallbackScores();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    warn(`OpenAI API HTTP ${res.status}: ${body.slice(0, 200)} – using fallback GPT scores`);
    return makeFallbackScores();
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content || '';
  const finishReason = choice?.finish_reason || 'unknown';
  info(`OpenAI response length: ${text.length} chars, finish_reason: ${finishReason}`);
  if (finishReason === 'length') {
    warn('OpenAI response was truncated (finish_reason=length) – using fallback GPT scores');
    info(`  Raw response: ${text.slice(0, 300)}`);
    return makeFallbackScores();
  }
  try {
    const scores = parseAIResponse(text);
    ok('OpenAI scores parsed successfully');
    return scores;
  } catch (e) {
    warn(`OpenAI parse error: ${e.message} – using fallback GPT scores`);
    info(`  Raw response: ${text.slice(0, 300)}`);
    return makeFallbackScores();
  }
}

// ──────────────────────────────────────────────────────────────
//  Gemini API call
// ──────────────────────────────────────────────────────────────
async function callGemini(prompt) {
  if (!GEMINI_KEY) {
    warn('GEMINI_AI_KEY not set – using fallback Gemini scores');
    return makeFallbackScores();
  }
  step('✨', 'Calling Gemini API (gemini-2.5-flash)…');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
  let res;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:     0,
          maxOutputTokens: 4096,
          thinkingConfig:  { thinkingBudget: 0 }
        }
      })
    });
  } catch (err) {
    warn(`Gemini fetch error: ${err.message} – using fallback Gemini scores`);
    return makeFallbackScores();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    warn(`Gemini API HTTP ${res.status}: ${body.slice(0, 200)} – using fallback Gemini scores`);
    return makeFallbackScores();
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || '';
  const finishReason = candidate?.finishReason || 'unknown';
  info(`Gemini response length: ${text.length} chars, finishReason: ${finishReason}`);
  if (finishReason === 'MAX_TOKENS') {
    warn('Gemini response was truncated (finishReason=MAX_TOKENS) – using fallback Gemini scores');
    info(`  Raw response: ${text.slice(0, 300)}`);
    return makeFallbackScores();
  }
  try {
    const scores = parseAIResponse(text);
    ok('Gemini scores parsed successfully');
    return scores;
  } catch (e) {
    warn(`Gemini parse error: ${e.message} – using fallback Gemini scores`);
    info(`  Raw response: ${text.slice(0, 300)}`);
    return makeFallbackScores();
  }
}

// ──────────────────────────────────────────────────────────────
//  Chart data builders
// ──────────────────────────────────────────────────────────────
function buildBondYieldSeries(dgs2, dgs10) {
  const result = [];
  for (let m = 6; m >= 0; m--) {
    const i2  = (dgs2  && dgs2.length)  ? idxMonthsAgo(dgs2,  m) : -1;
    const i10 = (dgs10 && dgs10.length) ? idxMonthsAgo(dgs10, m) : -1;
    const v2   = i2  >= 0 ? obsVal(dgs2,  i2)  : null;
    const v10  = i10 >= 0 ? obsVal(dgs10, i10) : null;
    const date = (dgs2 && dgs2.length && dgs2[i2])
      ? dgs2[i2].date.slice(0, 7)
      : (dgs10 && dgs10.length && dgs10[i10] ? dgs10[i10].date.slice(0, 7) : null);
    if (date) result.push({ date, dgs2: v2, dgs10: v10 });
  }
  return result;
}

function buildLaborSeries(unrate, icsa) {
  const result = [];
  for (let m = 6; m >= 0; m--) {
    const iUN = (unrate && unrate.length) ? idxMonthsAgo(unrate, m) : -1;
    const vUN = iUN >= 0 ? obsVal(unrate, iUN) : null;
    const date = (unrate && unrate.length && unrate[iUN]) ? unrate[iUN].date.slice(0, 7) : null;
    let avgICSA = null;
    if (icsa && icsa.length && date) {
      const monthObs = icsa.filter(o => o.date.slice(0, 7) === date);
      if (monthObs.length) {
        avgICSA = Math.round(monthObs.reduce((s, o) => s + parseFloat(o.value), 0) / monthObs.length);
      } else {
        const iIC = idxMonthsAgo(icsa, m);
        if (iIC >= 0) avgICSA = Math.round(obsVal(icsa, iIC));
      }
    }
    if (date) result.push({ date, unrate: vUN, icsa: avgICSA });
  }
  return result;
}

// ──────────────────────────────────────────────────────────────
//  GitHub API helpers
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
  step('🔍', 'Looking for existing data issue…');
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
  return `# 📊 Pivot Score Data\n\nDữ liệu tự động cập nhật mỗi thứ Hai bởi GitHub Actions.\n\n<!-- PIVOT_DATA_START\n${json}\nPIVOT_DATA_END -->\n`;
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
    info(`Most recent week: ${prevEntries[0].week}`);
  }

  // ── Step 2: Fetch FRED data (sequential, 1s between calls) ───
  banner('Step 2 – Fetch FRED data (sequential, 1s between API calls)');
  const SERIES_CONFIGS = [
    { id: 'DGS2',         limit: 210 },
    { id: 'DGS10',        limit: 210 },
    { id: 'DFF',          limit: 10  },
    { id: 'T10Y2Y',       limit: 210 },
    { id: 'UNRATE',       limit: 12  },
    { id: 'ICSA',         limit: 32  },
    { id: 'CPILFESL',     limit: 18  },
    { id: 'PCEPILFE',     limit: 18  },
    { id: 'BAMLH0A0HYM2', limit: 210 }
  ];

  const fredData = {};
  const t0 = Date.now();
  for (let i = 0; i < SERIES_CONFIGS.length; i++) {
    if (i > 0) {
      info(`  Waiting 1s before next API call…`);
      await sleep(1000);
    }
    const { id, limit } = SERIES_CONFIGS[i];
    try {
      fredData[id] = await fredFetchWithRetry(id, limit);
      ok(`${id}: ${fredData[id].length} obs loaded`);
    } catch (err) {
      warn(`${id}: All retries failed – ${err.message}`);
      fredData[id] = [];
    }
  }
  info(`FRED data load complete in ${Date.now() - t0}ms`);

  // ── Step 3: Build market context ─────────────────────────────
  banner('Step 3 – Build market context');
  const marketContext = buildMarketContext(fredData);
  info('Market context:');
  marketContext.split('\n').forEach(l => info('  ' + l));

  // ── Step 4: Call AI APIs in parallel ─────────────────────────
  banner('Step 4 – AI scoring (OpenAI + Gemini in parallel)');
  const prompt = buildPrompt(week, marketContext);
  const [parsedGptScores, parsedGeminiScores] = await Promise.all([
    callOpenAI(prompt),
    callGemini(prompt)
  ]);

  // ── Step 5: Calculate totals ──────────────────────────────────
  banner('Step 5 – Calculate totals');
  const gpt_total    = calcTotal(parsedGptScores);
  const gemini_total = calcTotal(parsedGeminiScores);
  const total        = Math.round((gpt_total + gemini_total) * 5) / 10;
  console.log(`  GPT total:    ${gpt_total}`);
  console.log(`  Gemini total: ${gemini_total}`);
  console.log(`  Average:      ${total}`);
  console.log(`  Action:       ${getAction(total)}`);

  // ── Step 6: Build chart data ──────────────────────────────────
  banner('Step 6 – Build chart data');
  const chartData = {
    bond_yields: buildBondYieldSeries(fredData['DGS2'], fredData['DGS10']),
    labor:       buildLaborSeries(fredData['UNRATE'], fredData['ICSA'])
  };
  info(`Bond yields chart: ${chartData.bond_yields.length} points`);
  info(`Labor chart: ${chartData.labor.length} points`);

  // ── Step 7: Build & save issue ───────────────────────────────
  banner('Step 7 – Save to GitHub Issue');
  const newEntry = {
    week,
    gpt_scores:    parsedGptScores,
    gemini_scores: parsedGeminiScores,
    gpt_total,
    gemini_total,
    total,
    action:        getAction(total),
    chart_data:    chartData,
    updated_at:    new Date().toISOString()
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
