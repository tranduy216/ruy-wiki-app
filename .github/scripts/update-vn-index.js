#!/usr/bin/env node
// ================================================================
//  update-vn-index.js
//  Calls OpenAI / Gemini for VN Index phase determination and
//  updates one GitHub Issue per calendar month (label: vn-index-phase-data).
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

// ──────────────────────────────────────────────────────────────
//  Reference interest rate date scaffold
// ──────────────────────────────────────────────────────────────
function buildRateDateScaffold(months = 6) {
  const today = new Date();
  const dates = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setMonth(d.getMonth() - i);
    dates.push(d.toISOString().split('T')[0].slice(0, 7) + '-01');
  }
  return dates;
}

// ──────────────────────────────────────────────────────────────
//  Comprehensive AI prompt – all data in one shot
// ──────────────────────────────────────────────────────────────
const AI_SYSTEM_PROMPT = `You are a quantitative analyst specializing in the Vietnamese stock market (VN Index).

IMPORTANT: Search the web to get REAL and CURRENT market data. Use sources such as:
- HOSE/HNX official sites, VietstockFinance (vietstock.vn), CafeF (cafef.vn), TradingView VN30/VNINDEX
- SBV (State Bank of Vietnam) for interest rate data
- Any recent news or financial data portal covering the Vietnamese market

Based on REAL data fetched from the web, provide a complete analysis package for the requested month.

You must provide ALL of the following:
1. Current market phase assessment
2. Recent daily VN Index OHLCV + MA data (last ~20 trading days of the current month, oldest→newest)
3. Market breadth estimates (advance/decline %) for those same trading days
4. Panic score for each trading day
5. Vietnam interest rate data (last 6 months, oldest→newest)

Phases: sideway | uptrend | distribution | downtrend | panic | recovery

Phase rules:
- sideway: Price ranging, MA20 ≈ MA50, balanced advance/decline, low volume
- uptrend: Higher highs, MA20 > MA50, adv > dec, breadth strong
- distribution: Index still up or flat, but breadth weakening (dec > adv despite index), volume declining
- downtrend: Lower highs, MA20 < MA50, persistent dec > adv
- panic: Sharp drop, volume spike (1.5-2x normal), dec/adv > 3-4, widespread limit-down
- recovery: Strong bounce after panic, breadth improving, dip-buying visible

Panic score rules (1–10, sum of components):
- Index change <= -4% → +3, <= -3% → +2, <= -2% → +1
- Volume > 2× 20d avg → +2, > 1.5× → +1
- dec/adv ratio > 4 → +3, > 3 → +2, > 2 → +1
- Label: "panic" (score≥7), "high_stress" (score≥5), "normal" (score<5)

CRITICAL RULES:
1. current_phase, next_phase_prediction, phase_confidence, phase_reason MUST always be filled.
   Even if you cannot obtain exact numeric data, you MUST assess the phase qualitatively
   using the phase rules above (MA relationship, breadth direction, volume, market behavior).
2. market_commentary MUST always be filled with qualitative observations in Vietnamese.
   This is the primary fallback when numeric chart data is unavailable.
3. If you cannot provide exact numeric rows for vn_index/breadth/panic_scores/interest_rates,
   set those arrays to [] but NEVER leave market_commentary empty.

OUTPUT: Strict JSON only, no explanation outside JSON.

{
  "current_phase": "downtrend",
  "next_phase_prediction": "recovery",
  "phase_confidence": 65,
  "phase_reason": "...",
  "next_phase_reason": "...",
  "market_commentary": {
    "vn_index_trend": "MA10 đang có xu hướng gần lại MA50. Thanh khoản đang ở mức 20–25 nghìn tỷ/phiên, thấp hơn trung bình 3 tháng.",
    "breadth_trend": "Số lượng mã tăng đang có xu hướng ít dần so với mã giảm trong 2 tuần gần nhất.",
    "market_state": "Thị trường có vẻ đang ở trạng thái phân phối – index giữ nhưng breadth xấu dần.",
    "interest_rate_trend": "Lãi suất huy động đang tăng nhẹ trong tháng gần nhất. Lãi suất liên ngân hàng ổn định quanh 4.5–5%."
  },
  "vn_index": [
    {"date":"YYYY-MM-DD","open":1200.5,"close":1210.3,"volume":15000000000,"ma10":1205.0,"ma50":1190.0}
  ],
  "breadth": [
    {"date":"YYYY-MM-DD","adv_pct":55.0,"dec_pct":35.0,"unch_pct":10.0}
  ],
  "panic_scores": [
    {"date":"YYYY-MM-DD","panic_score":2,"label":"normal","reason":["breadth balanced"]}
  ],
  "interest_rates": [
    {"date":"YYYY-MM-01","deposit_rate":4.5,"interbank_rate":3.8}
  ]
}

Notes:
- vn_index, breadth, panic_scores must cover the same trading dates, oldest first
- volume is in VND (e.g. 15000000000 = 15 billion VND)
- ma10 = 10-day simple moving average of closing prices; ma50 = 50-day SMA. Set to null if insufficient history.
- interest_rates: exactly 6 monthly data points (oldest first). Use null for deposit_rate or interbank_rate if data is unavailable for that month; do NOT omit the entry.
- market_commentary fields must be in Vietnamese and describe the CURRENT observable trend, not generic descriptions.`;

// ──────────────────────────────────────────────────────────────
//  Fetch ALL data from AI (phase + charts + rates)
// ──────────────────────────────────────────────────────────────
async function fetchAllFromAI(yearMonth) {
  step('🤖', 'Fetching all VN Index data from AI (OpenAI + Gemini independently)…');
  const today = new Date().toISOString().split('T')[0];
  const userContent = `Today's date: ${today}. Current month: ${yearMonth}. Provide the complete VN Index analysis package for this month.`;

  // Call both providers independently so we can store separate analytical outputs.
  let openaiResult = null;
  let geminiResult = null;

  if (OPENAI_KEY) {
    try {
      const raw = await callOpenAI(AI_SYSTEM_PROMPT, userContent, 16000);
      openaiResult = extractJSON(raw);
      if (openaiResult) ok('OpenAI data fetch succeeded');
      else              warn('OpenAI returned non-JSON response');
    } catch (e) {
      warn(`OpenAI error: ${e.message}`);
    }
  }

  if (GEMINI_KEY) {
    try {
      await sleep(1000);
      const prompt = `${AI_SYSTEM_PROMPT}\n\n${userContent}`;
      const raw    = await callGemini(prompt, 16000);
      geminiResult = extractJSON(raw);
      if (geminiResult) ok('Gemini data fetch succeeded');
      else              warn('Gemini returned non-JSON response');
    } catch (e) {
      warn(`Gemini error: ${e.message}`);
    }
  }

  // Resolved top-level values: prefer OpenAI, fall back to Gemini, then null defaults.
  const resolved = openaiResult || geminiResult || {
    current_phase:         null,
    next_phase_prediction: null,
    phase_confidence:      null,
    phase_reason:          null,
    next_phase_reason:     null,
    market_commentary:     null,
    vn_index:              [],
    breadth:               [],
    panic_scores:          [],
    interest_rates:        [],
  };

  if (!openaiResult && !geminiResult) {
    warn('AI data fetch failed for both providers – all fields will be null/empty (shown as N/A in UI)');
  }

  // Return per-provider results alongside the resolved value.
  return { openai: openaiResult, gemini: geminiResult, resolved };
}

// ──────────────────────────────────────────────────────────────
//  OpenAI call  (Responses API – gpt-5.4-mini, with web search)
// ──────────────────────────────────────────────────────────────
async function callOpenAI(systemPrompt, userContent, maxTokens = 16000) {
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
        tools:             [{ type: 'web_search_preview' }],
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
  // When web_search_preview is used, output contains multiple items (web_search_call + message).
  // Collect all text content from all message-type output items.
  // Also handle legacy single-item responses (no web search active) by checking all item types.
  let text = '';
  for (const item of (data.output || [])) {
    for (const c of (item.content || [])) {
      if (c.text) text += c.text;
    }
  }
  const status = data.status || 'unknown';
  info(`OpenAI response length: ${text.length} chars, status: ${status}`);
  if (status === 'incomplete') {
    throw new Error('OpenAI response was truncated (status=incomplete)');
  }
  return text.trim() || null;
}

// ──────────────────────────────────────────────────────────────
//  Gemini call  (gemini-2.5-flash, with Google Search grounding)
// ──────────────────────────────────────────────────────────────
async function callGemini(prompt, maxTokens = 16000) {
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
        tools: [{ googleSearch: {} }],
        // Note: thinkingConfig is omitted here because thinkingBudget:0 (disabling thinking)
        // is incompatible with googleSearch grounding – the model needs some reasoning budget
        // to process search results. Omitting it lets the API use its default.
        generationConfig: {
          temperature:      0,
          maxOutputTokens:  maxTokens,
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
  // Grounding may add multiple text parts – join them all.
  const text        = (candidate?.content?.parts || [])
    .map(p => p.text || '').join('').trim();
  const finishReason = candidate?.finishReason || 'unknown';
  info(`Gemini response length: ${text.length} chars, finishReason: ${finishReason}`);
  if (finishReason === 'MAX_TOKENS') {
    // Don't throw – try to parse whatever was returned before truncation.
    warn('Gemini response was truncated (finishReason=MAX_TOKENS) – attempting partial parse (some analysis fields may be missing or incomplete)');
  }
  return text || null;
}

// ──────────────────────────────────────────────────────────────
//  Extract JSON from AI response (handles markdown code blocks
//  and surrounding citation/grounding text from Google Search)
// ──────────────────────────────────────────────────────────────
function extractJSON(text) {
  if (!text) return null;
  // 1. Try markdown code block (```json ... ```)
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch {}
  }
  // 2. Find the outermost JSON object by scanning for first '{' and last '}'
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
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
  ok(`Month: ${yearMonth}`);

  // 1. Fetch ALL data from AI (both providers run independently)
  const aiResult   = await fetchAllFromAI(yearMonth);
  const openaiData = aiResult.openai;
  const geminiData = aiResult.gemini;
  const resolved   = aiResult.resolved;

  // 2. Chart data: prefer OpenAI → Gemini → empty [] (shown as N/A in UI)
  const vnIndex    = (Array.isArray(openaiData?.vn_index)    ? openaiData.vn_index    : null)
                  || (Array.isArray(geminiData?.vn_index)    ? geminiData.vn_index    : null)
                  || [];
  const breadth    = (Array.isArray(openaiData?.breadth)     ? openaiData.breadth     : null)
                  || (Array.isArray(geminiData?.breadth)     ? geminiData.breadth     : null)
                  || [];
  const panicScores = (Array.isArray(openaiData?.panic_scores) ? openaiData.panic_scores : null)
                   || (Array.isArray(geminiData?.panic_scores) ? geminiData.panic_scores : null)
                   || [];

  // 3. Interest rates: prefer OpenAI → Gemini → date scaffold with nulls
  const interestRates = (Array.isArray(openaiData?.interest_rates) && openaiData.interest_rates.length ? openaiData.interest_rates : null)
                     || (Array.isArray(geminiData?.interest_rates) && geminiData.interest_rates.length ? geminiData.interest_rates : null)
                     || buildRateDateScaffold(6).map(date => ({ date, deposit_rate: null, interbank_rate: null }));

  // 4. Market commentary: prefer OpenAI → Gemini → null
  const marketCommentary = openaiData?.market_commentary || geminiData?.market_commentary || null;

  // 5. Asset allocation mapping
  const allocationMap = {
    sideway:      { equity: '30–40%', cash: '40–50%', gold: '10–20%', crypto: '0–10%',  strategy: 'Giữ tiền, chờ break' },
    uptrend:      { equity: '60–70%', cash: '20–30%', gold: '5–10%',  crypto: '5–15%',  strategy: 'Ride trend, giữ winner' },
    distribution: { equity: '40–50%', cash: '30–40%', gold: '10–20%', crypto: '0–10%',  strategy: 'Giảm dần, không mua mới' },
    downtrend:    { equity: '20–30%', cash: '50–60%', gold: '10–20%', crypto: '0–5%',   strategy: 'Phòng thủ, tránh bắt đáy' },
    panic:        { equity: '40–60%', cash: '20–30%', gold: '10–20%', crypto: '0–10%',  strategy: 'Bắt đầu mua (scale-in)' },
    recovery:     { equity: '60–80%', cash: '10–20%', gold: '5–10%',  crypto: '5–15%',  strategy: 'Add position, tăng risk' },
  };
  const allocation = resolved.current_phase ? (allocationMap[resolved.current_phase] || allocationMap.sideway) : null;

  // 5. Assemble payload.
  //    All data (phase, charts, rates) comes entirely from AI.
  //    provider_analysis stores the separate per-provider outputs for deeper inspection.
  step('📦', 'Assembling monthly payload…');

  const providerAnalysis = {
    openai: openaiData ? {
      current_phase:         openaiData.current_phase,
      next_phase_prediction: openaiData.next_phase_prediction,
      phase_confidence:      openaiData.phase_confidence,
      phase_reason:          openaiData.phase_reason,
      next_phase_reason:     openaiData.next_phase_reason || '',
    } : null,
    gemini: geminiData ? {
      current_phase:         geminiData.current_phase,
      next_phase_prediction: geminiData.next_phase_prediction,
      phase_confidence:      geminiData.phase_confidence,
      phase_reason:          geminiData.phase_reason,
      next_phase_reason:     geminiData.next_phase_reason || '',
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
    market_commentary:     marketCommentary,
    asset_allocation:      allocation || {},
    vn_index:              vnIndex,
    breadth:               breadth,
    panic_scores:          panicScores,
    interest_rates:        interestRates,
  };

  ok(`Payload size: ${JSON.stringify(payload).length} bytes`);
  ok(`VN Index rows: ${vnIndex.length}  Breadth rows: ${breadth.length}  Panic rows: ${panicScores.length}`);
  if (resolved.current_phase) {
    ok(`Phase: ${payload.current_phase} → next: ${payload.next_phase_prediction} (${payload.phase_confidence}%)`);
  } else {
    warn('Phase: AI could not determine – payload phase fields are null (will show N/A in UI)');
  }

  // 6. Write to the current month's GitHub Issue
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
  ok(`Month: ${yearMonth}  Phase: ${payload.current_phase ?? 'N/A'}  Confidence: ${payload.phase_confidence ?? 'N/A'}%`);
  ok(`Next phase: ${payload.next_phase_prediction ?? 'N/A'}`);
  if (openaiData) ok(`OpenAI phase: ${openaiData.current_phase ?? 'N/A'}  (${openaiData.phase_confidence ?? 'N/A'}%)`);
  if (geminiData) ok(`Gemini phase: ${geminiData.current_phase ?? 'N/A'}  (${geminiData.phase_confidence ?? 'N/A'}%)`);
})().catch(err => {
  fail(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
