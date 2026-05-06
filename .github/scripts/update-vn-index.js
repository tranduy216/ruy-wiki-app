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

Based on your knowledge of recent VN market conditions and macroeconomic context, provide a complete analysis package for the requested month.

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

If you cannot provide a specific field with sufficient confidence, set it to null (for scalars) or [] (for arrays).

OUTPUT: Strict JSON only, no explanation outside JSON.

{
  "current_phase": "downtrend",
  "next_phase_prediction": "recovery",
  "phase_confidence": 65,
  "phase_reason": "...",
  "next_phase_reason": "...",
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
- interest_rates: exactly 6 monthly data points, oldest first`;

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
      const raw = await callOpenAI(AI_SYSTEM_PROMPT, userContent, 4000);
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
      const raw    = await callGemini(prompt, 4000);
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

  // 4. Asset allocation mapping
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
