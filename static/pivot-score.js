// ================================================================
//  pivot-score.js – Điểm đảo chiều (Pivot Score) page
//  Relies on globals from index.html: ghFetch, GITHUB_OWNER,
//  GITHUB_REPO, showLoading, showError, esc
// ================================================================
(function () {
  'use strict';

  const PIVOT_DATA_LABEL = 'pivot-score-data';

  // ──────────────────────────────────────────────────────────────
  //  Criteria definition (100 points total)
  // ──────────────────────────────────────────────────────────────
  const CRITERIA_DEF = [
    {
      group: '1. Bond Market', groupMax: 25, emoji: '💵',
      note: '👉 Đây là leading indicator số 1',
      items: [
        {
          key: 'us2y',
          name: 'US 2Y Yield trend',
          max: 15,
          levels: [
            { score: 15, label: 'Giảm mạnh, liên tục (≥ 50–100bps trong vài tháng)' },
            { score: 8,  label: 'Giảm nhẹ' },
            { score: 0,  label: 'Sideway / tăng' }
          ]
        },
        {
          key: 'fed_futures',
          name: 'Fed Funds Futures',
          max: 10,
          levels: [
            { score: 10, label: 'Market pricing giảm lãi rõ (≥ 2 cuts)' },
            { score: 5,  label: 'Pricing nhẹ' },
            { score: 0,  label: 'Không pricing' }
          ]
        }
      ]
    },
    {
      group: '2. Yield Curve', groupMax: 15, emoji: '📉',
      items: [
        {
          key: 'yield_curve',
          name: '10Y–2Y chuyển từ inverted → steepening',
          max: 15,
          levels: [
            { score: 15, label: 'Steepening do short-term yield ↓' },
            { score: 5,  label: 'Steepening do long-term ↑' },
            { score: 0,  label: 'Vẫn inverted sâu' }
          ]
        }
      ]
    },
    {
      group: '3. Labor Market', groupMax: 20, emoji: '👷',
      note: '👉 Trigger khiến Federal Reserve buộc phải hành động',
      items: [
        {
          key: 'unemployment',
          name: 'Unemployment rate',
          max: 10,
          levels: [
            { score: 10, label: 'Tăng nhanh ≥ 0.4–0.5% trong 3–6 tháng' },
            { score: 5,  label: 'Tăng nhẹ' },
            { score: 0,  label: 'Ổn định' }
          ]
        },
        {
          key: 'jobless_claims',
          name: 'Jobless claims',
          max: 10,
          levels: [
            { score: 10, label: 'Tăng mạnh, liên tục' },
            { score: 5,  label: 'Tăng nhẹ' },
            { score: 0,  label: 'Flat' }
          ]
        }
      ]
    },
    {
      group: '4. Inflation', groupMax: 15, emoji: '🔥',
      items: [
        {
          key: 'core_cpi',
          name: 'Core CPI trend',
          max: 10,
          levels: [
            { score: 10, label: 'Giảm rõ ràng, liên tục' },
            { score: 5,  label: 'Giảm nhẹ' },
            { score: 0,  label: 'Flat / tăng' }
          ]
        },
        {
          key: 'pce',
          name: 'PCE (Fed thích cái này)',
          max: 5,
          levels: [
            { score: 5, label: 'Giảm' },
            { score: 0, label: 'Không giảm' }
          ]
        }
      ]
    },
    {
      group: '5. Fed Communication', groupMax: 10, emoji: '🎙️',
      note: '👉 Soft signal nhưng cực quan trọng',
      items: [
        {
          key: 'fed_communication',
          name: 'Phát biểu Jerome Powell',
          max: 10,
          levels: [
            { score: 10, label: '"Ready to adjust policy"' },
            { score: 5,  label: '"Risks balanced"' },
            { score: 0,  label: 'Vẫn hawkish' }
          ]
        }
      ]
    },
    {
      group: '6. Credit Stress', groupMax: 10, emoji: '💳',
      items: [
        {
          key: 'credit_spread',
          name: 'Credit spread',
          max: 10,
          levels: [
            { score: 10, label: 'Mở rộng mạnh' },
            { score: 5,  label: 'Mở rộng nhẹ' },
            { score: 0,  label: 'Bình thường' }
          ]
        }
      ]
    },
    {
      group: '7. Market Behavior', groupMax: 5, emoji: '📊',
      items: [
        {
          key: 'market_behavior',
          name: '"Tin xấu nhưng không giảm"',
          max: 5,
          levels: [
            { score: 5, label: 'Có' },
            { score: 0, label: 'Không' }
          ]
        }
      ]
    }
  ];

  // ──────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────
  function getAction(total) {
    if (total > 80)  return { label: 'Aggressive 🚀', cls: 'ps-aggressive' };
    if (total >= 60) return { label: 'Tăng risk ⚡',   cls: 'ps-risk' };
    if (total >= 40) return { label: 'Build vị thế 🏗️', cls: 'ps-build' };
    return { label: 'Phòng thủ 🛡️', cls: 'ps-defend' };
  }

  function parseIssueBody(body) {
    const match = (body || '').match(/<!--\s*PIVOT_DATA_START\s*([\s\S]*?)\s*PIVOT_DATA_END\s*-->/);
    if (!match) return [];
    try { return JSON.parse(match[1]); } catch { return []; }
  }

  // ──────────────────────────────────────────────────────────────
  //  CSS injection (once)
  // ──────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ps-styles')) return;
    const s = document.createElement('style');
    s.id = 'ps-styles';
    s.textContent = `
      .ps-sections { display: grid; gap: 1.5rem; }
      .ps-card {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 12px; padding: 1.5rem; box-shadow: var(--shadow);
      }
      .ps-card > h2 {
        font-size: 1.12rem; font-weight: 700; color: var(--text);
        margin: 0 0 1.1rem; padding-bottom: .6rem;
        border-bottom: 1px solid var(--border);
        display: flex; align-items: center; gap: .45rem;
      }
      .ps-sub-title {
        font-size: .9rem; font-weight: 600; color: var(--muted);
        margin: 0 0 .7rem;
      }
      .ps-sub-title + .ps-sub-title,
      .ps-formula-wrap { margin-top: 1.4rem; }
      .ps-report-row {
        display: flex; align-items: flex-start; gap: 1.5rem;
        flex-wrap: wrap; margin-bottom: .5rem;
      }
      .ps-score-big {
        font-size: 3.2rem; font-weight: 900; color: var(--blue);
        line-height: 1; display: flex; align-items: baseline; gap: .2rem;
      }
      .ps-score-big small { font-size: 1.15rem; font-weight: 400; color: var(--muted); }
      .ps-action-badge {
        display: inline-flex; align-items: center; gap: .35rem;
        padding: .45rem 1.1rem; border-radius: 50px;
        font-size: .98rem; font-weight: 700; letter-spacing: .02em;
        white-space: nowrap;
      }
      .ps-defend     { background: rgba(59,130,246,.12);  color: var(--blue2); border: 2px solid var(--blue); }
      .ps-build      { background: rgba(34,197,94,.12);   color: var(--green); border: 2px solid var(--green); }
      .ps-risk       { background: rgba(251,146,60,.12);  color: #c2410c;      border: 2px solid #c2410c; }
      .ps-aggressive { background: rgba(239,68,68,.12);   color: var(--red);   border: 2px solid var(--red); }
      html[data-theme="dark"] .ps-risk       { color: #fb923c; border-color: #fb923c; }
      html[data-theme="dark"] .ps-aggressive { color: #f87171; border-color: #f87171; }
      .ps-bar-wrap { flex: 1; min-width: 180px; padding-top: .2rem; }
      .ps-bar-label { font-size: .8rem; color: var(--muted); margin-bottom: .35rem; }
      .ps-bar-bg {
        background: var(--surface2); border-radius: 99px; height: 11px;
        border: 1px solid var(--border); overflow: hidden;
      }
      .ps-bar-fill {
        height: 100%; border-radius: 99px;
        background: linear-gradient(90deg, var(--blue) 0%, #60a5fa 100%);
        transition: width .6s ease;
      }
      .ps-table {
        width: 100%; border-collapse: collapse; font-size: .87rem;
        margin-top: .4rem;
      }
      .ps-table th {
        background: var(--surface2); border: 1px solid var(--border);
        padding: .48rem .8rem; font-weight: 600; color: var(--text); text-align: left;
      }
      .ps-table td {
        border: 1px solid var(--border); padding: .48rem .8rem;
        color: var(--text); vertical-align: top;
      }
      .ps-table tr:hover td { background: rgba(59,130,246,.04); }
      .ps-group-row td {
        background: var(--surface2); font-weight: 700;
        color: var(--blue2); font-size: .88rem;
      }
      .ps-sc { text-align: center; font-weight: 700; font-size: .93rem; white-space: nowrap; }
      .ps-sc-full { color: var(--green); }
      .ps-sc-half { color: #f59e0b; }
      .ps-sc-zero { color: var(--muted); }
      .ps-val { color: var(--muted); font-size: .81rem; }
      .ps-levels { display: flex; flex-direction: column; gap: .1rem; }
      .ps-level { display: flex; align-items: flex-start; gap: .35rem; font-size: .81rem; line-height: 1.45; }
      .ps-level-pts { color: var(--blue2); flex-shrink: 0; font-weight: 600; min-width: 2.4rem; }
      .ps-level.active { font-weight: 700; color: var(--blue2); }
      .ps-no-data { text-align: center; padding: 2.5rem 1rem; color: var(--muted); font-size: .93rem; }
      .ps-no-data-icon { font-size: 2.2rem; display: block; margin-bottom: .6rem; }
      .ps-hist-entry {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 10px; margin-bottom: .8rem; overflow: hidden;
      }
      .ps-hist-hdr {
        padding: .85rem 1.1rem; cursor: pointer;
        display: flex; align-items: center; justify-content: space-between;
        gap: .75rem; flex-wrap: wrap; transition: background .15s; user-select: none;
      }
      .ps-hist-hdr:hover { background: rgba(59,130,246,.06); }
      .ps-hist-meta { display: flex; align-items: center; gap: .7rem; flex-wrap: wrap; }
      .ps-hist-date { font-weight: 700; color: var(--text); font-size: .93rem; }
      .ps-hist-score { font-size: 1.05rem; font-weight: 800; color: var(--blue); }
      .ps-hist-chev { color: var(--muted); transition: transform .22s; font-size: .75rem; }
      .ps-hist-body { display: none; padding: 0 1.1rem 1.1rem; }
      .ps-hist-entry.open .ps-hist-body { display: block; }
      .ps-hist-entry.open .ps-hist-chev { transform: rotate(180deg); }
    `;
    document.head.appendChild(s);
  }

  // ──────────────────────────────────────────────────────────────
  //  Section 1: Hiện tại
  // ──────────────────────────────────────────────────────────────
  function renderSection1(entry) {
    const hasData = !!entry;
    const scores  = hasData ? (entry.scores || {}) : {};

    // — Report block —
    let reportHtml;
    if (hasData) {
      const pct    = Math.min(100, Math.round(entry.total));
      const action = getAction(entry.total);
      reportHtml = `
        <div class="ps-report-row">
          <div>
            <div class="ps-bar-label">This week score</div>
            <div class="ps-score-big">${entry.total} <small>/ 100</small></div>
          </div>
          <div class="ps-bar-wrap">
            <div class="ps-bar-label">Tiến độ</div>
            <div class="ps-bar-bg"><div class="ps-bar-fill" style="width:${pct}%"></div></div>
          </div>
          <div>
            <div class="ps-bar-label">Action</div>
            <span class="ps-action-badge ${action.cls}">${action.label}</span>
          </div>
        </div>`;
    } else {
      reportHtml = `<div class="ps-no-data"><span class="ps-no-data-icon">📭</span>Chưa có dữ liệu. Chạy GitHub Actions workflow để cập nhật lần đầu.</div>`;
    }

    // — Matrix table —
    const matrixRows = [
      { range: '&lt; 40',    cls: 'ps-defend',     action: 'Phòng thủ',     current: hasData && entry.total < 40 },
      { range: '40 – 60',   cls: 'ps-build',      action: 'Build vị thế',  current: hasData && entry.total >= 40 && entry.total <= 60 },
      { range: '60 – 80',   cls: 'ps-risk',       action: 'Tăng risk',     current: hasData && entry.total > 60 && entry.total <= 80 },
      { range: '&gt; 80',   cls: 'ps-aggressive', action: 'Aggressive',    current: hasData && entry.total > 80 }
    ].map(r => `
      <tr${r.current ? ' style="background:rgba(59,130,246,.07);"' : ''}>
        <td style="font-weight:700;text-align:center;">${r.range}</td>
        <td><span class="ps-action-badge ${r.cls}" style="font-size:.8rem;padding:.22rem .65rem;">${r.action}</span></td>
        <td style="text-align:center;color:var(--blue2);font-weight:700;">${r.current ? '← Hiện tại' : ''}</td>
      </tr>`).join('');

    const matrixHtml = `
      <table class="ps-table" style="max-width:420px;">
        <thead><tr><th>Pivot score</th><th>Hành động</th><th></th></tr></thead>
        <tbody>${matrixRows}</tbody>
      </table>`;

    // — Công thức table —
    let formulaRows = '';
    for (const group of CRITERIA_DEF) {
      const groupTotal = group.items.reduce((s, item) => {
        const d = scores[item.key];
        return s + (d ? (d.score || 0) : 0);
      }, 0);
      const groupTotalStr = hasData ? ` — đạt ${groupTotal}đ` : '';
      formulaRows += `
        <tr class="ps-group-row">
          <td colspan="4">${group.emoji} ${group.group}
            <span style="font-weight:400;color:var(--muted);font-size:.79rem;">(tối đa ${group.groupMax}đ${groupTotalStr})</span>
            ${group.note ? `<br><span style="font-size:.78rem;font-weight:400;color:var(--muted);">${group.note}</span>` : ''}
          </td>
        </tr>`;
      for (const item of group.items) {
        const d  = scores[item.key];
        const sc = d != null ? d.score : null;
        const scCls = sc == null ? '' : sc >= item.max ? 'ps-sc-full' : sc > 0 ? 'ps-sc-half' : 'ps-sc-zero';
        const scTxt = sc == null ? '–' : `${sc}/${item.max}`;
        const levelsHtml = item.levels.map(lv => {
          const active = d != null && d.score === lv.score;
          return `<div class="ps-level${active ? ' active' : ''}">
            <span class="ps-level-pts">${lv.score}đ</span>
            <span>${lv.label}${active ? ' ✓' : ''}</span>
          </div>`;
        }).join('');
        formulaRows += `
          <tr>
            <td>${item.name}</td>
            <td class="ps-val">${d && d.value ? esc(d.value) : '–'}</td>
            <td><div class="ps-levels">${levelsHtml}</div></td>
            <td class="ps-sc ${scCls}">${scTxt}</td>
          </tr>`;
      }
    }
    const tfoot = hasData
      ? `<tfoot><tr>
          <td colspan="3" style="text-align:right;font-weight:700;border-top:2px solid var(--border);">Tổng điểm</td>
          <td class="ps-sc" style="border-top:2px solid var(--border);font-size:1rem;">${entry.total}/100</td>
        </tr></tfoot>`
      : '';
    const formulaHtml = `
      <table class="ps-table">
        <thead>
          <tr>
            <th style="width:20%;">Tiêu chí</th>
            <th style="width:22%;">Giá trị thực tế</th>
            <th>Thang điểm</th>
            <th style="width:9%;text-align:center;">Điểm</th>
          </tr>
        </thead>
        <tbody>${formulaRows}</tbody>
        ${tfoot}
      </table>`;

    return `
      <div class="ps-card">
        <h2>📅 Hiện tại</h2>
        <p class="ps-sub-title">1. Report</p>
        ${reportHtml}
        <p class="ps-sub-title" style="margin-top:1.3rem;">2. Matrix action</p>
        ${matrixHtml}
        <div class="ps-formula-wrap">
          <p class="ps-sub-title">3. Công thức</p>
          ${formulaHtml}
        </div>
      </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  //  Section 2: Lịch sử
  // ──────────────────────────────────────────────────────────────
  function renderSection2(entries) {
    if (!entries.length) {
      return `
        <div class="ps-card">
          <h2>📜 Lịch sử</h2>
          <div class="ps-no-data"><span class="ps-no-data-icon">📭</span>Chưa có dữ liệu lịch sử.</div>
        </div>`;
    }

    const items = entries.map((entry, idx) => {
      const action = getAction(entry.total);
      const scores = entry.scores || {};

      // Format: "2026, May 4"
      const d = new Date(entry.week + 'T00:00:00');
      const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      let criteriaRows = '';
      for (const group of CRITERIA_DEF) {
        for (const item of group.items) {
          const sc = scores[item.key];
          if (!sc) continue;
          const scCls = sc.score >= item.max ? 'ps-sc-full' : sc.score > 0 ? 'ps-sc-half' : 'ps-sc-zero';
          criteriaRows += `
            <tr>
              <td>${item.name}</td>
              <td class="ps-val">${sc.value    ? esc(sc.value)     : '–'}</td>
              <td class="ps-val">${sc.condition ? esc(sc.condition) : '–'}</td>
              <td class="ps-sc ${scCls}">${sc.score}/${item.max}</td>
            </tr>`;
        }
      }

      return `
        <div class="ps-hist-entry${idx === 0 ? ' open' : ''}" id="psh-${idx}">
          <div class="ps-hist-hdr" onclick="document.getElementById('psh-${idx}').classList.toggle('open')">
            <div class="ps-hist-meta">
              <span class="ps-hist-date">📅 ${dateStr}</span>
              <span class="ps-hist-score">${entry.total}/100</span>
              <span class="ps-action-badge ${action.cls}" style="font-size:.78rem;padding:.2rem .6rem;">${action.label}</span>
            </div>
            <span class="ps-hist-chev">▼</span>
          </div>
          <div class="ps-hist-body">
            <table class="ps-table">
              <thead>
                <tr>
                  <th style="width:22%;">Tiêu chí</th>
                  <th style="width:25%;">Giá trị</th>
                  <th>Đánh giá</th>
                  <th style="width:9%;text-align:center;">Điểm</th>
                </tr>
              </thead>
              <tbody>${criteriaRows}</tbody>
              <tfoot>
                <tr>
                  <td colspan="3" style="text-align:right;font-weight:700;border-top:2px solid var(--border);">Tổng</td>
                  <td class="ps-sc" style="border-top:2px solid var(--border);font-size:1rem;">${entry.total}/100</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="ps-card">
        <h2>📜 Lịch sử</h2>
        ${items}
      </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  //  Main render
  // ──────────────────────────────────────────────────────────────
  function renderPivotScore(entries) {
    const latest   = entries[0] || null;
    const weekLabel = latest
      ? `<span style="font-size:.82rem;font-weight:400;color:var(--muted);margin-left:.3rem;">(Cập nhật: ${latest.week})</span>`
      : '';
    document.getElementById('main-content').innerHTML = `
      <div class="page-header">
        <h1>
          <div class="page-icon">🔄</div>
          Điểm đảo chiều ${weekLabel}
        </h1>
        <div class="header-actions">
          <button class="btn btn-outline btn-sm" onclick="loadPivotScore()">🔄 Tải lại</button>
        </div>
      </div>
      <div class="ps-sections">
        ${renderSection1(latest)}
        ${renderSection2(entries)}
      </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  //  Entry point (exported to global scope)
  // ──────────────────────────────────────────────────────────────
  window.loadPivotScore = async function () {
    injectStyles();
    showLoading('Đang tải dữ liệu Điểm đảo chiều…');
    try {
      const res = await ghFetch(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues?labels=${PIVOT_DATA_LABEL}&state=open&per_page=1`
      );
      if (!res.ok) throw new Error(`GitHub API lỗi ${res.status}`);
      const issues  = await res.json();
      const entries = issues.length ? parseIssueBody(issues[0].body || '') : [];
      renderPivotScore(entries);
    } catch (err) {
      showError(err.message, window.loadPivotScore);
    }
  };

})();
