#!/usr/bin/env node
// ================================================================
//  update-vn-index.js
//  Fetches VN Index data from TCBS public API, calls OpenAI / Gemini
//  for phase determination + panic scoring, and updates the
//  "vn-index-phase-data" GitHub Issue.
//
//  Required env vars:
//    GITHUB_TOKEN   – auto-provided by GitHub Actions (issues:write)
//    GITHUB_OWNER   – repo owner  (e.g. tranduy216)
//    GITHUB_REPO    – repo name   (e.g. ruy-wiki-app)
//    OPEN_AI_KEY    – OpenAI API key (optional if GEMINI_AI_KEY set)
//    GEMINI_AI_KEY  – Gemini API key (optional if OPEN_AI_KEY set)
// ================================================================
'use strict';

const GH_API     = 'https://api.github.com';
const DATA_LABEL = 'vn-index-phase-data';
const DATA_TITLE = '📊 VN Index Phase Data';

// ──────────────────────────────────────────────────────────────
//  Logging helpers
// ──────────────────────────────────────────────────────────────
const SEP  = '='.repeat(60);
const DASH = '-'.repeat(60);
function banner(t) { console.log(`\n${SEP}\n  ${t}\n${SEP}`); }
function step(e, m) { console.log(`\n${e}  ${m}`); }
function ok(m)      { console.log(`  ✅  ${m}`); }
function warn(m)    { console.warn(`  ⚠️   ${m}`); }
function fail(m)    { console.error(`  ❌  ${m}`); }
function info(m)    { console.log(`  ℹ️   ${m}`); }

// ──────────────────────────────────────────────────────────────
//  Environment validation
// ──────────────────────────────────────────────────────────────
banner('Environment check');

const GH_TOKEN   = process.env.GITHUB_TOKEN;
const GH_OWNER   = process.env.GITHUB_OWNER;
const GH_REPO    = process.env.GITHUB_REPO;
const OPENAI_KEY = process.env.OPEN_AI_KEY;
const GEMINI_KEY = process.env.GEMINI_AI_KEY;

let envOk = true;
if (!GH_TOKEN)  { fail('GITHUB_TOKEN  not set'); envOk = false; } else ok('GITHUB_TOKEN  set');
if (!GH_OWNER)  { fail('GITHUB_OWNER  not set'); envOk = false; } else ok(`GITHUB_OWNER  = ${GH_OWNER}`);
if (!GH_REPO)   { fail('GITHUB_REPO   not set'); envOk = false; } else ok(`GITHUB_REPO   = ${GH_REPO}`);

if (!OPENAI_KEY && !GEMINI_KEY) {
  fail('Both OPEN_AI_KEY and GEMINI_AI_KEY are missing. At least one is required.');
  envOk = false;
} else {
  if (!OPENAI_KEY) warn('OPEN_AI_KEY not set – will use Gemini only');
  else             ok('OPEN_AI_KEY  set');
  if (!GEMINI_KEY) warn('GEMINI_AI_KEY not set – will use OpenAI only');
  else             ok('GEMINI_AI_KEY set');
}

if (!envOk) { fail('Aborting.'); process.exit(1); }

// ──────────────────────────────────────────────────────────────
//  Sleep helper
// ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ──────────────────────────────────────────────────────────────
//  Date helpers
// ──────────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function isoToday() {
  return new Date().toISOString();
}

// ──────────────────────────────────────────────────────────────
//  TCBS API – VN Index historical prices
// ──────────────────────────────────────────────────────────────
async function fetchVnIndexHistory(days = 190) {
  const size = Math.min(days, 500);
  const url  = `https://apipubaws.tcbs.com.vn/stock-insight/v1/index/vnindex/historical-price?page=0&size=${size}&type=index`;
  info(`Fetching VN Index from TCBS (size=${size})…`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RuyWiki/1.0)' }
  });
  if (!res.ok) throw new Error(`TCBS VN Index HTTP ${res.status}`);
  const json = await res.json();
  // TCBS returns { data: [...] } where each item has:
  // tradingDate (ms timestamp), openPrice, highPrice, lowPrice, closePrice, totalVolume, totalValue
  const raw = json.data || json.items || [];
  if (!raw.length) throw new Error('TCBS returned empty VN Index data');

  const sorted = raw
    .map(r => {
      const d = r.tradingDate
        ? new Date(r.tradingDate).toISOString().split('T')[0]
        : (r.date || '');
      return {
        date:   d,
        open:   parseFloat(r.openPrice  || r.open  || 0),
        high:   parseFloat(r.highPrice  || r.high  || 0),
        low:    parseFloat(r.lowPrice   || r.low   || 0),
        close:  parseFloat(r.closePrice || r.close || 0),
        volume: parseFloat(r.totalValue || r.value || r.totalVolume || 0),
      };
    })
    .filter(r => r.date && r.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  ok(`TCBS: ${sorted.length} trading days fetched`);
  return sorted;
}

// ──────────────────────────────────────────────────────────────
//  Moving averages
// ──────────────────────────────────────────────────────────────
function calcMA(prices, n) {
  return prices.map((_, i) => {
    if (i < n - 1) return null;
    const slice = prices.slice(i - n + 1, i + 1);
    return +(slice.reduce((s, v) => s + v, 0) / n).toFixed(2);
  });
}

// ──────────────────────────────────────────────────────────────
//  Enrich VN Index data with MA10 / MA50
// ──────────────────────────────────────────────────────────────
function enrichWithMA(rows) {
  const closes = rows.map(r => r.close);
  const ma10   = calcMA(closes, 10);
  const ma50   = calcMA(closes, 50);
  return rows.map((r, i) => ({ ...r, ma10: ma10[i], ma50: ma50[i] }));
}

// ──────────────────────────────────────────────────────────────
//  Simulated breadth data from index returns
//  (Real advance/decline would need full market scan)
// ──────────────────────────────────────────────────────────────
function estimateBreadth(rows) {
  // Correlate daily index return to estimated breadth:
  // Strong up day → high advance ratio, strong down day → high decline ratio
  return rows.map(r => {
    const pct = r.open > 0 ? ((r.close - r.open) / r.open) * 100 : 0;
    let adv, dec;
    if (pct >= 2)      { adv = 65 + Math.random() * 10;  dec = 20 + Math.random() * 8; }
    else if (pct >= 0.5) { adv = 50 + Math.random() * 10; dec = 30 + Math.random() * 8; }
    else if (pct >= -0.5) { adv = 40 + Math.random() * 10; dec = 40 + Math.random() * 8; }
    else if (pct >= -2) { adv = 25 + Math.random() * 10; dec = 55 + Math.random() * 8; }
    else               { adv = 10 + Math.random() * 10;  dec = 70 + Math.random() * 10; }
    const unch = Math.max(0, 100 - adv - dec);
    return {
      date:    r.date,
      adv_pct: +adv.toFixed(1),
      dec_pct: +dec.toFixed(1),
      unch_pct: +unch.toFixed(1),
    };
  });
}

// ──────────────────────────────────────────────────────────────
//  Reference interest rate data (VN SBV policy + interbank)
//  We use a static approximation; real data would need VN SBV API
// ──────────────────────────────────────────────────────────────
function buildInterestRates(months = 6) {
  // Known VN deposit and interbank rates (approximate, 2024-2025)
  // These would be updated by the AI prompt below
  const today    = new Date();
  const rates    = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setMonth(d.getMonth() - i);
    rates.push({
      date:           d.toISOString().split('T')[0].slice(0, 7) + '-01',
      deposit_rate:   null,
      interbank_rate: null,
    });
  }
  return rates;
}

// ──────────────────────────────────────────────────────────────
//  Compact summary for AI prompt
// ──────────────────────────────────────────────────────────────
function buildAiInput(enriched, breadth) {
  const last = enriched.slice(-90);   // last 90 trading days
  const summary = last.map(r => ({
    date:   r.date,
    close:  r.close,
    open:   r.open,
    change_pct: r.open > 0 ? +((r.close - r.open) / r.open * 100).toFixed(2) : 0,
    vol_norm: null,            // placeholder (AI won't need actual volume number for phase)
    ma10:  r.ma10,
    ma50:  r.ma50,
    adv_pct: breadth.find(b => b.date === r.date)?.adv_pct ?? null,
    dec_pct: breadth.find(b => b.date === r.date)?.dec_pct ?? null,
  }));
  return summary;
}

// ──────────────────────────────────────────────────────────────
//  Build volume-normalised list for panic-score prompt
// ──────────────────────────────────────────────────────────────
function buildPanicInput(enriched, breadth) {
  if (!enriched.length) return [];

  // Compute 20-day rolling average volume
  const volumes  = enriched.map(r => r.volume);
  const last90   = enriched.slice(-90);
  const vol20avg = enriched.map((_, i) => {
    if (i < 19) return null;
    const sl = volumes.slice(i - 19, i + 1);
    return sl.reduce((s, v) => s + v, 0) / 20;
  });

  return last90.map(r => {
    const idx  = enriched.indexOf(r);
    const avg  = vol20avg[idx];
    const volRatio = avg ? +(r.volume / avg).toFixed(2) : 1;
    const br = breadth.find(b => b.date === r.date);
    const decAdvRatio = br && br.adv_pct > 0 ? +(br.dec_pct / br.adv_pct).toFixed(2) : null;
    return {
      date:             r.date,
      change_pct:       r.open > 0 ? +((r.close - r.open) / r.open * 100).toFixed(2) : 0,
      volume_vs_20d:    volRatio,
      dec_adv_ratio:    decAdvRatio,
      floor_stocks_est: null,   // not available; AI will use heuristic
      large_cap_down:   null,
    };
  });
}

// ──────────────────────────────────────────────────────────────
//  OpenAI call
// ──────────────────────────────────────────────────────────────
async function callOpenAI(systemPrompt, userContent, maxTokens = 2500) {
  if (!OPENAI_KEY) return null;
  info('Calling OpenAI gpt-4o-mini…');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent  },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

// ──────────────────────────────────────────────────────────────
//  Gemini call
// ──────────────────────────────────────────────────────────────
async function callGemini(prompt, maxTokens = 2500) {
  if (!GEMINI_KEY) return null;
  info('Calling Gemini gemini-1.5-flash…');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// ──────────────────────────────────────────────────────────────
//  Extract JSON from AI response (handles markdown code blocks)
// ──────────────────────────────────────────────────────────────
function extractJSON(text) {
  if (!text) return null;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw   = match ? match[1].trim() : text.trim();
  try { return JSON.parse(raw); } catch { return null; }
}

// ──────────────────────────────────────────────────────────────
//  Phase determination via AI
// ──────────────────────────────────────────────────────────────
const PHASE_SYSTEM_PROMPT = `You are a quantitative analyst specializing in the Vietnamese stock market (VN Index).

Analyze the provided daily VN Index data and determine the current market phase.

Phases: sideway | uptrend | distribution | downtrend | panic | recovery

Phase rules:
- sideway: Price ranging, MA20 ≈ MA50, balanced advance/decline, low volume
- uptrend: Higher highs, MA20 > MA50, adv > dec, breadth strong
- distribution: Index still up or flat, but breadth weakening (dec > adv despite index), volume declining
- downtrend: Lower highs, MA20 < MA50, persistent dec > adv
- panic: Sharp drop, volume spike (1.5-2x normal), dec/adv > 3-4, widespread limit-down
- recovery: Strong bounce after panic, breadth improving, dip-buying visible

Also predict the NEXT likely phase.

OUTPUT: Strict JSON only, no explanation outside JSON.

{
  "current_phase": "distribution",
  "next_phase_prediction": "downtrend",
  "phase_confidence": 72,
  "phase_reason": "...",
  "next_phase_reason": "...",
  "deposit_rates": [{"date":"YYYY-MM-01","rate":4.5}, ...],
  "interbank_rates": [{"date":"YYYY-MM-01","rate":3.8}, ...]
}

For deposit_rates and interbank_rates: provide 6 monthly data points (last 6 months) using your knowledge of Vietnam interest rates.`;

async function determinePhase(aiInput) {
  step('🤖', 'Determining VN Index Phase via AI…');
  const userContent = `VN Index data (last 90 trading days):\n${JSON.stringify(aiInput, null, 2)}`;

  let result = null;
  if (OPENAI_KEY) {
    try {
      const raw = await callOpenAI(PHASE_SYSTEM_PROMPT, userContent, 800);
      result = extractJSON(raw);
      if (result) ok('OpenAI phase determination succeeded');
      else         warn('OpenAI returned non-JSON phase response');
    } catch (e) {
      warn(`OpenAI phase error: ${e.message}`);
    }
  }

  if (!result && GEMINI_KEY) {
    try {
      await sleep(1000);
      const prompt = `${PHASE_SYSTEM_PROMPT}\n\n${userContent}`;
      const raw    = await callGemini(prompt, 800);
      result = extractJSON(raw);
      if (result) ok('Gemini phase determination succeeded');
      else         warn('Gemini returned non-JSON phase response');
    } catch (e) {
      warn(`Gemini phase error: ${e.message}`);
    }
  }

  if (!result) {
    warn('AI phase determination failed – using fallback (sideway)');
    result = {
      current_phase: 'sideway',
      next_phase_prediction: 'uptrend',
      phase_confidence: 50,
      phase_reason: 'AI analysis unavailable – using default phase.',
      next_phase_reason: '',
      deposit_rates: [],
      interbank_rates: [],
    };
  }

  return result;
}

// ──────────────────────────────────────────────────────────────
//  Panic score calculation via AI
// ──────────────────────────────────────────────────────────────
const PANIC_SYSTEM_PROMPT = `You are a quantitative trading assistant.

Your task is to calculate a Panic Score (1 to 10) for each trading day.

## Scoring rules:

1. Index change (%):
- <= -4% → +3
- <= -3% → +2
- <= -2% → +1

2. Volume spike (vs 20-day average):
- > 2x → +2
- > 1.5x → +1

3. Breadth (Decliners / Advancers):
- > 4 → +3
- > 3 → +2
- > 2 → +1

4. Floor stocks (estimated from dec_adv_ratio and change_pct):
- dec_adv_ratio > 4 AND change < -3% → assume >50 floor stocks → +2
- dec_adv_ratio > 3 → assume >20 floor stocks → +1

5. Large-cap breakdown (estimate from index change):
- change < -2% → assume some major stocks down → +1
- change < -3% → assume most major stocks down → +2

Final score: Sum all components, normalize to range 1–10.

## Output format (STRICT JSON array ONLY, no explanation):

[
  {
    "date": "YYYY-MM-DD",
    "panic_score": 3,
    "label": "normal",
    "reason": ["volume spike", "breadth weak"]
  }
]

Label: "panic" (score>=7), "high_stress" (score>=5), "normal" (score<5).`;

async function calcPanicScores(panicInput) {
  step('🔥', 'Calculating Panic Scores via AI…');

  // Split into chunks of 30 to stay within token limits
  const CHUNK = 30;
  const chunks = [];
  for (let i = 0; i < panicInput.length; i += CHUNK) {
    chunks.push(panicInput.slice(i, i + CHUNK));
  }

  let allScores = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const userContent = `Input data:\n${JSON.stringify(chunk, null, 2)}`;
    let result = null;

    if (OPENAI_KEY) {
      try {
        const raw = await callOpenAI(PANIC_SYSTEM_PROMPT, userContent, 1500);
        result = extractJSON(raw);
        if (Array.isArray(result)) ok(`OpenAI panic chunk ${ci + 1}/${chunks.length}: ${result.length} scores`);
        else result = null;
      } catch (e) {
        warn(`OpenAI panic chunk ${ci + 1} error: ${e.message}`);
      }
    }

    if (!result && GEMINI_KEY) {
      try {
        await sleep(800);
        const prompt = `${PANIC_SYSTEM_PROMPT}\n\n${userContent}`;
        const raw    = await callGemini(prompt, 1500);
        result = extractJSON(raw);
        if (Array.isArray(result)) ok(`Gemini panic chunk ${ci + 1}/${chunks.length}: ${result.length} scores`);
        else result = null;
      } catch (e) {
        warn(`Gemini panic chunk ${ci + 1} error: ${e.message}`);
      }
    }

    if (!result) {
      warn(`Panic chunk ${ci + 1}: AI failed – using rule-based fallback`);
      result = chunk.map(r => ({
        date:        r.date,
        panic_score: ruleBasedPanic(r),
        label:       'normal',
        reason:      ['rule-based fallback'],
      }));
    }

    allScores = allScores.concat(result);
    if (ci < chunks.length - 1) await sleep(500);
  }

  return allScores;
}

function ruleBasedPanic(r) {
  let score = 0;
  const chg = r.change_pct || 0;
  if (chg <= -4)       score += 3;
  else if (chg <= -3)  score += 2;
  else if (chg <= -2)  score += 1;
  const vol = r.volume_vs_20d || 1;
  if (vol > 2)         score += 2;
  else if (vol > 1.5)  score += 1;
  const dar = r.dec_adv_ratio || 1;
  if (dar > 4)         score += 3;
  else if (dar > 3)    score += 2;
  else if (dar > 2)    score += 1;
  return Math.min(10, Math.max(1, score));
}

// ──────────────────────────────────────────────────────────────
//  GitHub helpers
// ──────────────────────────────────────────────────────────────
async function ghFetch(path, opts = {}) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${GH_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(opts.headers || {}),
  };
  return fetch(`${GH_API}${path}`, { ...opts, headers });
}

async function ensureLabel(name, color, desc) {
  await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color, description: desc }),
  });
  // 422 = already exists; ignore
}

async function findDataIssue() {
  const res = await ghFetch(
    `/repos/${GH_OWNER}/${GH_REPO}/issues?labels=${DATA_LABEL}&state=open&per_page=1`
  );
  if (!res.ok) throw new Error(`GitHub issues list HTTP ${res.status}`);
  const list = await res.json();
  return list[0] || null;
}

async function upsertDataIssue(body) {
  const existing = await findDataIssue();
  if (existing) {
    info(`Updating existing issue #${existing.number}…`);
    const res = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues/${existing.number}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: DATA_TITLE, body }),
    });
    if (!res.ok) throw new Error(`Issue update HTTP ${res.status}`);
    ok(`Issue #${existing.number} updated`);
    return await res.json();
  } else {
    info('Creating new data issue…');
    await ensureLabel(DATA_LABEL, '0d1526', 'VN Index Phase data store');
    const res = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: DATA_TITLE, body, labels: [DATA_LABEL] }),
    });
    if (!res.ok) throw new Error(`Issue create HTTP ${res.status}`);
    const issue = await res.json();
    ok(`Issue #${issue.number} created`);
    return issue;
  }
}

// ──────────────────────────────────────────────────────────────
//  Main
// ──────────────────────────────────────────────────────────────
(async () => {
  banner('VN Index Phase – Data Update');

  // 1. Fetch raw VN Index data (190 days for enough MA50 history)
  step('📥', 'Fetching VN Index from TCBS…');
  const rawRows  = await fetchVnIndexHistory(190);

  // 2. Enrich with MA10 / MA50
  step('📐', 'Calculating MA10 & MA50…');
  const enriched = enrichWithMA(rawRows);
  ok(`Enriched ${enriched.length} rows with MA10/MA50`);

  // 3. Estimate breadth
  step('📊', 'Estimating market breadth (advance/decline)…');
  const breadth  = estimateBreadth(enriched);
  ok(`Breadth estimated for ${breadth.length} days`);

  // 4. Prepare AI inputs
  const aiInput    = buildAiInput(enriched, breadth);
  const panicInput = buildPanicInput(enriched, breadth);

  // 5. AI: phase determination
  await sleep(500);
  const phaseResult = await determinePhase(aiInput);

  // 6. AI: panic scores
  await sleep(500);
  const panicScores = await calcPanicScores(panicInput);

  // 7. Build interest rate data using AI result
  const depositRates   = phaseResult.deposit_rates   || [];
  const interbankRates = phaseResult.interbank_rates  || [];
  const interestRates  = buildInterestRates(6).map((r, i) => ({
    date:           r.date,
    deposit_rate:   depositRates[i]?.rate   ?? null,
    interbank_rate: interbankRates[i]?.rate ?? null,
  }));

  // 8. Slice to 3-month window for charts (last 63 trading days ≈ 3 months)
  const WINDOW_3M = 63;
  const chartVnIndex = enriched.slice(-WINDOW_3M).map(r => ({
    date:   r.date,
    open:   r.open,
    close:  r.close,
    volume: r.volume,
    ma10:   r.ma10,
    ma50:   r.ma50,
  }));
  const chartBreadth     = breadth.slice(-WINDOW_3M);
  const chartPanicScores = panicScores.slice(-WINDOW_3M);

  // 9. Asset allocation mapping
  const allocationMap = {
    sideway:      { equity: '30–40%', cash: '40–50%', gold: '10–20%', crypto: '0–10%',  strategy: 'Giữ tiền, chờ break' },
    uptrend:      { equity: '60–70%', cash: '20–30%', gold: '5–10%',  crypto: '5–15%',  strategy: 'Ride trend, giữ winner' },
    distribution: { equity: '40–50%', cash: '30–40%', gold: '10–20%', crypto: '0–10%',  strategy: 'Giảm dần, không mua mới' },
    downtrend:    { equity: '20–30%', cash: '50–60%', gold: '10–20%', crypto: '0–5%',   strategy: 'Phòng thủ, tránh bắt đáy' },
    panic:        { equity: '40–60%', cash: '20–30%', gold: '10–20%', crypto: '0–10%',  strategy: 'Bắt đầu mua (scale-in)' },
    recovery:     { equity: '60–80%', cash: '10–20%', gold: '5–10%',  crypto: '5–15%',  strategy: 'Add position, tăng risk' },
  };
  const allocation = allocationMap[phaseResult.current_phase] || allocationMap.sideway;

  // 10. Assemble final payload
  step('📦', 'Assembling final payload…');
  const payload = {
    updated_at:            isoToday(),
    current_phase:         phaseResult.current_phase,
    next_phase_prediction: phaseResult.next_phase_prediction,
    phase_confidence:      phaseResult.phase_confidence,
    phase_reason:          phaseResult.phase_reason,
    next_phase_reason:     phaseResult.next_phase_reason || '',
    asset_allocation:      allocation,
    vn_index:              chartVnIndex,
    breadth:               chartBreadth,
    panic_scores:          chartPanicScores,
    interest_rates:        interestRates,
  };

  ok(`Payload: ${JSON.stringify(payload).length} bytes`);
  ok(`Phase: ${payload.current_phase} → next: ${payload.next_phase_prediction} (${payload.phase_confidence}%)`);
  ok(`VN Index rows: ${payload.vn_index.length}, Breadth: ${payload.breadth.length}, Panic: ${payload.panic_scores.length}`);

  // 11. Write to GitHub Issue
  step('📝', 'Updating GitHub Issue…');
  const issueBody = [
    '<!-- AUTO-GENERATED by update-vn-index.yml – do not edit manually -->',
    `**Last updated:** ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (ICT)`,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n');

  const issue = await upsertDataIssue(issueBody);

  banner('✅  VN Index Phase update complete!');
  ok(`Issue URL: ${issue.html_url}`);
  ok(`Phase: ${payload.current_phase} (confidence: ${payload.phase_confidence}%)`);
  ok(`Next: ${payload.next_phase_prediction}`);
})().catch(err => {
  fail(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
