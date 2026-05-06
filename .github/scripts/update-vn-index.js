#!/usr/bin/env node
// ================================================================
//  update-vn-index.js
//  Fetches VN Index data from TCBS public API, calls OpenAI / Gemini
//  for phase determination + panic scoring, and updates one GitHub
//  Issue per calendar month (label: vn-index-phase-data).
//
//  Schedule: daily Mon-Fri at 13:00 UTC (20:00 ICT) after VN market.
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

// Issue title includes the month so each month gets its own issue.
// e.g. "📊 VN Index Phase Data – 2025-01"
function monthlyTitle(yearMonth) {
  return `📊 VN Index Phase Data – ${yearMonth}`;
}

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
function isoToday() { return new Date().toISOString(); }

// Returns "YYYY-MM" for the current month in ICT (UTC+7)
function currentYearMonth() {
  const ict = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return ict.toISOString().slice(0, 7);        // e.g. "2025-01"
}

// First and last date of a "YYYY-MM" month as ISO strings
function monthRange(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  const start  = new Date(Date.UTC(y, m - 1, 1)).toISOString().split('T')[0];
  const end    = new Date(Date.UTC(y, m, 0)).toISOString().split('T')[0];
  return { start, end };
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
//  Simulated breadth data derived from index returns.
//  NOTE: This is an approximation – real advance/decline data
//  would require scanning all listed stocks daily.  The AI prompt
//  for phase determination uses these estimates; treat them as a
//  directional signal, not precise market-breadth figures.
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
//  OpenAI call  (Responses API – gpt-5.4-mini, matching pivot style)
// ──────────────────────────────────────────────────────────────
async function callOpenAI(systemPrompt, userContent, maxTokens = 2500) {
  if (!OPENAI_KEY) return null;
  info('Calling OpenAI API (gpt-5.4-mini)…');
  const prompt = `${systemPrompt}\n\n${userContent}`;
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model:             'gpt-5.4-mini',
        temperature:       0,
        max_output_tokens: maxTokens,
        input:             prompt,
        store:             true,
      }),
    });
  } catch (err) {
    throw new Error(`OpenAI fetch error: ${err.message}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const outputItem = data.output?.[0];
  const text       = outputItem?.content?.[0]?.text || '';
  const status     = data.status || 'unknown';
  info(`OpenAI response length: ${text.length} chars, status: ${status}`);
  if (status === 'incomplete') {
    throw new Error('OpenAI response was truncated (status=incomplete)');
  }
  return text.trim() || null;
}

// ──────────────────────────────────────────────────────────────
//  Gemini call  (gemini-2.5-flash, matching pivot style)
// ──────────────────────────────────────────────────────────────
async function callGemini(prompt, maxTokens = 2500) {
  if (!GEMINI_KEY) return null;
  info('Calling Gemini API (gemini-2.5-flash)…');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:      0,
          maxOutputTokens:  maxTokens,
          thinkingConfig:   { thinkingBudget: 0 },
        },
      }),
    });
  } catch (err) {
    throw new Error(`Gemini fetch error: ${err.message}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data        = await res.json();
  const candidate   = data.candidates?.[0];
  const text        = candidate?.content?.parts?.[0]?.text?.trim() || '';
  const finishReason = candidate?.finishReason || 'unknown';
  info(`Gemini response length: ${text.length} chars, finishReason: ${finishReason}`);
  if (finishReason === 'MAX_TOKENS') {
    throw new Error('Gemini response was truncated (finishReason=MAX_TOKENS)');
  }
  return text || null;
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
  step('🤖', 'Determining VN Index Phase via AI (OpenAI + Gemini independently)…');
  const userContent = `VN Index data (last 90 trading days):\n${JSON.stringify(aiInput, null, 2)}`;

  // Call both providers independently so we can store separate analytical outputs.
  let openaiResult = null;
  let geminiResult = null;

  if (OPENAI_KEY) {
    try {
      const raw = await callOpenAI(PHASE_SYSTEM_PROMPT, userContent, 800);
      openaiResult = extractJSON(raw);
      if (openaiResult) ok('OpenAI phase determination succeeded');
      else              warn('OpenAI returned non-JSON phase response');
    } catch (e) {
      warn(`OpenAI phase error: ${e.message}`);
    }
  }

  if (GEMINI_KEY) {
    try {
      await sleep(1000);
      const prompt = `${PHASE_SYSTEM_PROMPT}\n\n${userContent}`;
      const raw    = await callGemini(prompt, 800);
      geminiResult = extractJSON(raw);
      if (geminiResult) ok('Gemini phase determination succeeded');
      else              warn('Gemini returned non-JSON phase response');
    } catch (e) {
      warn(`Gemini phase error: ${e.message}`);
    }
  }

  // Resolved top-level values: prefer OpenAI, fall back to Gemini, then hardcoded default.
  const resolved = openaiResult || geminiResult || {
    current_phase:         'sideway',
    next_phase_prediction: 'uptrend',
    phase_confidence:      50,
    phase_reason:          'AI analysis unavailable – using default phase.',
    next_phase_reason:     '',
    deposit_rates:         [],
    interbank_rates:       [],
  };

  if (!openaiResult && !geminiResult) {
    warn('AI phase determination failed for both providers – using hardcoded fallback (sideway)');
  }

  // Return per-provider results alongside the resolved value.
  return { openai: openaiResult, gemini: geminiResult, resolved };
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

async function findMonthIssue(yearMonth) {
  const title = monthlyTitle(yearMonth);
  // Search all open issues with the label, then match by title
  let page = 1;
  while (true) {
    const res = await ghFetch(
      `/repos/${GH_OWNER}/${GH_REPO}/issues?labels=${DATA_LABEL}&state=open&per_page=30&page=${page}`
    );
    if (!res.ok) throw new Error(`GitHub issues list HTTP ${res.status}`);
    const list = await res.json();
    if (!list.length) break;
    const found = list.find(i => i.title === title);
    if (found) return found;
    if (list.length < 30) break;
    page++;
  }
  return null;
}

async function upsertMonthIssue(yearMonth, body) {
  const title    = monthlyTitle(yearMonth);
  const existing = await findMonthIssue(yearMonth);
  if (existing) {
    info(`Updating existing issue #${existing.number} (${yearMonth})…`);
    const res = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues/${existing.number}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    if (!res.ok) throw new Error(`Issue update HTTP ${res.status}`);
    ok(`Issue #${existing.number} updated`);
    return await res.json();
  } else {
    info(`Creating new issue for ${yearMonth}…`);
    // Ensure label exists (422 = already exists, ignore)
    await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DATA_LABEL, color: '0d1526', description: 'VN Index Phase monthly data' }),
    });
    const res = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, labels: [DATA_LABEL] }),
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
  banner('VN Index Phase – Daily Data Update');

  const yearMonth = currentYearMonth();
  const { start: monthStart } = monthRange(yearMonth);
  ok(`Month: ${yearMonth}  (from ${monthStart})`);

  // 1. Fetch raw VN Index data.
  //    We fetch 190 days to have enough history for MA50,
  //    but only persist the current month's data in the issue.
  step('📥', 'Fetching VN Index from TCBS…');
  const rawRows  = await fetchVnIndexHistory(190);

  // 2. Enrich with MA10 / MA50 (using full history for accuracy)
  step('📐', 'Calculating MA10 & MA50…');
  const enriched = enrichWithMA(rawRows);
  ok(`Enriched ${enriched.length} rows`);

  // 3. Estimate breadth for all rows
  step('📊', 'Estimating market breadth…');
  const breadth  = estimateBreadth(enriched);

  // 4. Prepare AI inputs (last 90 trading days for context)
  const aiInput    = buildAiInput(enriched, breadth);
  const panicInput = buildPanicInput(enriched, breadth);

  // 5. AI: phase determination (both OpenAI and Gemini run independently)
  await sleep(500);
  const phaseResult  = await determinePhase(aiInput);
  const openaiPhase  = phaseResult.openai;
  const geminiPhase  = phaseResult.gemini;
  const resolved     = phaseResult.resolved;

  // 6. AI: panic scores (chart/numeric – OpenAI → Gemini → rule-based API fallback)
  await sleep(500);
  const panicScores = await calcPanicScores(panicInput);

  // 7. Build interest rate data.
  //    Priority: OpenAI rates → Gemini rates → empty (null values from buildInterestRates).
  //    Raw API/computed rates serve as the deterministic fallback via buildInterestRates().
  const depositRates   = openaiPhase?.deposit_rates   || geminiPhase?.deposit_rates   || resolved.deposit_rates   || [];
  const interbankRates = openaiPhase?.interbank_rates  || geminiPhase?.interbank_rates  || resolved.interbank_rates  || [];
  const interestRates  = buildInterestRates(6).map((r, i) => ({
    date:           r.date,
    deposit_rate:   depositRates[i]?.rate   ?? null,
    interbank_rate: interbankRates[i]?.rate ?? null,
  }));

  // 8. Filter to CURRENT MONTH only for issue storage.
  //    This keeps each issue small (≈ 20 trading days).
  const monthRows    = enriched.filter(r => r.date >= monthStart);
  const monthBreadth = breadth.filter(r => r.date >= monthStart);

  // Align panic scores to month rows (panic scores cover the last 90 days window)
  const monthPanic = monthRows.map(r => {
    const ps = panicScores.find(p => p.date === r.date);
    return ps || { date: r.date, panic_score: 1, label: 'normal', reason: [] };
  });

  const chartVnIndex = monthRows.map(r => ({
    date:   r.date,
    open:   r.open,
    close:  r.close,
    volume: r.volume,
    ma10:   r.ma10,
    ma50:   r.ma50,
  }));

  // 9. Asset allocation mapping
  const allocationMap = {
    sideway:      { equity: '30–40%', cash: '40–50%', gold: '10–20%', crypto: '0–10%',  strategy: 'Giữ tiền, chờ break' },
    uptrend:      { equity: '60–70%', cash: '20–30%', gold: '5–10%',  crypto: '5–15%',  strategy: 'Ride trend, giữ winner' },
    distribution: { equity: '40–50%', cash: '30–40%', gold: '10–20%', crypto: '0–10%',  strategy: 'Giảm dần, không mua mới' },
    downtrend:    { equity: '20–30%', cash: '50–60%', gold: '10–20%', crypto: '0–5%',   strategy: 'Phòng thủ, tránh bắt đáy' },
    panic:        { equity: '40–60%', cash: '20–30%', gold: '10–20%', crypto: '0–10%',  strategy: 'Bắt đầu mua (scale-in)' },
    recovery:     { equity: '60–80%', cash: '10–20%', gold: '5–10%',  crypto: '5–15%',  strategy: 'Add position, tăng risk' },
  };
  const allocation = allocationMap[resolved.current_phase] || allocationMap.sideway;

  // 10. Assemble payload (month-scoped data only).
  //     Top-level phase fields use the resolved (OpenAI-preferred) value for UI backward-compat.
  //     provider_analysis stores the separate per-provider outputs for deeper inspection.
  step('📦', 'Assembling monthly payload…');

  const providerAnalysis = {
    openai: openaiPhase ? {
      current_phase:         openaiPhase.current_phase,
      next_phase_prediction: openaiPhase.next_phase_prediction,
      phase_confidence:      openaiPhase.phase_confidence,
      phase_reason:          openaiPhase.phase_reason,
      next_phase_reason:     openaiPhase.next_phase_reason || '',
    } : null,
    gemini: geminiPhase ? {
      current_phase:         geminiPhase.current_phase,
      next_phase_prediction: geminiPhase.next_phase_prediction,
      phase_confidence:      geminiPhase.phase_confidence,
      phase_reason:          geminiPhase.phase_reason,
      next_phase_reason:     geminiPhase.next_phase_reason || '',
    } : null,
  };

  const payload = {
    updated_at:            isoToday(),
    month:                 yearMonth,
    current_phase:         resolved.current_phase,
    next_phase_prediction: resolved.next_phase_prediction,
    phase_confidence:      resolved.phase_confidence,
    phase_reason:          resolved.phase_reason,
    next_phase_reason:     resolved.next_phase_reason || '',
    provider_analysis:     providerAnalysis,
    asset_allocation:      allocation,
    vn_index:              chartVnIndex,
    breadth:               monthBreadth,
    panic_scores:          monthPanic,
    interest_rates:        interestRates,  // 6 monthly points, same in every issue
  };

  ok(`Payload size: ${JSON.stringify(payload).length} bytes`);
  ok(`Month rows: ${chartVnIndex.length} trading days`);
  ok(`Phase: ${payload.current_phase} → next: ${payload.next_phase_prediction} (${payload.phase_confidence}%)`);

  // 11. Write to the current month's GitHub Issue
  step('📝', `Writing to GitHub Issue for ${yearMonth}…`);
  const issueBody = [
    `<!-- AUTO-GENERATED by update-vn-index.yml – do not edit manually. Month: ${yearMonth} -->`,
    `**Last updated:** ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (ICT)`,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n');

  const issue = await upsertMonthIssue(yearMonth, issueBody);

  banner('✅  VN Index Phase update complete!');
  ok(`Issue: ${issue.html_url}`);
  ok(`Month: ${yearMonth}  Phase: ${payload.current_phase}  Confidence: ${payload.phase_confidence}%`);
  ok(`Next phase: ${payload.next_phase_prediction}`);
  if (openaiPhase)  ok(`OpenAI phase:  ${openaiPhase.current_phase}  (${openaiPhase.phase_confidence}%)`);
  if (geminiPhase)  ok(`Gemini phase:  ${geminiPhase.current_phase}  (${geminiPhase.phase_confidence}%)`);
})().catch(err => {
  fail(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
