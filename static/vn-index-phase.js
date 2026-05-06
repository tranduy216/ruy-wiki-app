// ================================================================
//  vn-index-phase.js – VN Index Phase page
//  Globals from index.html: ghFetch, GITHUB_OWNER, GITHUB_REPO,
//  showLoading, showError, esc
// ================================================================
(function () {
  'use strict';

  const VN_DATA_LABEL    = 'vn-index-phase-data';
  const VN_WORKFLOW_FILE = 'update-vn-index.yml';
  const MONTHS_TO_FETCH  = 6;   // fetch last 6 monthly issues; last 3 used for 3-month charts

  // ── Phase definitions ────────────────────────────────────────
  const PHASES = {
    sideway:      { label: 'Sideway',      emoji: '↔️',  color: '#6b7280', badge: 'badge-sideway'      },
    uptrend:      { label: 'Uptrend',      emoji: '📈',  color: '#22c55e', badge: 'badge-uptrend'      },
    distribution: { label: 'Distribution', emoji: '⚖️',  color: '#f59e0b', badge: 'badge-distribution' },
    downtrend:    { label: 'Downtrend',    emoji: '📉',  color: '#ef4444', badge: 'badge-downtrend'    },
    panic:        { label: 'Panic',        emoji: '🔥',  color: '#dc2626', badge: 'badge-panic'        },
    recovery:     { label: 'Recovery',     emoji: '🌱',  color: '#10b981', badge: 'badge-recovery'     },
  };

  // ── Asset allocation table ───────────────────────────────────
  const ASSET_TABLE = [
    { phase: 'Sideway',      equity: '30–40%',       cash: '40–50%',  gold: '10–20%', crypto: '0–10%',  strategy: 'Giữ tiền, chờ break' },
    { phase: 'Uptrend',      equity: '60–70%',       cash: '20–30%',  gold: '5–10%',  crypto: '5–15%',  strategy: 'Ride trend, giữ winner' },
    { phase: 'Distribution', equity: '40–50%',       cash: '30–40%',  gold: '10–20%', crypto: '0–10%',  strategy: 'Giảm dần, không mua mới' },
    { phase: 'Downtrend',    equity: '20–30%',       cash: '50–60%',  gold: '10–20%', crypto: '0–5%',   strategy: 'Phòng thủ, tránh bắt đáy' },
    { phase: 'Panic',        equity: '40–60% (↑dần)', cash: '20–30%', gold: '10–20%', crypto: '0–10%',  strategy: 'Bắt đầu mua (scale-in)' },
    { phase: 'Recovery',     equity: '60–80%',       cash: '10–20%',  gold: '5–10%',  crypto: '5–15%',  strategy: 'Add position, tăng risk' },
  ];

  // ── Phase criteria table ─────────────────────────────────────
  const CRITERIA_TABLE = [
    {
      phase: 'Sideway',
      price: 'Đi ngang, MA20 ≈ MA50',
      liquidity: 'Thấp dần',
      breadth: 'Cân bằng (Adv ≈ Dec)',
      behavior: 'Cổ phiếu chạy lẻ tẻ',
      next_signal: '🔸 Vol co lại rất thấp<br>🔸 Break giả nhiều<br>👉 Sắp có move lớn',
    },
    {
      phase: 'Uptrend',
      price: 'Higher high, MA20 > MA50',
      liquidity: 'Ổn định hoặc tăng',
      breadth: 'Adv > Dec',
      behavior: 'Nhiều mã cùng tăng',
      next_signal: '🔸 Breadth bắt đầu xấu<br>🔸 Trụ kéo, midcap yếu<br>👉 Sắp distribution',
    },
    {
      phase: 'Distribution',
      price: 'Index vẫn ↑',
      liquidity: 'Không tăng thêm',
      breadth: 'Dec > Adv (nhưng index chưa giảm)',
      behavior: 'Midcap/penny giảm',
      next_signal: '🔸 Divergence rõ<br>🔸 Thanh khoản bắt đầu giảm<br>👉 Sắp downtrend',
    },
    {
      phase: 'Downtrend',
      price: 'Lower high, MA20 < MA50',
      liquidity: 'Không ổn định',
      breadth: 'Dec >> Adv',
      behavior: 'Giảm từ từ',
      next_signal: '🔸 Thanh khoản cạn dần<br>🔸 Margin vẫn cao<br>👉 Sắp panic',
    },
    {
      phase: 'Panic',
      price: 'Giảm mạnh',
      liquidity: '🔥 Spike (1.5–2x)',
      breadth: 'Rất xấu (Dec/Adv > 3–4)',
      behavior: 'Sàn hàng loạt',
      next_signal: '🔸 Tin xấu dồn dập<br>🔸 Ai cũng bi quan<br>👉 Sắp tạo đáy',
    },
    {
      phase: 'Recovery',
      price: 'Bật mạnh sau giảm',
      liquidity: 'Vẫn cao',
      breadth: 'Breadth cải thiện',
      behavior: 'Nhiều mã hồi',
      next_signal: '🔸 Không còn bán mạnh<br>🔸 Dip không thủng đáy<br>👉 Sắp sideway / uptrend',
    },
  ];

  // ── Chart instances (kept to destroy before re-render) ───────
  let _charts = {};

  function destroyCharts() {
    Object.values(_charts).forEach(c => { try { c.destroy(); } catch (_) {} });
    _charts = {};
  }

  // ── Main entry point ─────────────────────────────────────────
  async function loadVnIndexPhase() {
    destroyCharts();
    showLoading('Đang tải dữ liệu VN Index Phase…');
    try {
      const data = await fetchVnData();
      renderVnIndexPhase(data);
    } catch (err) {
      showError(err.message, loadVnIndexPhase);
    }
  }

  // ── Fetch data: last N monthly issues, merge for charts ──────
  async function fetchVnData() {
    // Fetch up to 6 monthly issues (gives 6 months for interest rate chart)
    const res = await ghFetch(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues?labels=${VN_DATA_LABEL}&state=open&per_page=${MONTHS_TO_FETCH}&sort=created&direction=desc`
    );
    if (!res.ok) throw new Error(`GitHub API lỗi ${res.status}`);
    const issues = await res.json();
    if (!issues.length) throw new Error('Chưa có dữ liệu VN Index Phase. Vui lòng chạy workflow "Update VN Index" trên GitHub Actions.');

    // Parse each issue body
    const months = issues
      .map(issue => {
        const body  = issue.body || '';
        const match = body.match(/```json\s*([\s\S]*?)```/);
        if (!match) return null;
        try { return JSON.parse(match[1]); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (a.month || '').localeCompare(b.month || ''));  // oldest→newest

    if (!months.length) throw new Error('Dữ liệu bị lỗi định dạng trong GitHub Issues.');

    // Latest month = phase state
    const latest = months[months.length - 1];

    // Merge vn_index, breadth, panic_scores from last 3 months
    const last3  = months.slice(-3);
    const merged = {
      updated_at:            latest.updated_at,
      current_phase:         latest.current_phase,
      next_phase_prediction: latest.next_phase_prediction,
      phase_confidence:      latest.phase_confidence,
      phase_reason:          latest.phase_reason,
      next_phase_reason:     latest.next_phase_reason,
      asset_allocation:      latest.asset_allocation,
      provider_analysis:     latest.provider_analysis || null,
      // Merge + deduplicate by date, ascending
      vn_index:     mergeByDate(last3.flatMap(m => m.vn_index     || [])),
      breadth:      mergeByDate(last3.flatMap(m => m.breadth       || [])),
      panic_scores: mergeByDate(last3.flatMap(m => m.panic_scores  || [])),
      // Interest rates: take from latest (it already has 6-month history)
      interest_rates: latest.interest_rates || [],
    };

    return merged;
  }

  function mergeByDate(rows) {
    const map = new Map();
    for (const r of rows) if (r.date) map.set(r.date, r);
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── Main render ──────────────────────────────────────────────
  function renderVnIndexPhase(data) {
    const phase = data.current_phase || 'sideway';
    const phaseInfo = PHASES[phase] || PHASES.sideway;
    const updatedAt = data.updated_at
      ? new Date(data.updated_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'N/A';

    document.getElementById('main-content').innerHTML = `
      <div class="page-header">
        <h1>
          <div class="page-icon">📊</div>
          VN Index Phase
          <span style="font-size:.84rem;font-weight:400;color:var(--muted);margin-left:.3rem;">Cập nhật: ${updatedAt}</span>
        </h1>
        <div class="header-actions">
          <button class="btn btn-outline btn-sm" onclick="loadVnIndexPhase()" title="Tải lại">🔄 Tải lại</button>
          <button class="btn btn-primary btn-sm"
            onclick="window.open('https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${VN_WORKFLOW_FILE}','_blank')"
          >⚡ Update data</button>
        </div>
      </div>

      ${renderSection1(data, phaseInfo, phase)}
      ${renderSection2(data)}
      ${renderSection3()}
    `;

    // Draw charts after DOM is ready
    requestAnimationFrame(() => drawCharts(data));
  }

  // ── Section 1: Phase state + prediction + asset allocation ───
  function renderSection1(data, phaseInfo, phase) {
    const nextPhase = data.next_phase_prediction || '';
    const nextInfo  = PHASES[nextPhase] || null;
    const confidence = data.phase_confidence || 0;
    const reason    = esc(data.phase_reason || '');

    // Asset row for current phase
    const allocation = data.asset_allocation || {};
    const currentRow = ASSET_TABLE.find(r => r.phase.toLowerCase() === phase.toLowerCase());

    return `
      <section class="vn-section">
        <div class="vn-section-title">📍 Section 1 — Trạng thái thị trường</div>

        <!-- Phase state cards -->
        <div class="vn-phase-row">
          <div class="vn-phase-card current">
            <div class="vn-phase-card-label">Phase hiện tại</div>
            <div class="vn-phase-badge ${phaseInfo.badge}">
              ${phaseInfo.emoji} ${phaseInfo.label}
            </div>
            ${confidence ? `<div class="vn-confidence">Độ tin cậy: <strong>${confidence}%</strong></div>` : ''}
            ${reason ? `<div class="vn-reason">${reason}</div>` : ''}
          </div>

          ${nextInfo ? `
          <div class="vn-phase-card next">
            <div class="vn-phase-card-label">Dự đoán phase tiếp theo</div>
            <div class="vn-phase-badge ${nextInfo.badge}" style="opacity:.85;">
              ${nextInfo.emoji} ${nextInfo.label}
            </div>
            ${data.next_phase_reason ? `<div class="vn-reason">${esc(data.next_phase_reason)}</div>` : ''}
          </div>` : ''}
        </div>

        ${renderProviderAnalysis(data.provider_analysis)}

        <!-- Allocation highlight for current phase -->
        ${currentRow ? `
        <div class="vn-alloc-highlight">
          <div class="vn-alloc-title">📊 Phân bổ tài sản đề xuất — <em>${currentRow.phase}</em></div>
          <div class="vn-alloc-chips">
            <div class="vn-chip chip-equity">💼 Cổ phiếu<br><strong>${allocation.equity || currentRow.equity}</strong></div>
            <div class="vn-chip chip-cash">💵 Cash / TK<br><strong>${allocation.cash || currentRow.cash}</strong></div>
            <div class="vn-chip chip-gold">🥇 Vàng<br><strong>${allocation.gold || currentRow.gold}</strong></div>
            <div class="vn-chip chip-crypto">₿ Crypto<br><strong>${allocation.crypto || currentRow.crypto}</strong></div>
          </div>
          <div class="vn-strategy">🎯 Chiến lược: <strong>${allocation.strategy || currentRow.strategy}</strong></div>
        </div>` : ''}

        <!-- Full allocation table -->
        <div class="vn-table-wrap">
          <table class="vn-table">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Cổ phiếu</th>
                <th>Cash / TK</th>
                <th>Vàng</th>
                <th>Crypto</th>
                <th>Chiến lược</th>
              </tr>
            </thead>
            <tbody>
              ${ASSET_TABLE.map(row => {
                const isActive = row.phase.toLowerCase() === phase.toLowerCase();
                return `<tr class="${isActive ? 'vn-active-row' : ''}">
                  <td><strong>${row.phase}</strong></td>
                  <td>${row.equity}</td>
                  <td>${row.cash}</td>
                  <td>${row.gold}</td>
                  <td>${row.crypto}</td>
                  <td>${row.strategy}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  // ── Provider analysis cards (OpenAI vs Gemini) ───────────────
  function renderProviderAnalysis(pa) {
    if (!pa || (!pa.openai && !pa.gemini)) return '';

    function providerCard(name, color, icon, result) {
      if (!result) return `
        <div class="vn-provider-card" style="border-color:${color}20;">
          <div class="vn-provider-label" style="color:${color};">${icon} ${name}</div>
          <div class="vn-provider-na">Không có dữ liệu</div>
        </div>`;
      const phaseInfo = PHASES[result.current_phase] || PHASES.sideway;
      const nextInfo  = PHASES[result.next_phase_prediction] || null;
      return `
        <div class="vn-provider-card" style="border-color:${color}40;">
          <div class="vn-provider-label" style="color:${color};">${icon} ${name}</div>
          <div class="vn-provider-phase">
            <span class="vn-phase-badge ${phaseInfo.badge}" style="font-size:.78rem;padding:.2rem .6rem;">
              ${phaseInfo.emoji} ${phaseInfo.label}
            </span>
            ${result.phase_confidence ? `<span class="vn-confidence" style="margin-left:.5rem;">${result.phase_confidence}%</span>` : ''}
          </div>
          ${result.phase_reason ? `<div class="vn-reason" style="margin-top:.4rem;">${esc(result.phase_reason)}</div>` : ''}
          ${nextInfo ? `
          <div style="margin-top:.5rem;font-size:.8rem;color:var(--muted);">
            Tiếp theo: <span class="vn-phase-badge ${nextInfo.badge}" style="font-size:.72rem;padding:.15rem .5rem;opacity:.85;">${nextInfo.emoji} ${nextInfo.label}</span>
            ${result.next_phase_reason ? `<div class="vn-reason" style="margin-top:.25rem;">${esc(result.next_phase_reason)}</div>` : ''}
          </div>` : ''}
        </div>`;
    }

    return `
      <div class="vn-provider-row">
        <div class="vn-provider-title">🤖 Phân tích AI theo nhà cung cấp</div>
        <div class="vn-provider-cards">
          ${providerCard('ChatGPT (OpenAI)', '#3b82f6', '🔵', pa.openai)}
          ${providerCard('Gemini (Google)', '#ef4444', '🔴', pa.gemini)}
        </div>
      </div>`;
  }

  // ── Section 2: Charts ────────────────────────────────────────
  function renderSection2(data) {
    return `
      <section class="vn-section">
        <div class="vn-section-title">📈 Section 2 — Charts (3 tháng gần nhất)</div>
        <div class="vn-charts-grid">

          <div class="vn-chart-card">
            <div class="vn-chart-title">VN Index + MA10 + MA50 + Volume</div>
            <div class="vn-chart-wrap">
              <canvas id="chart-vn-index"></canvas>
            </div>
          </div>

          <div class="vn-chart-card">
            <div class="vn-chart-title">Breadth — % Mã tăng / % Mã giảm</div>
            <div class="vn-chart-wrap">
              <canvas id="chart-breadth"></canvas>
            </div>
          </div>

          <div class="vn-chart-card">
            <div class="vn-chart-title">Panic Score</div>
            <div class="vn-chart-wrap">
              <canvas id="chart-panic"></canvas>
            </div>
          </div>

          <div class="vn-chart-card">
            <div class="vn-chart-title">Lãi suất huy động & Liên ngân hàng (6 tháng)</div>
            <div class="vn-chart-wrap">
              <canvas id="chart-rates"></canvas>
            </div>
          </div>

        </div>
      </section>`;
  }

  // ── Section 3: Phase criteria table ─────────────────────────
  function renderSection3() {
    return `
      <section class="vn-section">
        <div class="vn-section-title">📋 Section 3 — Tiêu chí xác định Phase</div>
        <div class="vn-table-wrap">
          <table class="vn-table vn-criteria-table">
            <thead>
              <tr>
                <th>Trạng thái</th>
                <th>Giá (trend)</th>
                <th>Thanh khoản</th>
                <th>Breadth</th>
                <th>Hành vi CP</th>
                <th>Dấu hiệu sắp chuyển</th>
              </tr>
            </thead>
            <tbody>
              ${CRITERIA_TABLE.map(row => `
                <tr>
                  <td><strong>${row.phase}</strong></td>
                  <td>${row.price}</td>
                  <td>${row.liquidity}</td>
                  <td>${row.breadth}</td>
                  <td>${row.behavior}</td>
                  <td>${row.next_signal}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  // ── Chart drawing ────────────────────────────────────────────
  function drawCharts(data) {
    if (typeof Chart === 'undefined') return;

    const isDark = document.documentElement.dataset.theme === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
    const textColor = isDark ? '#aaaaaa' : '#6b7280';
    const WHITE = isDark ? '#e0e0e0' : '#1a1a2e';

    Chart.defaults.color = textColor;
    Chart.defaults.borderColor = gridColor;
    Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
    Chart.defaults.font.size = 11;

    drawVnIndexChart(data.vn_index || [], isDark, gridColor, WHITE);
    drawBreadthChart(data.breadth || [], isDark, gridColor, WHITE);
    drawPanicChart(data.panic_scores || [], isDark, gridColor, WHITE);
    drawRatesChart(data.interest_rates || [], isDark, gridColor, WHITE);
  }

  function getCtx(id) {
    const canvas = document.getElementById(id);
    return canvas ? canvas.getContext('2d') : null;
  }

  // Chart 1: VN Index line + MA10/MA50 + volume bar
  function drawVnIndexChart(rows, isDark, gridColor, textColor) {
    const ctx = getCtx('chart-vn-index');
    if (!ctx || !rows.length) return;

    const labels  = rows.map(r => r.date);
    const closes  = rows.map(r => r.close);
    const ma10    = rows.map(r => r.ma10 != null ? r.ma10 : null);
    const ma50    = rows.map(r => r.ma50 != null ? r.ma50 : null);
    const volumes = rows.map(r => (r.volume || 0) / 1e9); // convert to nghìn tỷ

    const maxClose  = Math.max(...closes.filter(Boolean));
    const minClose  = Math.min(...closes.filter(Boolean));
    const priceRange = maxClose - minClose || 1;

    _charts['vn-index'] = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Volume (nghìn tỷ)',
            data: volumes,
            backgroundColor: rows.map(r => {
              if (!r.close || !r.open) return 'rgba(100,100,200,0.35)';
              return r.close >= r.open
                ? 'rgba(34,197,94,0.35)'
                : 'rgba(239,68,68,0.35)';
            }),
            yAxisID: 'yVol',
            order: 3,
            borderWidth: 0,
          },
          {
            type: 'line',
            label: 'VN Index',
            data: closes,
            borderColor: isDark ? '#60a5fa' : '#0078d4',
            backgroundColor: 'transparent',
            borderWidth: 1.8,
            pointRadius: 0,
            tension: 0.25,
            yAxisID: 'yPrice',
            order: 1,
          },
          {
            type: 'line',
            label: 'MA10',
            data: ma10,
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 1.4,
            borderDash: [4, 2],
            pointRadius: 0,
            tension: 0.25,
            yAxisID: 'yPrice',
            order: 2,
          },
          {
            type: 'line',
            label: 'MA50',
            data: ma50,
            borderColor: '#ec4899',
            backgroundColor: 'transparent',
            borderWidth: 1.4,
            borderDash: [7, 3],
            pointRadius: 0,
            tension: 0.25,
            yAxisID: 'yPrice',
            order: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, padding: 10 } },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (ctx.dataset.label === 'Volume (nghìn tỷ)') return ` Vol: ${ctx.parsed.y.toFixed(2)} nghìn tỷ`;
                return ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) : 'N/A'}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { maxTicksLimit: 8, maxRotation: 0 },
            grid: { color: gridColor },
          },
          yPrice: {
            type: 'linear',
            position: 'left',
            min: Math.floor(minClose - priceRange * 0.05),
            ticks: { callback: v => v.toFixed(0) },
            grid: { color: gridColor },
          },
          yVol: {
            type: 'linear',
            position: 'right',
            max: Math.max(...volumes) * 4,
            ticks: { callback: v => v.toFixed(1) + ' NT' },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  }

  // Chart 2: Breadth – % advance / % decline
  function drawBreadthChart(rows, isDark, gridColor, textColor) {
    const ctx = getCtx('chart-breadth');
    if (!ctx || !rows.length) return;

    const labels  = rows.map(r => r.date);
    const advPct  = rows.map(r => r.adv_pct);
    const decPct  = rows.map(r => r.dec_pct);

    // 1-SD bands
    const avg = arr => arr.reduce((s, v) => s + (v || 0), 0) / arr.length;
    const sd  = arr => { const m = avg(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); };
    const advMean = avg(advPct);
    const advSd   = sd(advPct);
    const advHi   = advPct.map(() => +(advMean + advSd).toFixed(1));
    const advLo   = advPct.map(() => +(advMean - advSd).toFixed(1));

    _charts['breadth'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '% Mã tăng',
            data: advPct,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.08)',
            fill: false,
            borderWidth: 1.8,
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: '% Mã giảm',
            data: decPct,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.08)',
            fill: false,
            borderWidth: 1.8,
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: '+1σ Adv',
            data: advHi,
            borderColor: 'rgba(34,197,94,0.3)',
            borderWidth: 1,
            borderDash: [3, 3],
            pointRadius: 0,
            fill: false,
          },
          {
            label: '-1σ Adv',
            data: advLo,
            borderColor: 'rgba(34,197,94,0.3)',
            borderWidth: 1,
            borderDash: [3, 3],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, padding: 10 } },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%` }
          }
        },
        scales: {
          x: { ticks: { maxTicksLimit: 8, maxRotation: 0 }, grid: { color: gridColor } },
          y: {
            min: 0, max: 100,
            ticks: { callback: v => v + '%' },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  // Chart 3: Panic score bar chart
  function drawPanicChart(rows, isDark, gridColor, textColor) {
    const ctx = getCtx('chart-panic');
    if (!ctx || !rows.length) return;

    const labels = rows.map(r => r.date);
    const scores = rows.map(r => r.panic_score);

    const bgColors = scores.map(s => {
      if (s >= 7) return 'rgba(220,38,38,0.85)';
      if (s >= 5) return 'rgba(239,68,68,0.7)';
      if (s >= 3) return 'rgba(245,158,11,0.7)';
      return 'rgba(34,197,94,0.6)';
    });

    _charts['panic'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Panic Score',
            data: scores,
            backgroundColor: bgColors,
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, padding: 10 } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const row = rows[ctx.dataIndex];
                const label = row?.label || '';
                const reason = (row?.reason || []).join(', ');
                return [
                  ` Score: ${ctx.parsed.y}`,
                  ` Label: ${label}`,
                  reason ? ` Lý do: ${reason}` : '',
                ].filter(Boolean);
              }
            }
          }
        },
        scales: {
          x: { ticks: { maxTicksLimit: 10, maxRotation: 0 }, grid: { color: gridColor } },
          y: {
            min: 0, max: 10,
            ticks: { stepSize: 1 },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  // Chart 4: Interest rates line chart (6 months)
  function drawRatesChart(rows, isDark, gridColor, textColor) {
    const ctx = getCtx('chart-rates');
    if (!ctx || !rows.length) return;

    const labels    = rows.map(r => r.date);
    const deposit   = rows.map(r => r.deposit_rate);
    const interbank = rows.map(r => r.interbank_rate);

    _charts['rates'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Lãi suất huy động (%)',
            data: deposit,
            borderColor: isDark ? '#60a5fa' : '#0078d4',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.35,
          },
          {
            label: 'Lãi suất liên ngân hàng (%)',
            data: interbank,
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 3],
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, padding: 10 } },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}%` }
          }
        },
        scales: {
          x: { ticks: { maxTicksLimit: 8, maxRotation: 0 }, grid: { color: gridColor } },
          y: {
            ticks: { callback: v => v.toFixed(1) + '%' },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  // ── Expose ────────────────────────────────────────────────────
  window.loadVnIndexPhase = loadVnIndexPhase;

}());
