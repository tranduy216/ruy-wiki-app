// ================================================================
//  pivot-score.js – Điểm đảo chiều (Pivot Score) page
//  Globals from index.html: ghFetch, getPAT, openPATModal,
//  GITHUB_OWNER, GITHUB_REPO, showLoading, showError, showToast, esc
// ================================================================
(function () {
  'use strict';

  const PIVOT_DATA_LABEL  = 'pivot-score-data';
  const PIVOT_DATA_TITLE  = '📊 Pivot Score Data';
  const FRED_KEY_STORAGE  = 'ruy_wiki_fred_key';
  const FRED_BASE         = 'https://api.stlouisfed.org/fred/series/observations';
  const CORS_PROXY        = 'https://corsproxy.io/?';

  function getFredKey()   { return localStorage.getItem(FRED_KEY_STORAGE) || ''; }
  function setFredKey(k)  { localStorage.setItem(FRED_KEY_STORAGE, k.trim()); }
  function clearFredKey() { localStorage.removeItem(FRED_KEY_STORAGE); }

  function getMondayISO() {
    const now  = new Date();
    const day  = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon  = new Date(now);
    mon.setDate(now.getDate() + diff);
    return mon.toISOString().split('T')[0];
  }

  const CRITERIA_DEF = [
    {
      group: '1. Bond Market', groupMax: 25, emoji: '💵',
      note: '👉 Đây là leading indicator số 1',
      items: [
        { key: 'us2y', name: 'US 2Y Yield trend', max: 15,
          levels: [
            { score: 15, label: 'Giảm mạnh, liên tục (≥ 50–100bps trong vài tháng)' },
            { score: 8,  label: 'Giảm nhẹ' },
            { score: 0,  label: 'Sideway / tăng' }
          ]
        },
        { key: 'fed_futures', name: 'Fed Funds Futures', max: 10,
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
        { key: 'yield_curve', name: '10Y–2Y chuyển từ inverted → steepening', max: 15,
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
        { key: 'unemployment', name: 'Unemployment rate', max: 10,
          levels: [
            { score: 10, label: 'Tăng nhanh ≥ 0.4–0.5% trong 3–6 tháng' },
            { score: 5,  label: 'Tăng nhẹ' },
            { score: 0,  label: 'Ổn định' }
          ]
        },
        { key: 'jobless_claims', name: 'Jobless claims', max: 10,
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
        { key: 'core_cpi', name: 'Core CPI trend', max: 10,
          levels: [
            { score: 10, label: 'Giảm rõ ràng, liên tục' },
            { score: 5,  label: 'Giảm nhẹ' },
            { score: 0,  label: 'Flat / tăng' }
          ]
        },
        { key: 'pce', name: 'PCE (Fed thích cái này)', max: 5,
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
        { key: 'fed_communication', name: 'Phát biểu Jerome Powell', max: 10,
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
        { key: 'credit_spread', name: 'Credit spread', max: 10,
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
        { key: 'market_behavior', name: '"Tin xấu nhưng không giảm"', max: 5,
          levels: [
            { score: 5, label: 'Có' },
            { score: 0, label: 'Không' }
          ]
        }
      ]
    }
  ];

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

  function buildIssueBody(entries) {
    const json = JSON.stringify(entries, null, 2);
    return '# 📊 Pivot Score Data\n\nDữ liệu tự động cập nhật mỗi thứ Hai bởi GitHub Actions.\nChỉnh sửa JSON bên dưới để điều chỉnh điểm thủ công (Fed Communication, Market Behavior).\n\n<!-- PIVOT_DATA_START\n' + json + '\nPIVOT_DATA_END -->\n';
  }

  // ── FRED browser fetch ─────────────────────────────────────
  async function fredFetch(seriesId, limit, fredKey) {
    const url = FRED_BASE + '?series_id=' + encodeURIComponent(seriesId)
      + '&api_key=' + encodeURIComponent(fredKey)
      + '&sort_order=desc&limit=' + limit + '&file_type=json';
    const proxyUrl = CORS_PROXY + encodeURIComponent(url);
    const res = await fetch(proxyUrl);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('FRED ' + seriesId + ': HTTP ' + res.status + (txt ? ' – ' + txt.slice(0, 100) : ''));
    }
    const data = await res.json();
    if (data.error_message) throw new Error('FRED: ' + data.error_message);
    return (data.observations || []).filter(function(o) { return o.value !== '.' && o.value !== 'NA'; });
  }

  function obsVal(obs, idx) { idx = idx || 0; return obs[idx] ? parseFloat(obs[idx].value) : null; }

  function idxMonthsAgo(obs, months) {
    if (!obs.length) return obs.length - 1;
    const target = new Date(obs[0].date);
    target.setMonth(target.getMonth() - months);
    const ts = target.toISOString().split('T')[0];
    for (let i = 0; i < obs.length; i++) { if (obs[i].date <= ts) return i; }
    return obs.length - 1;
  }

  async function scoreUs2y(fk) {
    const obs = await fredFetch('DGS2', 120, fk);
    if (!obs.length) return { score: 0, max: 15, value: 'N/A', condition: 'Không có dữ liệu' };
    const cur = obsVal(obs, 0), ago = obsVal(obs, idxMonthsAgo(obs, 3));
    const chg = ago != null ? +(cur - ago).toFixed(3) : null;
    let score, condition;
    if      (chg == null)  { score = 0;  condition = 'Không đủ dữ liệu'; }
    else if (chg <= -0.50) { score = 15; condition = 'Giảm mạnh, liên tục'; }
    else if (chg < -0.05)  { score = 8;  condition = 'Giảm nhẹ'; }
    else                   { score = 0;  condition = 'Sideway / tăng'; }
    const arrow = chg == null ? '' : chg < 0 ? '↓' : '↑';
    const value = chg != null ? cur.toFixed(2) + '% (' + arrow + Math.abs(chg).toFixed(2) + '% / 3 tháng)' : cur.toFixed(2) + '%';
    return { score, max: 15, value, condition };
  }

  async function scoreFedFutures(fk) {
    const results = await Promise.all([fredFetch('DFF', 10, fk), fredFetch('DGS2', 10, fk)]);
    const dff = results[0], dgs2 = results[1];
    if (!dff.length || !dgs2.length) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
    const ffr = obsVal(dff, 0), twoY = obsVal(dgs2, 0);
    const spread = +(ffr - twoY).toFixed(3);
    let score, condition;
    if      (spread >= 0.50) { score = 10; condition = 'Market pricing giảm lãi rõ (≥ 2 cuts)'; }
    else if (spread > 0.15)  { score = 5;  condition = 'Pricing nhẹ'; }
    else                     { score = 0;  condition = 'Không pricing'; }
    const value = 'FFR ' + ffr.toFixed(2) + '% vs 2Y ' + twoY.toFixed(2) + '% → spread ' + (spread >= 0 ? '+' : '') + spread.toFixed(2) + '%';
    return { score, max: 10, value, condition };
  }

  async function scoreYieldCurve(fk) {
    const results = await Promise.all([fredFetch('T10Y2Y', 90, fk), fredFetch('DGS2', 90, fk)]);
    const obs = results[0], dgs2 = results[1];
    if (!obs.length) return { score: 0, max: 15, value: 'N/A', condition: 'Không có dữ liệu' };
    const cur = obsVal(obs, 0), ago = obsVal(obs, idxMonthsAgo(obs, 3));
    const steepen = ago != null && cur > ago;
    let score, condition;
    if (steepen) {
      const us2yCur = dgs2.length ? obsVal(dgs2, 0) : null;
      const us2yAgo = dgs2.length ? obsVal(dgs2, idxMonthsAgo(dgs2, 3)) : null;
      if (us2yCur != null && us2yAgo != null && us2yCur < us2yAgo) {
        score = 15; condition = 'Steepening do short-term yield ↓';
      } else { score = 5; condition = 'Steepening do long-term ↑'; }
    } else { score = 0; condition = cur < 0 ? 'Vẫn inverted sâu' : 'Sideway / tăng'; }
    const arrow = ago == null ? '' : cur > ago ? '↑' : '↓';
    const value = ago != null ? cur.toFixed(2) + '% (' + arrow + ' từ ' + ago.toFixed(2) + '% / 3T)' : cur.toFixed(2) + '%';
    return { score, max: 15, value, condition };
  }

  async function scoreUnemployment(fk) {
    const obs = await fredFetch('UNRATE', 12, fk);
    if (!obs.length) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
    const cur = obsVal(obs, 0), idx6m = Math.min(obs.length - 1, 6), ago = obsVal(obs, idx6m);
    const chg = ago != null ? +(cur - ago).toFixed(2) : null;
    let score, condition;
    if      (chg == null)  { score = 0;  condition = 'Không đủ dữ liệu'; }
    else if (chg >= 0.40)  { score = 10; condition = 'Tăng nhanh ≥ 0.4–0.5% trong 3–6 tháng'; }
    else if (chg >= 0.10)  { score = 5;  condition = 'Tăng nhẹ'; }
    else                   { score = 0;  condition = 'Ổn định'; }
    const agoM = obs[idx6m] ? obs[idx6m].date.slice(0, 7) : '';
    const value = chg != null ? cur.toFixed(1) + '% (' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '% từ ' + agoM + ')' : cur.toFixed(1) + '%';
    return { score, max: 10, value, condition };
  }

  async function scoreJoblessClaims(fk) {
    const obs = await fredFetch('ICSA', 20, fk);
    if (obs.length < 5) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
    const ma4 = function(start) {
      let sum = 0, cnt = 0;
      for (let i = start; i < Math.min(start + 4, obs.length); i++) { sum += obsVal(obs, i); cnt++; }
      return cnt ? sum / cnt : null;
    };
    const curMA = ma4(0), oldMA = ma4(Math.min(obs.length - 1, 12));
    const pct = (curMA != null && oldMA != null && oldMA > 0) ? ((curMA - oldMA) / oldMA) * 100 : null;
    let score, condition;
    if      (pct == null) { score = 0;  condition = 'Không đủ dữ liệu'; }
    else if (pct >= 15)   { score = 10; condition = 'Tăng mạnh, liên tục'; }
    else if (pct >= 5)    { score = 5;  condition = 'Tăng nhẹ'; }
    else                  { score = 0;  condition = 'Flat'; }
    const curK = curMA ? Math.round(curMA / 1000) : '?';
    const value = pct != null ? curK + 'K (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '% / 12 tuần)' : curK + 'K';
    return { score, max: 10, value, condition };
  }

  async function scoreCoreCpi(fk) {
    const obs = await fredFetch('CPILFESL', 18, fk);
    if (obs.length < 13) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
    const curVal = obsVal(obs, 0), yoy12 = obsVal(obs, 12);
    const curYoY = yoy12 ? +(((curVal / yoy12) - 1) * 100).toFixed(2) : null;
    const idx3m  = Math.min(obs.length - 1, 3);
    const val3m  = obsVal(obs, idx3m), yoy3m12 = obs[idx3m + 12] ? obsVal(obs, idx3m + 12) : null;
    const yoY3m  = (val3m && yoy3m12) ? +(((val3m / yoy3m12) - 1) * 100).toFixed(2) : null;
    const yoyChg = (curYoY != null && yoY3m != null) ? +(curYoY - yoY3m).toFixed(2) : null;
    let score, condition;
    if      (yoyChg == null)  { score = 0;  condition = 'Không đủ dữ liệu'; }
    else if (yoyChg <= -0.30) { score = 10; condition = 'Giảm rõ ràng, liên tục'; }
    else if (yoyChg < 0)      { score = 5;  condition = 'Giảm nhẹ'; }
    else                      { score = 0;  condition = 'Flat / tăng'; }
    const value = curYoY != null ? curYoY.toFixed(2) + '% YoY (' + (yoyChg != null ? (yoyChg >= 0 ? '+' : '') + yoyChg.toFixed(2) + 'pp / 3T' : '') + ')' : 'N/A';
    return { score, max: 10, value, condition };
  }

  async function scorePce(fk) {
    const obs = await fredFetch('PCEPILFE', 18, fk);
    if (obs.length < 13) return { score: 0, max: 5, value: 'N/A', condition: 'Không có dữ liệu' };
    const curVal = obsVal(obs, 0), yoy12 = obsVal(obs, 12);
    const curYoY = yoy12 ? +(((curVal / yoy12) - 1) * 100).toFixed(2) : null;
    const idx3m  = Math.min(obs.length - 1, 3);
    const val3m  = obsVal(obs, idx3m), yoy3m12 = obs[idx3m + 12] ? obsVal(obs, idx3m + 12) : null;
    const yoY3m  = (val3m && yoy3m12) ? +(((val3m / yoy3m12) - 1) * 100).toFixed(2) : null;
    const yoyChg = (curYoY != null && yoY3m != null) ? +(curYoY - yoY3m).toFixed(2) : null;
    let score, condition;
    if      (yoyChg == null) { score = 0; condition = 'Không đủ dữ liệu'; }
    else if (yoyChg < 0)     { score = 5; condition = 'Giảm'; }
    else                     { score = 0; condition = 'Không giảm'; }
    const value = curYoY != null ? curYoY.toFixed(2) + '% YoY' : 'N/A';
    return { score, max: 5, value, condition };
  }

  function scoreFedCommunication(prevScore) {
    const s   = [0, 5, 10].includes(prevScore) ? prevScore : 5;
    const map = { 10: '"Ready to adjust policy"', 5: '"Risks balanced"', 0: 'Vẫn hawkish' };
    return { score: s, max: 10, value: 'Manual – xem phát biểu Powell gần nhất', condition: map[s] };
  }

  async function scoreCreditSpread(fk) {
    const obs = await fredFetch('BAMLH0A0HYM2', 90, fk);
    if (!obs.length) return { score: 0, max: 10, value: 'N/A', condition: 'Không có dữ liệu' };
    const cur = obsVal(obs, 0), ago = obsVal(obs, idxMonthsAgo(obs, 3));
    const chg = ago != null ? +(cur - ago).toFixed(3) : null;
    let score, condition;
    if      (chg == null) { score = 0;  condition = 'Không đủ dữ liệu'; }
    else if (chg >= 2.0)  { score = 10; condition = 'Mở rộng mạnh'; }
    else if (chg >= 0.30) { score = 5;  condition = 'Mở rộng nhẹ'; }
    else                  { score = 0;  condition = 'Bình thường'; }
    const value = chg != null ? cur.toFixed(2) + '% (' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '% / 3T)' : cur.toFixed(2) + '%';
    return { score, max: 10, value, condition };
  }

  function scoreMarketBehavior(prevScore) {
    const s = [0, 5].includes(prevScore) ? prevScore : 0;
    return { score: s, max: 5, value: 'Manual – theo dõi reaction thị trường', condition: s === 5 ? 'Có' : 'Không' };
  }

  // ── GitHub helpers ──────────────────────────────────────────
  async function ensureLabel() {
    const res = await ghFetch('/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/labels/' + PIVOT_DATA_LABEL);
    if (res.status === 404) {
      await ghFetch('/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: PIVOT_DATA_LABEL, color: '0052cc', description: 'Pivot score weekly data' })
      });
    }
  }

  async function fetchDataIssue() {
    const res = await ghFetch('/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/issues?labels=' + PIVOT_DATA_LABEL + '&state=open&per_page=1');
    if (!res.ok) throw new Error('GitHub API lỗi ' + res.status);
    const list = await res.json();
    return list.length ? list[0] : null;
  }

  async function createDataIssue(body) {
    const res = await ghFetch('/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: PIVOT_DATA_TITLE, body, labels: [PIVOT_DATA_LABEL] })
    });
    if (!res.ok) throw new Error('Tạo issue lỗi ' + res.status);
    return res.json();
  }

  async function updateIssueBody(number, body) {
    const res = await ghFetch('/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/issues/' + number, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });
    if (!res.ok) throw new Error('Cập nhật issue lỗi ' + res.status);
    return res.json();
  }

  // ── FRED connection test (uses /fred/releases – lightweight) ──
  async function fredTestConnection(fredKey) {
    const url = 'https://api.stlouisfed.org/fred/releases?api_key='
      + encodeURIComponent(fredKey) + '&limit=1&file_type=json';
    const proxyUrl = CORS_PROXY + encodeURIComponent(url);
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error_message) throw new Error(data.error_message);
    if (!Array.isArray(data.releases)) throw new Error('Unexpected response');
    return true;
  }

  window.testFredConnection = async function() {
    const input  = document.getElementById('fred-key-input');
    const btn    = document.getElementById('fred-test-btn');
    const status = document.getElementById('fred-test-status');
    let key = input.value.trim();
    if (key === '••••••••••••••••') key = getFredKey();
    if (!key) {
      status.innerHTML = '<span style="color:var(--red);">⚠️ Nhập key trước khi test.</span>';
      status.style.display = 'block';
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Đang kiểm tra…';
    status.style.display = 'none';
    try {
      await fredTestConnection(key);
      status.innerHTML = '<span style="color:var(--green);">✅ Kết nối thành công! FRED API Key hợp lệ.</span>';
    } catch (e) {
      status.innerHTML = '<span style="color:var(--red);">❌ Lỗi: ' + esc(e.message) + '</span>';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🔗 Test kết nối';
      status.style.display = 'block';
    }
  };

  // ── FRED modal ──────────────────────────────────────────────
  function injectFredModal() {
    if (document.getElementById('fred-modal')) return;
    const el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'fred-modal';
    el.innerHTML = '<div class="modal" style="max-width:540px;">'
      + '<div class="modal-header"><h2>🔑 FRED API Key</h2>'
      + '<button class="modal-close" onclick="closeFredModal()">✕</button></div>'
      + '<div class="modal-body">'
      + '<div class="info-box"><strong>�� FRED API Key dùng để lấy dữ liệu kinh tế vĩ mô trực tiếp từ trình duyệt</strong><br/>'
      + 'Đăng ký miễn phí tại <a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank">fred.stlouisfed.org → My Account → API Keys</a><br/>'
      + '<span style="color:var(--muted);font-size:.8rem;">Key chỉ lưu trong trình duyệt này, không gửi đến đâu ngoài FRED API.</span></div>'
      + '<div class="form-group"><label class="form-label">FRED API Key</label>'
      + '<input type="password" id="fred-key-input" class="form-input" placeholder="abcdef1234567890abcdef1234567890" onkeydown="if(event.key===\'Enter\') submitFredKey()" />'
      + '<span class="form-error" id="fred-key-error">Vui lòng nhập FRED API Key!</span></div>'
      + '<div id="fred-key-clear-row" style="display:none;margin-top:-.3rem;">'
      + '<button class="btn btn-danger btn-sm" onclick="handleClearFredKey()">🗑 Xóa key đã lưu</button>'
      + '<span style="font-size:.78rem;color:var(--muted);margin-left:.6rem;">Key hiện tại đã được lưu.</span></div>'
      + '<div style="margin-top:.9rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;">'
      + '<button id="fred-test-btn" class="btn btn-outline btn-sm" onclick="testFredConnection()">🔗 Test kết nối</button>'
      + '<span id="fred-test-status" style="display:none;font-size:.82rem;"></span></div>'
      + '</div>'
      + '<div class="modal-footer"><button class="btn btn-outline" onclick="closeFredModal()">Hủy</button>'
      + '<button class="btn btn-primary" onclick="submitFredKey()">💾 Lưu và tiếp tục</button></div>'
      + '</div>';
    el.addEventListener('click', function(e) { if (e.target === this) closeFredModal(); });
    document.body.appendChild(el);
  }

  window.openFredModal = function() {
    injectFredModal();
    const input  = document.getElementById('fred-key-input');
    const err    = document.getElementById('fred-key-error');
    const clear  = document.getElementById('fred-key-clear-row');
    const status = document.getElementById('fred-test-status');
    const has    = getFredKey();
    input.value = has ? '••••••••••••••••' : '';
    err.classList.remove('visible');
    clear.style.display = has ? 'block' : 'none';
    if (status) status.style.display = 'none';
    document.getElementById('fred-modal').classList.add('open');
    if (!has) setTimeout(function() { input.focus(); }, 80);
  };

  window.closeFredModal = function() {
    const el = document.getElementById('fred-modal');
    if (el) el.classList.remove('open');
    window._fredKeyCb = null;
  };

  window.submitFredKey = function() {
    const input = document.getElementById('fred-key-input');
    const err   = document.getElementById('fred-key-error');
    const val   = input.value.trim();
    if (val === '••••••••••••••••' && getFredKey()) {
      const cb = window._fredKeyCb;
      window.closeFredModal();
      if (cb) cb();
      return;
    }
    if (!val) { err.classList.add('visible'); return; }
    err.classList.remove('visible');
    setFredKey(val);
    const cb = window._fredKeyCb;
    window.closeFredModal();
    if (cb) cb();
  };

  window.handleClearFredKey = function() {
    clearFredKey();
    const input = document.getElementById('fred-key-input');
    const clear = document.getElementById('fred-key-clear-row');
    if (input) input.value = '';
    if (clear) clear.style.display = 'none';
    showToast('Đã xóa FRED API Key!', 'success');
    window.closeFredModal();
    refreshFredBadge();
  };

  function refreshFredBadge() {
    const el = document.getElementById('ps-fred-badge');
    if (!el) return;
    el.innerHTML = getFredKey()
      ? '<span style="color:var(--green);font-size:.78rem;">🔑 FRED Key ✓</span><button class="btn btn-sm" style="padding:.15rem .5rem;font-size:.72rem;margin-left:.4rem;" onclick="openFredModal()">Thay đổi</button>'
      : '<button class="btn btn-outline btn-sm" style="font-size:.78rem;" onclick="openFredModal()">🔑 Cài FRED Key</button>';
  }

  // ── Update / Create action ───────────────────────────────────
  window.updatePivotData = async function(btn) {
    if (!getPAT()) { openPATModal(false); return; }
    const fredKey = getFredKey();
    if (!fredKey) {
      window._fredKeyCb = function() { window.updatePivotData(btn); };
      window.openFredModal();
      return;
    }

    const origLabel = btn.innerHTML;
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Đang lấy dữ liệu…';

    try {
      await ensureLabel();
      const issue       = await fetchDataIssue();
      const prevEntries = issue ? parseIssueBody(issue.body || '') : [];
      const prevEntry   = prevEntries[0] || null;
      const prevFedComm = prevEntry && prevEntry.scores && prevEntry.scores.fed_communication
        ? prevEntry.scores.fed_communication.score : 5;
      const prevMktBeh  = prevEntry && prevEntry.scores && prevEntry.scores.market_behavior
        ? prevEntry.scores.market_behavior.score : 0;

      btn.innerHTML = '<span class="spinner spinner-sm"></span> Đang tính điểm…';
      const fredKeys  = ['us2y','fed_futures','yield_curve','unemployment','jobless_claims','core_cpi','pce','credit_spread'];
      const fredMaxes = [15, 10, 15, 10, 10, 10, 5, 10];
      const settled = await Promise.allSettled([
        scoreUs2y(fredKey), scoreFedFutures(fredKey), scoreYieldCurve(fredKey),
        scoreUnemployment(fredKey), scoreJoblessClaims(fredKey),
        scoreCoreCpi(fredKey), scorePce(fredKey), scoreCreditSpread(fredKey)
      ]);

      const fredScores = {};
      settled.forEach(function(r, i) {
        fredScores[fredKeys[i]] = r.status === 'fulfilled'
          ? r.value
          : { score: 0, max: fredMaxes[i], value: 'Lỗi lấy dữ liệu', condition: 'N/A' };
        if (r.status === 'rejected') console.warn(fredKeys[i] + ': ' + r.reason.message);
      });

      const scores = Object.assign({}, fredScores, {
        fed_communication: scoreFedCommunication(prevFedComm),
        market_behavior:   scoreMarketBehavior(prevMktBeh)
      });
      const total = Object.values(scores).reduce(function(s, v) { return s + (v.score || 0); }, 0);
      const week  = getMondayISO();

      const newEntry = {
        week, scores, total,
        action: getAction(total).label,
        updated_at: new Date().toISOString()
      };

      const entries = prevEntries.slice();
      if (entries.length && entries[0].week === week) {
        entries[0] = newEntry;
      } else {
        entries.unshift(newEntry);
      }

      btn.innerHTML = '<span class="spinner spinner-sm"></span> Đang lưu…';
      const body = buildIssueBody(entries);
      if (issue) { await updateIssueBody(issue.number, body); }
      else       { await createDataIssue(body); }

      showToast('✅ Đã lưu tuần ' + week + ' – ' + total + '/100 điểm', 'success');
      await window.loadPivotScore();

    } catch (err) {
      const msg = err.message || 'Lỗi không xác định';
      if (msg.toLowerCase().includes('bad api key') || msg.includes('API key')) {
        clearFredKey();
        refreshFredBadge();
        showToast('FRED API Key không hợp lệ, đã xóa. Vui lòng nhập lại.', 'error');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      btn.disabled  = false;
      btn.innerHTML = origLabel;
    }
  };

  // ── CSS ─────────────────────────────────────────────────────
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
      '.ps-hist-entry{background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:.8rem;overflow:hidden}',
      '.ps-hist-hdr{padding:.85rem 1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;transition:background .15s;user-select:none}',
      '.ps-hist-hdr:hover{background:rgba(59,130,246,.06)}',
      '.ps-hist-meta{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}',
      '.ps-hist-date{font-weight:700;color:var(--text);font-size:.93rem}',
      '.ps-hist-score{font-size:1.05rem;font-weight:800;color:var(--blue)}',
      '.ps-hist-chev{color:var(--muted);transition:transform .22s;font-size:.75rem}',
      '.ps-hist-body{display:none;padding:0 1.1rem 1.1rem}',
      '.ps-hist-entry.open .ps-hist-body{display:block}',
      '.ps-hist-entry.open .ps-hist-chev{transform:rotate(180deg)}',
      '.ps-key-row{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:1.2rem;min-height:2rem}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Section 1 renderer ──────────────────────────────────────
  function renderSection1(entry) {
    const hasData = !!entry;
    const scores  = hasData ? (entry.scores || {}) : {};

    var reportHtml;
    if (hasData) {
      const pct    = Math.min(100, Math.round(entry.total));
      const action = getAction(entry.total);
      reportHtml = '<div class="ps-report-row">'
        + '<div><div class="ps-bar-label">This week score</div>'
        + '<div class="ps-score-big">' + entry.total + ' <small>/ 100</small></div></div>'
        + '<div class="ps-bar-wrap"><div class="ps-bar-label">Tiến độ</div>'
        + '<div class="ps-bar-bg"><div class="ps-bar-fill" style="width:' + pct + '%"></div></div></div>'
        + '<div><div class="ps-bar-label">Action</div>'
        + '<span class="ps-action-badge ' + action.cls + '">' + action.label + '</span></div>'
        + '</div>';
    } else {
      reportHtml = '<div class="ps-no-data"><span class="ps-no-data-icon">📭</span>Chưa có dữ liệu. Nhấn <strong>Tạo dữ liệu tuần này</strong> để lấy lần đầu.</div>';
    }

    const matrixData = [
      { range: '&lt; 40', cls: 'ps-defend',     action: 'Phòng thủ',    cash: '40–60%', gold: '15–25%', bonds: '15–25% (ngắn hạn)', stocks: '5–10%',  bitcoin: '0–5%',   detail: 'Giữ tiền, tránh risk. Ưu tiên bảo toàn vốn.',            cur: hasData && entry.total < 40 },
      { range: '40–60',  cls: 'ps-build',      action: 'Build vị thế', cash: '25–40%', gold: '15–20%', bonds: '15–20%',             stocks: '15–25%', bitcoin: '5–10%',  detail: 'DCA dần vào market, chưa all-in.',                         cur: hasData && entry.total >= 40 && entry.total <= 60 },
      { range: '60–80',  cls: 'ps-risk',       action: 'Tăng risk',    cash: '10–25%', gold: '10–15%', bonds: '10–15%',             stocks: '30–45%', bitcoin: '10–20%', detail: 'Tăng tốc risk asset, bắt đầu front-run pivot.',            cur: hasData && entry.total > 60 && entry.total <= 80 },
      { range: '&gt; 80', cls: 'ps-aggressive', action: 'Aggressive',   cash: '5–10%',  gold: '5–10%',  bonds: '5–10%',              stocks: '40–55%', bitcoin: '20–35%', detail: 'Risk-on mạnh. BTC + growth stock là driver chính.',        cur: hasData && entry.total > 80 }
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

    var formulaRows = '';
    CRITERIA_DEF.forEach(function(group) {
      const gTotal = group.items.reduce(function(s, item) {
        const d = scores[item.key];
        return s + (d ? (d.score || 0) : 0);
      }, 0);
      formulaRows += '<tr class="ps-group-row"><td colspan="4">' + group.emoji + ' ' + group.group
        + ' <span style="font-weight:400;color:var(--muted);font-size:.79rem;">(tối đa ' + group.groupMax + 'đ'
        + (hasData ? ' — đạt ' + gTotal + 'đ' : '') + ')</span>'
        + (group.note ? '<br><span style="font-size:.78rem;font-weight:400;color:var(--muted);">' + group.note + '</span>' : '')
        + '</td></tr>';
      group.items.forEach(function(item) {
        const d    = scores[item.key];
        const sc   = d != null ? d.score : null;
        const scCls = sc == null ? '' : sc >= item.max ? 'ps-sc-full' : sc > 0 ? 'ps-sc-half' : 'ps-sc-zero';
        const scTxt = sc == null ? '–' : sc + '/' + item.max;
        const levHtml = item.levels.map(function(lv) {
          const active = d != null && d.score === lv.score;
          return '<div class="ps-level' + (active ? ' active' : '') + '">'
            + '<span class="ps-level-pts">' + lv.score + 'đ</span>'
            + '<span>' + lv.label + (active ? ' ✓' : '') + '</span></div>';
        }).join('');
        formulaRows += '<tr><td>' + item.name + '</td>'
          + '<td class="ps-val">' + (d && d.value ? esc(d.value) : '–') + '</td>'
          + '<td><div class="ps-levels">' + levHtml + '</div></td>'
          + '<td class="ps-sc ' + scCls + '">' + scTxt + '</td></tr>';
      });
    });
    const tfoot = hasData
      ? '<tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;border-top:2px solid var(--border);">Tổng điểm</td>'
        + '<td class="ps-sc" style="border-top:2px solid var(--border);font-size:1rem;">' + entry.total + '/100</td></tr></tfoot>'
      : '';

    return '<div class="ps-card">'
      + '<h2>📅 Hiện tại</h2>'
      + '<p class="ps-sub-title">1. Report</p>' + reportHtml
      + '<p class="ps-sub-title" style="margin-top:1.3rem;">2. Matrix action</p>'
      + '<div class="ps-matrix-wrap"><table class="ps-table ps-matrix-table"><thead><tr><th>Pivot score</th><th>Trạng thái</th><th>Cash</th><th>Gold</th><th>Bonds</th><th>Stocks</th><th>Bitcoin</th><th>Action detail</th></tr></thead><tbody>' + matrixRows + '</tbody></table></div>'
      + '<div class="ps-formula-wrap"><p class="ps-sub-title">3. Công thức</p>'
      + '<table class="ps-table"><thead><tr>'
      + '<th style="width:20%;">Tiêu chí</th><th style="width:22%;">Giá trị thực tế</th><th>Thang điểm</th><th style="width:9%;text-align:center;">Điểm</th>'
      + '</tr></thead><tbody>' + formulaRows + '</tbody>' + tfoot + '</table></div>'
      + '</div>';
  }

  // ── Section 2 renderer ──────────────────────────────────────
  function renderSection2(entries) {
    if (!entries.length) {
      return '<div class="ps-card"><h2>📜 Lịch sử</h2><div class="ps-no-data"><span class="ps-no-data-icon">📭</span>Chưa có dữ liệu lịch sử.</div></div>';
    }
    const items = entries.map(function(entry, idx) {
      const action = getAction(entry.total);
      const scores = entry.scores || {};
      const d      = new Date(entry.week + 'T00:00:00');
      const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      var criteriaRows = '';
      CRITERIA_DEF.forEach(function(group) {
        group.items.forEach(function(item) {
          const sc = scores[item.key];
          if (!sc) return;
          const scCls = sc.score >= item.max ? 'ps-sc-full' : sc.score > 0 ? 'ps-sc-half' : 'ps-sc-zero';
          criteriaRows += '<tr><td>' + item.name + '</td>'
            + '<td class="ps-val">' + (sc.value     ? esc(sc.value)     : '–') + '</td>'
            + '<td class="ps-val">' + (sc.condition ? esc(sc.condition) : '–') + '</td>'
            + '<td class="ps-sc ' + scCls + '">' + sc.score + '/' + item.max + '</td></tr>';
        });
      });
      return '<div class="ps-hist-entry' + (idx === 0 ? ' open' : '') + '" id="psh-' + idx + '">'
        + '<div class="ps-hist-hdr" onclick="document.getElementById(\'psh-' + idx + '\').classList.toggle(\'open\')">'
        + '<div class="ps-hist-meta">'
        + '<span class="ps-hist-date">📅 ' + dateStr + '</span>'
        + '<span class="ps-hist-score">' + entry.total + '/100</span>'
        + '<span class="ps-action-badge ' + action.cls + '" style="font-size:.78rem;padding:.2rem .6rem;">' + action.label + '</span>'
        + '</div><span class="ps-hist-chev">▼</span></div>'
        + '<div class="ps-hist-body">'
        + '<table class="ps-table"><thead><tr>'
        + '<th style="width:22%;">Tiêu chí</th><th style="width:25%;">Giá trị</th><th>Đánh giá</th><th style="width:9%;text-align:center;">Điểm</th>'
        + '</tr></thead><tbody>' + criteriaRows + '</tbody>'
        + '<tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;border-top:2px solid var(--border);">Tổng</td>'
        + '<td class="ps-sc" style="border-top:2px solid var(--border);font-size:1rem;">' + entry.total + '/100</td></tr></tfoot>'
        + '</table></div></div>';
    }).join('');
    return '<div class="ps-card"><h2>📜 Lịch sử</h2>' + items + '</div>';
  }

  // ── Main render ─────────────────────────────────────────────
  function renderPivotScore(entries) {
    const latest    = entries[0] || null;
    const hasPAT    = !!getPAT();
    const thisWeek  = getMondayISO();
    const hasThisWk = latest && latest.week === thisWeek;
    const weekLabel = latest
      ? '<span style="font-size:.82rem;font-weight:400;color:var(--muted);margin-left:.3rem;">(Cập nhật: ' + latest.week + ')</span>'
      : '';
    const btnLabel = hasThisWk ? '🔃 Cập nhật tuần này' : '➕ Tạo dữ liệu tuần này';

    document.getElementById('main-content').innerHTML =
      '<div class="page-header">'
      + '<h1><div class="page-icon">🔄</div>Điểm đảo chiều ' + weekLabel + '</h1>'
      + '<div class="header-actions">'
      + '<button class="btn btn-outline btn-sm" onclick="loadPivotScore()">🔄 Tải lại</button>'
      + '<button id="ps-update-btn" class="btn btn-primary btn-sm"'
      + ' onclick="updatePivotData(this)"'
      + (hasPAT ? '' : ' disabled title="Cần GitHub PAT để cập nhật dữ liệu"')
      + '>' + btnLabel + '</button>'
      + '</div></div>'
      + '<div class="ps-key-row" id="ps-fred-badge"></div>'
      + '<div class="ps-sections">'
      + renderSection1(latest)
      + renderSection2(entries)
      + '</div>';

    refreshFredBadge();
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
