// ================================================================
//  pivot-score.js – Điểm đảo chiều (Pivot Score) page
//  Globals from index.html: ghFetch, GITHUB_OWNER, GITHUB_REPO,
//  showLoading, showError, esc
// ================================================================
(function () {
  'use strict';

  const PIVOT_DATA_LABEL    = 'pivot-score-data';
  const PIVOT_WORKFLOW_FILE = 'update-pivot-score.yml';

  // ── Criteria definition ─────────────────────────────────────
  const CRITERIA_DEF = [
    {
      group: 'Bond Market', groupKey: 'bond', weight: 0.25, emoji: '��',
      note: '👉 Leading indicator số 1',
      items: [
        { key: '2y_yield_trend', name: '2Y Yield Trend',
          levels: [
            { score: 0,   label: '↑ mạnh' },
            { score: 2.5, label: '↑ nhẹ' },
            { score: 5,   label: 'Sideway' },
            { score: 7.5, label: '↓ nhẹ' },
            { score: 10,  label: '↓ mạnh' }
          ]
        },
        { key: '2y_vs_ffr', name: '2Y vs FFR',
          levels: [
            { score: 0,   label: '2Y > FFR' },
            { score: 2.5, label: '2Y > FFR' },
            { score: 5,   label: '≈' },
            { score: 7.5, label: '2Y < FFR' },
            { score: 10,  label: '2Y << FFR' }
          ]
        }
      ]
    },
    {
      group: 'Yield Curve', groupKey: 'curve', weight: 0.15, emoji: '📉',
      items: [
        { key: '10y_2y', name: '10Y–2Y',
          levels: [
            { score: 0,   label: 'Flatten (2Y ↑)' },
            { score: 2.5, label: 'Flatten nhẹ' },
            { score: 5,   label: 'Flat' },
            { score: 7.5, label: 'Steepen nhẹ' },
            { score: 10,  label: 'Steepen mạnh' }
          ]
        }
      ]
    },
    {
      group: 'Labor Market', groupKey: 'labor', weight: 0.20, emoji: '👷',
      note: '👉 Trigger khiến Fed buộc phải hành động',
      items: [
        { key: 'unemployment', name: 'Unemployment',
          levels: [
            { score: 0,   label: '↓' },
            { score: 2.5, label: 'Stable' },
            { score: 5,   label: '↑ nhẹ' },
            { score: 7.5, label: '↑ rõ' },
            { score: 10,  label: 'Spike' }
          ]
        },
        { key: 'jobless_claims', name: 'Jobless Claims',
          levels: [
            { score: 0,   label: '↓' },
            { score: 2.5, label: 'Flat' },
            { score: 5,   label: '↑ nhẹ' },
            { score: 7.5, label: '↑ rõ' },
            { score: 10,  label: 'Spike' }
          ]
        }
      ]
    },
    {
      group: 'Inflation', groupKey: 'inflation', weight: 0.15, emoji: '🔥',
      items: [
        { key: 'core_cpi', name: 'Core CPI',
          levels: [
            { score: 0,   label: '↑' },
            { score: 2.5, label: 'Flat' },
            { score: 5,   label: '↓ nhẹ' },
            { score: 7.5, label: '↓ rõ' },
            { score: 10,  label: '↓ mạnh' }
          ]
        },
        { key: 'pce', name: 'PCE',
          levels: [
            { score: 0,   label: '↑' },
            { score: 2.5, label: 'Flat' },
            { score: 5,   label: '↓ nhẹ' },
            { score: 7.5, label: '↓ rõ' },
            { score: 10,  label: '↓ mạnh' }
          ]
        }
      ]
    },
    {
      group: 'Fed Communication', groupKey: 'fed', weight: 0.10, emoji: '🎙️',
      note: '👉 Soft signal nhưng cực quan trọng',
      items: [
        { key: 'fed_tone', name: 'Fed Tone (Jerome Powell)',
          levels: [
            { score: 0,   label: 'Hawkish mạnh' },
            { score: 2.5, label: 'Hawkish nhẹ' },
            { score: 5,   label: 'Neutral' },
            { score: 7.5, label: 'Dovish nhẹ' },
            { score: 10,  label: 'Dovish rõ' }
          ]
        }
      ]
    },
    {
      group: 'Credit Stress', groupKey: 'credit', weight: 0.10, emoji: '💳',
      items: [
        { key: 'credit_spread', name: 'Credit Spread',
          levels: [
            { score: 0,   label: '↓' },
            { score: 2.5, label: 'Stable' },
            { score: 5,   label: '↑ nhẹ' },
            { score: 7.5, label: '↑ rõ' },
            { score: 10,  label: 'Stress' }
          ]
        }
      ]
    },
    {
      group: 'Market Behavior', groupKey: 'market', weight: 0.05, emoji: '📊',
      items: [
        { key: 'market_behavior', name: 'Market Behavior',
          levels: [
            { score: 0,   label: 'Xấu → giảm mạnh' },
            { score: 2.5, label: 'Giảm nhẹ' },
            { score: 5,   label: 'Mixed' },
            { score: 7.5, label: 'Không giảm' },
            { score: 10,  label: 'Tăng' }
          ]
        }
      ]
    }
  ];

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
      const avg = keys.reduce((s, k) => s + (scores[k]?.score || 0), 0) / keys.length;
      total += WEIGHTS[group] * avg;
    }
    return Math.round(total * 10 * 10) / 10;
  }

  function getAction(total) {
    if (total > 80)  return { label: 'Aggressive 🚀',   cls: 'ps-aggressive' };
    if (total >= 60) return { label: 'Tăng risk ⚡',     cls: 'ps-risk' };
    if (total >= 40) return { label: 'Build vị thế 🏗️', cls: 'ps-build' };
    return { label: 'Phòng thủ 🛡️', cls: 'ps-defend' };
  }

  function parseIssueBody(body) {
    const m = (body || '').match(/<!--\s*PIVOT_DATA_START\s*([\s\S]*?)\s*PIVOT_DATA_END\s*-->/);
    if (!m) return [];
    try { return JSON.parse(m[1]); } catch { return []; }
  }

  // ── Detect entry format ──────────────────────────────────────
  function isNewFormat(entry) {
    return !!(entry && (entry.gpt_scores || entry.gemini_scores));
  }

  // ── CSS ──────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ps-styles')) return;
    const s = document.createElement('style');
    s.id = 'ps-styles';
    s.textContent = [
      '.ps-sections{display:grid;gap:1.5rem}',
      '.ps-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.5rem;box-shadow:var(--shadow)}',
      '.ps-card>h2{font-size:1.12rem;font-weight:700;color:var(--text);margin:0 0 1.1rem;padding-bottom:.6rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:.45rem}',
      '.ps-sub-title{font-size:.9rem;font-weight:600;color:var(--muted);margin:0 0 .7rem}',
      '.ps-formula-wrap{margin-top:1.4rem}',
      '.ps-report-row{display:flex;align-items:flex-start;gap:1.5rem;flex-wrap:wrap;margin-bottom:.5rem}',
      '.ps-score-big{font-size:3.2rem;font-weight:900;color:var(--blue);line-height:1;display:flex;align-items:baseline;gap:.2rem}',
      '.ps-score-big small{font-size:1.15rem;font-weight:400;color:var(--muted)}',
      '.ps-action-badge{display:inline-flex;align-items:center;gap:.35rem;padding:.45rem 1.1rem;border-radius:50px;font-size:.98rem;font-weight:700;letter-spacing:.02em;white-space:nowrap}',
      '.ps-defend{background:rgba(34,197,94,.12);color:var(--green);border:2px solid var(--green)}',
      '.ps-build{background:rgba(59,130,246,.12);color:var(--blue2);border:2px solid var(--blue)}',
      '.ps-risk{background:rgba(234,179,8,.12);color:#a16207;border:2px solid #ca8a04}',
      '.ps-aggressive{background:rgba(239,68,68,.12);color:var(--red);border:2px solid var(--red)}',
      'html[data-theme="dark"] .ps-defend{color:#4ade80;border-color:#4ade80}',
      'html[data-theme="dark"] .ps-build{color:#60a5fa;border-color:#60a5fa}',
      'html[data-theme="dark"] .ps-risk{color:#facc15;border-color:#facc15}',
      'html[data-theme="dark"] .ps-aggressive{color:#f87171;border-color:#f87171}',
      '.ps-bar-wrap{flex:1;min-width:180px;padding-top:.2rem}',
      '.ps-bar-label{font-size:.8rem;color:var(--muted);margin-bottom:.35rem}',
      '.ps-bar-bg{background:var(--surface2);border-radius:99px;height:11px;border:1px solid var(--border);overflow:hidden}',
      '.ps-bar-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--blue) 0%,#60a5fa 100%);transition:width .6s ease}',
      '.ps-table{width:100%;border-collapse:collapse;font-size:.87rem;margin-top:.4rem}',
      '.ps-table th{background:var(--surface2);border:1px solid var(--border);padding:.48rem .8rem;font-weight:600;color:var(--text);text-align:left}',
      '.ps-table td{border:1px solid var(--border);padding:.48rem .8rem;color:var(--text);vertical-align:top}',
      '.ps-table tr:hover td{background:rgba(59,130,246,.04)}',
      '.ps-trend{text-align:center;font-size:.9rem;white-space:nowrap}',
      '.ps-matrix-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:.5rem}',
      '.ps-matrix-table{min-width:700px}',
      '.ps-matrix-cur td{background:rgba(59,130,246,.07)!important}',
      '.ps-group-row td{background:var(--surface2);font-weight:700;color:var(--blue2);font-size:.88rem}',
      '.ps-sc{text-align:center;font-weight:700;font-size:.93rem;white-space:nowrap}',
      '.ps-sc-full{color:var(--green)} .ps-sc-half{color:#f59e0b} .ps-sc-zero{color:var(--muted)}',
      '.ps-val{color:var(--muted);font-size:.81rem}',
      '.ps-levels{display:flex;flex-direction:column;gap:.1rem}',
      '.ps-level{display:flex;align-items:flex-start;gap:.35rem;font-size:.81rem;line-height:1.45}',
      '.ps-level-pts{color:var(--blue2);flex-shrink:0;font-weight:600;min-width:2.4rem}',
      '.ps-level.active{font-weight:700;color:var(--blue2)}',
      '.ps-no-data{text-align:center;padding:2.5rem 1rem;color:var(--muted);font-size:.93rem}',
      '.ps-no-data-icon{font-size:2.2rem;display:block;margin-bottom:.6rem}',
      '.ps-hist-hdr{padding:.85rem 1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;transition:background .15s;user-select:none}',
      '.ps-hist-hdr:hover{background:rgba(59,130,246,.06)}',
      '.ps-hist-meta{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}',
      '.ps-hist-date{font-weight:700;color:var(--text);font-size:.93rem}',
      '.ps-hist-score{font-size:1.05rem;font-weight:800;color:var(--blue)}',
      '.ps-hist-chev{color:var(--muted);transition:transform .22s;font-size:.75rem}',
      '.ps-hist-body{display:none;padding:0 1.1rem 1.1rem}',
      '.ps-hist-entry.open .ps-hist-body{display:block}',
      '.ps-hist-entry.open .ps-hist-chev{transform:rotate(180deg)}',
      /* AI score cards */
      '.ps-ai-scores{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem}',
      '.ps-ai-score-card{background:var(--surface2);border-radius:8px;padding:1rem;border:1px solid var(--border)}',
      /* Formula modal */
      '.ps-formula-modal{display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.5);overflow-y:auto;padding:1.5rem}',
      '.ps-formula-modal.open{display:flex;align-items:flex-start;justify-content:center}',
      '.ps-formula-modal-inner{background:var(--surface);border-radius:12px;padding:1.5rem;max-width:900px;width:100%;position:relative}',
      '.ps-close-btn{position:absolute;top:.7rem;right:.9rem;font-size:1.3rem;cursor:pointer;background:none;border:none;color:var(--muted)}',
      '.ps-close-btn:hover{color:var(--text)}',
      /* Charts */
      '.ps-chart-wrap{margin:1rem 0;height:220px;position:relative}',
      '.ps-charts-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem}',
      '.ps-chart-full{grid-column:1/-1}',
      /* Responsive */
      '@media(max-width:640px){.ps-ai-scores{grid-template-columns:1fr}.ps-charts-grid{grid-template-columns:1fr}.ps-chart-full{grid-column:unset}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── AI score card renderer ───────────────────────────────────
  function renderAIScoreCard(name, scores, total, color) {
    var rows = '';
    CRITERIA_DEF.forEach(function(group) {
      group.items.forEach(function(item) {
        const d   = scores[item.key];
        const sc  = d != null ? d.score : null;
        const pct = sc != null ? (sc / 10 * 100) : 0;
        const reasoning = d && d.reasoning ? d.reasoning : '';
        rows += '<div style="margin-bottom:.45rem;">'
          + '<div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.12rem;">'
          + '<span>' + esc(item.name) + '</span>'
          + '<span style="font-weight:700;color:' + color + ';">' + (sc != null ? sc : '–') + '</span>'
          + '</div>'
          + '<div class="ps-bar-bg" style="height:6px;">'
          + '<div style="height:100%;border-radius:99px;background:' + color + ';width:' + pct + '%;transition:width .6s ease;"></div>'
          + '</div>'
          + (reasoning ? '<div style="font-size:.71rem;color:var(--muted);margin-top:.1rem;line-height:1.35;">' + esc(reasoning) + '</div>' : '')
          + '</div>';
      });
    });
    return '<div class="ps-ai-score-card">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.7rem;">'
      + '<strong style="font-size:.93rem;">' + esc(name) + '</strong>'
      + '<span style="font-size:1.4rem;font-weight:900;color:' + color + ';">' + (total != null ? total : '–') + '</span>'
      + '</div>'
      + rows
      + '</div>';
  }

  // ── Formula modal builder ────────────────────────────────────
  function buildFormulaModal(gptScores, geminiScores, newFmt) {
    var modalRows = '';
    CRITERIA_DEF.forEach(function(group) {
      modalRows += '<tr class="ps-group-row"><td colspan="5">'
        + group.emoji + ' ' + esc(group.group)
        + ' <span style="font-weight:400;color:var(--muted);font-size:.79rem;">(weight: ' + (group.weight * 100) + '%)</span>'
        + (group.note ? '<br><span style="font-size:.78rem;font-weight:400;color:var(--muted);">' + esc(group.note) + '</span>' : '')
        + '</td></tr>';
      group.items.forEach(function(item) {
        const gd  = gptScores[item.key];
        const md  = geminiScores[item.key];
        const gsc = gd != null ? gd.score : null;
        const msc = md != null ? md.score : null;
        const levHtml = item.levels.map(function(lv) {
          const gActive = newFmt && gsc === lv.score;
          const mActive = newFmt && msc === lv.score;
          const anyActive = gActive || mActive;
          var tags = '';
          if (gActive) tags += ' <span style="font-size:.7rem;background:#3b82f6;color:#fff;border-radius:3px;padding:0 3px;">GPT</span>';
          if (mActive) tags += ' <span style="font-size:.7rem;background:#ef4444;color:#fff;border-radius:3px;padding:0 3px;">Gem</span>';
          return '<div class="ps-level' + (anyActive ? ' active' : '') + '">'
            + '<span class="ps-level-pts">' + lv.score + '</span>'
            + '<span>' + esc(lv.label) + tags + '</span></div>';
        }).join('');
        const gTxt = gsc != null ? '<span style="color:#3b82f6;font-weight:700;">' + gsc + '</span>' : '–';
        const mTxt = msc != null ? '<span style="color:#ef4444;font-weight:700;">' + msc + '</span>' : '–';
        modalRows += '<tr>'
          + '<td>' + esc(item.name) + '</td>'
          + '<td class="ps-sc">' + gTxt + '</td>'
          + '<td class="ps-sc">' + mTxt + '</td>'
          + '<td><div class="ps-levels">' + levHtml + '</div></td>'
          + '</tr>';
      });
    });
    return '<div class="ps-formula-modal" id="ps-formula-modal" onclick="if(event.target===this)this.classList.remove(\'open\')">'
      + '<div class="ps-formula-modal-inner">'
      + '<button class="ps-close-btn" onclick="document.getElementById(\'ps-formula-modal\').classList.remove(\'open\')" title="Đóng">✕</button>'
      + '<h3 style="margin:0 0 1rem;font-size:1.05rem;">📐 Công thức tính điểm</h3>'
      + '<div style="overflow-x:auto;">'
      + '<table class="ps-table" style="min-width:540px;"><thead><tr>'
      + '<th>Tiêu chí</th>'
      + '<th style="text-align:center;color:#3b82f6;">GPT</th>'
      + '<th style="text-align:center;color:#ef4444;">Gemini</th>'
      + '<th>Thang điểm (0 – 10)</th>'
      + '</tr></thead><tbody>' + modalRows + '</tbody></table>'
      + '</div>'
      + '<p style="font-size:.78rem;color:var(--muted);margin:.9rem 0 0;">'
      + 'Công thức: Σ (avg_nhóm × weight) × 10 → 0–100 điểm. GPT + Gemini lấy trung bình.'
      + '</p>'
      + '</div></div>';
  }

  // ── Section 1 renderer ──────────────────────────────────────
  function renderSection1(entry) {
    const hasData   = !!entry;
    const newFmt    = hasData && isNewFormat(entry);
    const gptScores    = newFmt ? (entry.gpt_scores    || {}) : (hasData ? (entry.scores || {}) : {});
    const geminiScores = newFmt ? (entry.gemini_scores || {}) : (hasData ? (entry.scores || {}) : {});
    const gptTotal    = newFmt ? entry.gpt_total    : (hasData ? entry.total : null);
    const geminiTotal = newFmt ? entry.gemini_total : (hasData ? entry.total : null);

    var reportHtml;
    if (hasData) {
      const pct    = Math.min(100, Math.round(entry.total));
      const action = getAction(entry.total);
      const aiCards = newFmt
        ? '<div class="ps-ai-scores">'
          + renderAIScoreCard('ChatGPT', gptScores, gptTotal, '#3b82f6')
          + renderAIScoreCard('Gemini',  geminiScores, geminiTotal, '#ef4444')
          + '</div>'
        : '';
      reportHtml = aiCards
        + '<div class="ps-report-row">'
        + '<div><div class="ps-bar-label">' + (newFmt ? 'Điểm trung bình (GPT + Gemini)' : 'This week score') + '</div>'
        + '<div class="ps-score-big">' + entry.total + ' <small>/ 100</small></div></div>'
        + '<div class="ps-bar-wrap"><div class="ps-bar-label">Tiến độ</div>'
        + '<div class="ps-bar-bg"><div class="ps-bar-fill" style="width:' + pct + '%"></div></div></div>'
        + '<div><div class="ps-bar-label">Action</div>'
        + '<span class="ps-action-badge ' + action.cls + '">' + action.label + '</span></div>'
        + '</div>';
    } else {
      reportHtml = '<div class="ps-no-data"><span class="ps-no-data-icon">📭</span>Chưa có dữ liệu. Nhấn <strong>Update data</strong> để lấy lần đầu.</div>';
    }

    const matrixData = [
      { range: '&lt; 40',  cls: 'ps-defend',     action: 'Phòng thủ',    cash: '40–60%', gold: '15–25%', bonds: '15–25% (ngắn hạn)', stocks: '5–10%',  bitcoin: '0–5%',   detail: 'Giữ tiền, tránh risk. Ưu tiên bảo toàn vốn.',         cur: hasData && entry.total < 40 },
      { range: '40–60',   cls: 'ps-build',      action: 'Build vị thế', cash: '25–40%', gold: '15–20%', bonds: '15–20%',             stocks: '15–25%', bitcoin: '5–10%',  detail: 'DCA dần vào market, chưa all-in.',                    cur: hasData && entry.total >= 40 && entry.total <= 60 },
      { range: '60–80',   cls: 'ps-risk',       action: 'Tăng risk',    cash: '10–25%', gold: '10–15%', bonds: '10–15%',             stocks: '30–45%', bitcoin: '10–20%', detail: 'Tăng tốc risk asset, bắt đầu front-run pivot.',       cur: hasData && entry.total > 60 && entry.total <= 80 },
      { range: '&gt; 80', cls: 'ps-aggressive', action: 'Aggressive',   cash: '5–10%',  gold: '5–10%',  bonds: '5–10%',              stocks: '40–55%', bitcoin: '20–35%', detail: 'Risk-on mạnh. BTC + growth stock là driver chính.',   cur: hasData && entry.total > 80 }
    ];
    const matrixRows = matrixData.map(function(r) {
      return '<tr' + (r.cur ? ' class="ps-matrix-cur"' : '') + '>'
        + '<td style="font-weight:700;text-align:center;white-space:nowrap;">' + r.range + '</td>'
        + '<td><span class="ps-action-badge ' + r.cls + '" style="font-size:.8rem;padding:.22rem .65rem;">' + r.action + (r.cur ? ' ←' : '') + '</span></td>'
        + '<td style="text-align:center;">' + r.cash + '</td>'
        + '<td style="text-align:center;">' + r.gold + '</td>'
        + '<td style="text-align:center;">' + r.bonds + '</td>'
        + '<td style="text-align:center;">' + r.stocks + '</td>'
        + '<td style="text-align:center;">' + r.bitcoin + '</td>'
        + '<td style="font-size:.8rem;color:var(--muted);">' + r.detail + '</td>'
        + '</tr>';
    }).join('');

    const formulaBtn = hasData
      ? '<button class="btn btn-outline btn-sm" onclick="document.getElementById(\'ps-formula-modal\').classList.add(\'open\')" style="margin-bottom:.6rem;">📐 Xem công thức</button>'
      : '';

    return '<div class="ps-card">'
      + '<h2>�� Hiện tại</h2>'
      + '<p class="ps-sub-title">1. Report</p>' + reportHtml
      + '<p class="ps-sub-title" style="margin-top:1.3rem;">2. Matrix action</p>'
      + '<div class="ps-matrix-wrap"><table class="ps-table ps-matrix-table"><thead><tr>'
      + '<th>Pivot score</th><th>Trạng thái</th><th>Cash</th><th>Gold</th><th>Bonds</th><th>Stocks</th><th>Bitcoin</th><th>Action detail</th>'
      + '</tr></thead><tbody>' + matrixRows + '</tbody></table></div>'
      + '<div class="ps-formula-wrap"><p class="ps-sub-title">3. Công thức</p>' + formulaBtn + '</div>'
      + '</div>'
      + buildFormulaModal(gptScores, geminiScores, newFmt);
  }

  // ── Chart.js loader ─────────────────────────────────────────
  var chartJsLoaded = false;
  var chartJsLoading = false;
  var chartJsCallbacks = [];

  function loadChartJs(cb) {
    if (chartJsLoaded) { cb(); return; }
    chartJsCallbacks.push(cb);
    if (chartJsLoading) return;
    chartJsLoading = true;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    script.onload = function() {
      chartJsLoaded = true;
      chartJsLoading = false;
      chartJsCallbacks.forEach(function(fn) { fn(); });
      chartJsCallbacks = [];
    };
    script.onerror = function() {
      chartJsLoading = false;
      chartJsCallbacks = [];
    };
    document.head.appendChild(script);
  }

  var _chartInstances = {};

  function destroyChart(id) {
    if (_chartInstances[id]) {
      _chartInstances[id].destroy();
      delete _chartInstances[id];
    }
  }

  function renderBondChart(canvasId, bondData) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || !bondData || !bondData.length) return;
    _chartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: bondData.map(function(d) { return d.date; }),
        datasets: [
          {
            label: '2Y Yield',
            data:  bondData.map(function(d) { return d.dgs2; }),
            borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.08)',
            tension: 0.3, pointRadius: 3
          },
          {
            label: '10Y Yield',
            data:  bondData.map(function(d) { return d.dgs10; }),
            borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.08)',
            tension: 0.3, pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
        scales: { y: { title: { display: true, text: '%', font: { size: 10 } } } }
      }
    });
  }

  function renderPivotScoreChart(canvasId, entries) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || !entries || !entries.length) return;
    const slice = entries.slice(0, 26).reverse();
    const gptData = slice.map(function(e) { return e.gpt_total != null ? e.gpt_total : e.total; });
    const gemData = slice.map(function(e) { return e.gemini_total != null ? e.gemini_total : e.total; });
    _chartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: slice.map(function(e) { return e.week; }),
        datasets: [
          {
            label: 'GPT Score',
            data:  gptData,
            borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.08)',
            tension: 0.3, pointRadius: 3
          },
          {
            label: 'Gemini Score',
            data:  gemData,
            borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.08)',
            tension: 0.3, pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
        scales: { y: { min: 0, max: 100, title: { display: true, text: 'Score', font: { size: 10 } } } }
      }
    });
  }

  function renderLaborChart(canvasId, laborData) {
    destroyChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || !laborData || !laborData.length) return;
    _chartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: laborData.map(function(d) { return d.date; }),
        datasets: [
          {
            label: 'Unemployment %',
            data:  laborData.map(function(d) { return d.unrate; }),
            borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.08)',
            tension: 0.3, pointRadius: 3,
            yAxisID: 'y'
          },
          {
            label: 'Jobless Claims (K)',
            data:  laborData.map(function(d) { return d.icsa != null ? Math.round(d.icsa / 1000) : null; }),
            borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.08)',
            tension: 0.3, pointRadius: 3,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
        scales: {
          y:  { title: { display: true, text: 'UNRATE %', font: { size: 10 } }, position: 'left' },
          y2: { title: { display: true, text: 'Claims K', font: { size: 10 } }, position: 'right', grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  function renderCharts(entries) {
    const latest = entries[0];
    const chartData = latest && latest.chart_data ? latest.chart_data : null;
    loadChartJs(function() {
      renderBondChart('ps-chart-bond', chartData ? chartData.bond_yields : null);
      renderPivotScoreChart('ps-chart-score', entries);
      renderLaborChart('ps-chart-labor', chartData ? chartData.labor : null);
    });
  }

  // ── Section 2 renderer ──────────────────────────────────────
  function renderSection2(entries) {
    if (!entries.length) {
      return '<div class="ps-card"><h2>📜 Lịch sử</h2><div class="ps-no-data"><span class="ps-no-data-icon">📭</span>Chưa có dữ liệu lịch sử.</div></div>';
    }

    const chartsHtml = '<div style="margin-bottom:1.2rem;">'
      + '<p class="ps-sub-title">📈 Biểu đồ 6 tháng</p>'
      + '<div class="ps-charts-grid">'
      + '<div><div style="font-size:.8rem;color:var(--muted);margin-bottom:.3rem;">Bond Yields (2Y &amp; 10Y)</div>'
      + '<div class="ps-chart-wrap"><canvas id="ps-chart-bond"></canvas></div></div>'
      + '<div><div style="font-size:.8rem;color:var(--muted);margin-bottom:.3rem;">Labor Market</div>'
      + '<div class="ps-chart-wrap"><canvas id="ps-chart-labor"></canvas></div></div>'
      + '<div class="ps-chart-full"><div style="font-size:.8rem;color:var(--muted);margin-bottom:.3rem;">Pivot Score Trend (GPT &amp; Gemini)</div>'
      + '<div class="ps-chart-wrap"><canvas id="ps-chart-score"></canvas></div></div>'
      + '</div></div>';

    const items = entries.map(function(entry, idx) {
      const action = getAction(entry.total);
      const newFmt = isNewFormat(entry);
      const gptScores    = newFmt ? (entry.gpt_scores    || {}) : (entry.scores || {});
      const geminiScores = newFmt ? (entry.gemini_scores || {}) : null;
      const d       = new Date(entry.week + 'T00:00:00');
      const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      var criteriaRows = '';
      CRITERIA_DEF.forEach(function(group) {
        group.items.forEach(function(item) {
          const gd = gptScores[item.key];
          const md = geminiScores ? geminiScores[item.key] : null;
          if (!gd && !md) return;
          const gsc = gd != null ? gd.score : null;
          const msc = md != null ? md.score : null;
          const scForClass = gsc != null ? gsc : msc;
          const scCls = scForClass == null ? '' : scForClass >= 7.5 ? 'ps-sc-full' : scForClass >= 2.5 ? 'ps-sc-half' : 'ps-sc-zero';
          const reasoning = (gd && gd.reasoning) ? esc(gd.reasoning) : (md && md.reasoning ? esc(md.reasoning) : '');
          criteriaRows += '<tr>'
            + '<td>' + esc(item.name) + '</td>'
            + '<td class="ps-sc ' + (gsc != null ? scCls : '') + '" style="color:#3b82f6;">' + (gsc != null ? gsc : '–') + '</td>'
            + (newFmt ? '<td class="ps-sc" style="color:#ef4444;">' + (msc != null ? msc : '–') + '</td>' : '')
            + '<td class="ps-val">' + reasoning + '</td>'
            + '</tr>';
        });
      });

      const scoreDisplay = newFmt
        ? '<span style="color:#3b82f6;" title="GPT">' + (entry.gpt_total != null ? entry.gpt_total : '–') + '</span>'
          + ' / <span style="color:#ef4444;" title="Gemini">' + (entry.gemini_total != null ? entry.gemini_total : '–') + '</span>'
          + ' <span class="ps-hist-score">→ ' + entry.total + '</span>'
        : '<span class="ps-hist-score">' + entry.total + '/100</span>';

      const thGpt   = newFmt ? '<th style="text-align:center;color:#3b82f6;width:7%;">GPT</th>' : '';
      const thGem   = newFmt ? '<th style="text-align:center;color:#ef4444;width:7%;">Gemini</th>' : '';
      const tfGpt   = newFmt ? (entry.gpt_total != null ? '<span style="color:#3b82f6;">' + entry.gpt_total + '</span> / ' : '') : '';
      const tfGem   = newFmt ? (entry.gemini_total != null ? '<span style="color:#ef4444;">' + entry.gemini_total + '</span> → ' : '') : '';

      return '<div class="ps-hist-entry' + (idx === 0 ? ' open' : '') + '" id="psh-' + idx + '">'
        + '<div class="ps-hist-hdr" onclick="document.getElementById(\'psh-' + idx + '\').classList.toggle(\'open\')">'
        + '<div class="ps-hist-meta">'
        + '<span class="ps-hist-date">📅 ' + esc(dateStr) + '</span>'
        + scoreDisplay
        + '<span class="ps-action-badge ' + action.cls + '" style="font-size:.78rem;padding:.2rem .6rem;">' + action.label + '</span>'
        + '</div><span class="ps-hist-chev">▼</span></div>'
        + '<div class="ps-hist-body">'
        + '<table class="ps-table"><thead><tr>'
        + '<th style="width:22%;">Tiêu chí</th>'
        + thGpt + thGem
        + '<th>Nhận xét AI</th>'
        + '</tr></thead><tbody>' + criteriaRows + '</tbody>'
        + '<tfoot><tr><td style="text-align:right;font-weight:700;border-top:2px solid var(--border);">Tổng</td>'
        + (newFmt ? '<td colspan="2" style="text-align:center;border-top:2px solid var(--border);font-size:.95rem;">' + tfGpt + tfGem + entry.total + '</td>' : '<td style="border-top:2px solid var(--border);"></td>')
        + '<td style="border-top:2px solid var(--border);"></td>'
        + '</tr></tfoot>'
        + '</table></div></div>';
    }).join('');

    return '<div class="ps-card"><h2>📜 Lịch sử</h2>' + chartsHtml + items + '</div>';
  }

  // ── Main render ─────────────────────────────────────────────
  function renderPivotScore(entries) {
    const latest    = entries[0] || null;
    const weekLabel = latest
      ? '<span style="font-size:.82rem;font-weight:400;color:var(--muted);margin-left:.3rem;">(Cập nhật: ' + latest.week + ')</span>'
      : '';

    document.getElementById('main-content').innerHTML =
      '<div class="page-header">'
      + '<h1><div class="page-icon">🔄</div>Điểm đảo chiều ' + weekLabel + '</h1>'
      + '<div class="header-actions">'
      + '<button class="btn btn-outline btn-sm" onclick="loadPivotScore()">🔄 Tải lại</button>'
      + '<button class="btn btn-primary btn-sm"'
      + ' onclick="window.open(\'https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/actions/workflows/' + PIVOT_WORKFLOW_FILE + '\', \'_blank\')"'
      + '>🔄 Update data</button>'
      + '</div></div>'
      + '<div class="ps-sections">'
      + renderSection1(latest)
      + renderSection2(entries)
      + '</div>';

    if (entries.length) {
      renderCharts(entries);
    }
  }

  // ── Entry point ─────────────────────────────────────────────
  window.loadPivotScore = async function() {
    injectStyles();
    showLoading('Đang tải dữ liệu Điểm đảo chiều…');
    try {
      const res = await ghFetch('/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/issues?labels=' + PIVOT_DATA_LABEL + '&state=open&per_page=1');
      if (!res.ok) throw new Error('GitHub API lỗi ' + res.status);
      const issues  = await res.json();
      const entries = issues.length ? parseIssueBody(issues[0].body || '') : [];
      renderPivotScore(entries);
    } catch (err) {
      showError(err.message, window.loadPivotScore);
    }
  };

})();
