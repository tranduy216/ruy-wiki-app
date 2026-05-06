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
//  Unified prompt – used identically for BOTH OpenAI (web_search_preview)
//  and Gemini (googleSearch grounding) so results are directly comparable.
//  Kept intentionally short to reduce thinking-token overhead.
// ──────────────────────────────────────────────────────────────
const FULL_ANALYSIS_PROMPT = `Chuyên gia phân tích VNINDEX. Tìm dữ liệu thực tế từ HOSE/HNX, vietstock.vn, cafef.vn, SBV.

Đánh giá pha dựa trên MA10/MA20/MA50, volume 2 tuần vs 2 tháng, breadth adv/dec, lãi suất SBV/liên ngân hàng, P/E yield vs lãi suất phi rủi ro.
Pha: sideway|uptrend|distribution|downtrend|panic|recovery
Panic score(1-10): index≤-4%→+3,≤-3%→+2,≤-2%→+1; vol>2×avg→+2,>1.5×→+1; dec/adv>4→+3,>3→+2,>2→+1; label: panic≥7,high_stress≥5,normal<5

JSON only (không text khác). Nếu không có dữ liệu số để []. market_commentary bắt buộc, bằng tiếng Việt:
{"current_phase":"...","next_phase_prediction":"...","phase_confidence":0,"phase_reason":"...","next_phase_reason":"...","market_commentary":{"vn_index_trend":"...","breadth_trend":"...","market_state":"...","interest_rate_trend":"..."},"liquidity_summary":{"avg_volume_2w":0,"avg_volume_2m":0,"volume_ratio":0,"trend":"stable"},"vn_index":[{"date":"YYYY-MM-DD","open":0,"close":0,"volume":0,"ma10":null,"ma50":null}],"breadth":[{"date":"YYYY-MM-DD","adv_pct":0,"dec_pct":0,"unch_pct":0}],"panic_scores":[{"date":"YYYY-MM-DD","panic_score":0,"label":"normal","reason":[]}],"interest_rates":[{"date":"YYYY-MM-01","deposit_rate":null,"interbank_rate":null}]}`;

// ──────────────────────────────────────────────────────────────
//  Fetch ALL data from AI
//  Both OpenAI (web_search_preview) and Gemini (googleSearch) use the
//  SAME unified prompt so their assessments are directly comparable.
//  Numeric data (charts, rates) can fall back Gemini→OpenAI, but
//  market commentary and phase assessments are collected from BOTH.
// ──────────────────────────────────────────────────────────────
async function fetchAllFromAI(yearMonth) {
  step('🤖', 'Fetching VN Index data from AI (OpenAI + Gemini, same prompt)…');
  const today = new Date().toISOString().split('T')[0];

  let openaiResult = null;
  let geminiResult = null;

  const userContent = `Hôm nay: ${today}. Tháng: ${yearMonth}. Cung cấp phân tích đầy đủ VN Index cho tháng này.`;

  // OpenAI – same comprehensive prompt with web_search_preview tool
  if (OPENAI_KEY) {
    try {
      const raw = await callOpenAI(FULL_ANALYSIS_PROMPT, userContent, 10000, true);
      openaiResult = extractJSON(raw);
      if (openaiResult) ok('OpenAI full analysis fetch succeeded');
      else              warn('OpenAI returned non-JSON response');
    } catch (e) {
      warn(`OpenAI error: ${e.message}`);
    }
  }

  // Gemini – same comprehensive prompt with googleSearch grounding
  if (GEMINI_KEY) {
    try {
      await sleep(1000);
      const raw    = await callGemini(`${FULL_ANALYSIS_PROMPT}\n\n${userContent}`, 24000);
      geminiResult = extractJSON(raw);
      if (geminiResult) ok('Gemini full analysis fetch succeeded');
      else              warn('Gemini returned non-JSON response');
    } catch (e) {
      warn(`Gemini error: ${e.message}`);
    }
  }

  if (!openaiResult && !geminiResult) {
    warn('AI data fetch failed for both providers – all fields will be null/empty (shown as N/A in UI)');
  }

  // Resolved: prefer Gemini (live data via googleSearch), fall back to OpenAI, then defaults.
  const resolved = geminiResult || openaiResult || {
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
    liquidity_summary:     null,
  };

  return { openai: openaiResult, gemini: geminiResult, resolved };
}

// ──────────────────────────────────────────────────────────────
//  OpenAI call  (Responses API – gpt-5.4-mini, optional web search)
// ──────────────────────────────────────────────────────────────
// useWebSearch=false removes the web_search_preview tool, which adds ~8 000 tokens of
// overhead to the input and triggers the 10 000 TPM limit on restricted plans.
async function callOpenAI(systemPrompt, userContent, maxTokens = 16000, useWebSearch = true) {
  if (!OPENAI_KEY) return null;
  info('Calling OpenAI API (gpt-5.4-mini)…');
  const prompt = `${systemPrompt}\n\n${userContent}`;
  const body = {
    model:             'gpt-5.4-mini',
    temperature:       0,
    max_output_tokens: maxTokens,
    input:             prompt,
    store:             true,
  };
  if (useWebSearch) body.tools = [{ type: 'web_search_preview' }];
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify(body),
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
        // thinkingBudget caps reasoning tokens so the model always has
        // room for actual output. Budget=0 is incompatible with googleSearch
        // (model needs reasoning to process search results), so we use a
        // fixed cap instead of disabling thinking entirely.
        thinkingConfig: { thinkingBudget: 8000 },
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

  // 2. Chart data: prefer Gemini (live data) → OpenAI → empty []
  const vnIndex    = (Array.isArray(geminiData?.vn_index)    ? geminiData.vn_index    : null)
                  || (Array.isArray(openaiData?.vn_index)    ? openaiData.vn_index    : null)
                  || [];
  const breadth    = (Array.isArray(geminiData?.breadth)     ? geminiData.breadth     : null)
                  || (Array.isArray(openaiData?.breadth)     ? openaiData.breadth     : null)
                  || [];
  const panicScores = (Array.isArray(geminiData?.panic_scores) ? geminiData.panic_scores : null)
                   || (Array.isArray(openaiData?.panic_scores) ? openaiData.panic_scores : null)
                   || [];

  // 3. Interest rates: prefer Gemini → OpenAI → date scaffold with nulls
  const interestRates = (Array.isArray(geminiData?.interest_rates) && geminiData.interest_rates.length ? geminiData.interest_rates : null)
                     || (Array.isArray(openaiData?.interest_rates) && openaiData.interest_rates.length ? openaiData.interest_rates : null)
                     || buildRateDateScaffold(6).map(date => ({ date, deposit_rate: null, interbank_rate: null }));

  // 4. Liquidity summary: from Gemini (OpenAI phase-only call does not return this)
  const liquiditySummary = geminiData?.liquidity_summary || openaiData?.liquidity_summary || null;

  // 5. Market commentary: prefer Gemini (live data) → OpenAI
  const marketCommentary = geminiData?.market_commentary || openaiData?.market_commentary || null;

  // 6. Asset allocation mapping
  const allocationMap = {
    sideway:      { equity: '30–40%', cash: '40–50%', gold: '10–20%', crypto: '0–10%',  strategy: 'Giữ tiền, chờ break' },
    uptrend:      { equity: '60–70%', cash: '20–30%', gold: '5–10%',  crypto: '5–15%',  strategy: 'Ride trend, giữ winner' },
    distribution: { equity: '40–50%', cash: '30–40%', gold: '10–20%', crypto: '0–10%',  strategy: 'Giảm dần, không mua mới' },
    downtrend:    { equity: '20–30%', cash: '50–60%', gold: '10–20%', crypto: '0–5%',   strategy: 'Phòng thủ, tránh bắt đáy' },
    panic:        { equity: '40–60%', cash: '20–30%', gold: '10–20%', crypto: '0–10%',  strategy: 'Bắt đầu mua (scale-in)' },
    recovery:     { equity: '60–80%', cash: '10–20%', gold: '5–10%',  crypto: '5–15%',  strategy: 'Add position, tăng risk' },
  };
  const allocation = resolved.current_phase ? (allocationMap[resolved.current_phase] || allocationMap.sideway) : null;

  // 7. Assemble payload.
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
      market_commentary:     openaiData.market_commentary || null,
    } : null,
    gemini: geminiData ? {
      current_phase:         geminiData.current_phase,
      next_phase_prediction: geminiData.next_phase_prediction,
      phase_confidence:      geminiData.phase_confidence,
      phase_reason:          geminiData.phase_reason,
      next_phase_reason:     geminiData.next_phase_reason || '',
      market_commentary:     geminiData.market_commentary || null,
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
    liquidity_summary:     liquiditySummary,
    asset_allocation:      allocation || {},
    vn_index:              vnIndex,
    breadth:               breadth,
    panic_scores:          panicScores,
    interest_rates:        interestRates,
  };

  ok(`Payload size: ${JSON.stringify(payload).length} bytes`);
  ok(`VN Index rows: ${vnIndex.length}  Breadth rows: ${breadth.length}  Panic rows: ${panicScores.length}`);
  if (liquiditySummary) {
    ok(`Liquidity: 2w avg=${(liquiditySummary.avg_volume_2w / 1e9).toFixed(1)}B  2m avg=${(liquiditySummary.avg_volume_2m / 1e9).toFixed(1)}B  ratio=${liquiditySummary.volume_ratio}  trend=${liquiditySummary.trend}`);
  }
  if (resolved.current_phase) {
    ok(`Phase: ${payload.current_phase} → next: ${payload.next_phase_prediction} (${payload.phase_confidence}%)`);
  } else {
    warn('Phase: AI could not determine – payload phase fields are null (will show N/A in UI)');
  }

  // 8. Write to the current month's GitHub Issue
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
