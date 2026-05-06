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

Based on your knowledge of recent VN market conditions and macroeconomic context, determine the current market phase.

Phases: sideway | uptrend | distribution | downtrend | panic | recovery

Phase rules:
- sideway: Price ranging, MA20 ≈ MA50, balanced advance/decline, low volume
- uptrend: Higher highs, MA20 > MA50, adv > dec, breadth strong
- distribution: Index still up or flat, but breadth weakening (dec > adv despite index), volume declining
- downtrend: Lower highs, MA20 < MA50, persistent dec > adv
- panic: Sharp drop, volume spike (1.5-2x normal), dec/adv > 3-4, widespread limit-down
- recovery: Strong bounce after panic, breadth improving, dip-buying visible

Also predict the NEXT likely phase.

If you are unable to determine the current phase with sufficient confidence, set current_phase to null.

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

async function determinePhase() {
  step('🤖', 'Determining VN Index Phase via AI (OpenAI + Gemini independently)…');
  const today = new Date().toISOString().split('T')[0];
  const userContent = `Today's date: ${today}. Based on your knowledge of the Vietnamese stock market (VN Index) and recent macroeconomic conditions, determine the current market phase.`;

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

  // Resolved top-level values: prefer OpenAI, fall back to Gemini, then null defaults.
  const resolved = openaiResult || geminiResult || {
    current_phase:         null,
    next_phase_prediction: null,
    phase_confidence:      null,
    phase_reason:          null,
    next_phase_reason:     null,
    deposit_rates:         [],
    interbank_rates:       [],
  };

  if (!openaiResult && !geminiResult) {
    warn('AI phase determination failed for both providers – phase data will be null (shown as N/A in UI)');
  }

  // Return per-provider results alongside the resolved value.
  return { openai: openaiResult, gemini: geminiResult, resolved };
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

  // 1. AI: phase determination (both OpenAI and Gemini run independently)
  const phaseResult  = await determinePhase();
  const openaiPhase  = phaseResult.openai;
  const geminiPhase  = phaseResult.gemini;
  const resolved     = phaseResult.resolved;

  // 2. Build interest rate data.
  //    Priority: OpenAI rates → Gemini rates → empty (null values from buildInterestRates).
  const depositRates   = openaiPhase?.deposit_rates   || geminiPhase?.deposit_rates   || resolved.deposit_rates   || [];
  const interbankRates = openaiPhase?.interbank_rates  || geminiPhase?.interbank_rates  || resolved.interbank_rates  || [];
  const interestRates  = buildInterestRates(6).map((r, i) => ({
    date:           r.date,
    deposit_rate:   depositRates[i]?.rate   ?? null,
    interbank_rate: interbankRates[i]?.rate ?? null,
  }));

  // 3. Asset allocation mapping
  const allocationMap = {
    sideway:      { equity: '30–40%', cash: '40–50%', gold: '10–20%', crypto: '0–10%',  strategy: 'Giữ tiền, chờ break' },
    uptrend:      { equity: '60–70%', cash: '20–30%', gold: '5–10%',  crypto: '5–15%',  strategy: 'Ride trend, giữ winner' },
    distribution: { equity: '40–50%', cash: '30–40%', gold: '10–20%', crypto: '0–10%',  strategy: 'Giảm dần, không mua mới' },
    downtrend:    { equity: '20–30%', cash: '50–60%', gold: '10–20%', crypto: '0–5%',   strategy: 'Phòng thủ, tránh bắt đáy' },
    panic:        { equity: '40–60%', cash: '20–30%', gold: '10–20%', crypto: '0–10%',  strategy: 'Bắt đầu mua (scale-in)' },
    recovery:     { equity: '60–80%', cash: '10–20%', gold: '5–10%',  crypto: '5–15%',  strategy: 'Add position, tăng risk' },
  };
  const allocation = resolved.current_phase ? (allocationMap[resolved.current_phase] || allocationMap.sideway) : null;

  // 4. Assemble payload.
  //    vn_index, breadth, panic_scores are empty – TCBS API is no longer used.
  //    Top-level phase fields use the resolved (OpenAI-preferred) value for UI backward-compat.
  //    provider_analysis stores the separate per-provider outputs for deeper inspection.
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
    asset_allocation:      allocation || {},
    vn_index:              [],
    breadth:               [],
    panic_scores:          [],
    interest_rates:        interestRates,
  };

  ok(`Payload size: ${JSON.stringify(payload).length} bytes`);
  if (resolved.current_phase) {
    ok(`Phase: ${payload.current_phase} → next: ${payload.next_phase_prediction} (${payload.phase_confidence}%)`);
  } else {
    warn('Phase: AI could not determine – payload phase fields are null (will show N/A in UI)');
  }

  // 5. Write to the current month's GitHub Issue
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
  if (openaiPhase)  ok(`OpenAI phase:  ${openaiPhase.current_phase}  (${openaiPhase.phase_confidence}%)`);
  if (geminiPhase)  ok(`Gemini phase:  ${geminiPhase.current_phase}  (${geminiPhase.phase_confidence}%)`);
})().catch(err => {
  fail(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
