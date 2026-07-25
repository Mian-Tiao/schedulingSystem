/* =====================================================================
   common.js — 全站共用小工具(跟 base.css 一樣,原則上不用改)
   ---------------------------------------------------------------------
   提供:
     API_BASE        後端 API 位址(若後端不是跑在 3001,改這一行)
     api(path, opts) 呼叫後端,並統一解析錯誤訊息
     fmtDateTime / fmtMinutes / pct / toLocalInput / fromLocalInput 格式化
     el(tag, attrs, children)  快速建立 DOM 的小工具
     escapeHtml(s)   防止字串被當成 HTML
   各頁面把自己的邏輯寫在該頁的 <script> 裡即可。
   ===================================================================== */

const API_BASE = 'http://localhost:3001/api';

/** 呼叫後端 API;錯誤時 throw 一個帶有中文 message 的 Error */
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 沒有 body */
  }
  if (!res.ok) {
    const err = data && data.error ? data.error : {};
    const e = new Error(err.message || `伺服器發生錯誤(HTTP ${res.status})`);
    e.code = err.code || 'UNKNOWN';
    e.status = res.status;
    e.details = err.details;
    throw e;
  }
  return data;
}

/* ---- 時間 / 數值格式(一律以台北時間顯示)---- */
const TZ = 'Asia/Taipei';

function fmtDateTime(iso) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TZ,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function fmtMinutes(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest > 0 ? `${h} 小時 ${rest} 分` : `${h} 小時`;
  const d = Math.floor(h / 24);
  const restH = h % 24;
  return restH > 0 ? `${d} 天 ${restH} 小時` : `${d} 天`;
}

function pct(v) {
  return `${Math.round(v * 1000) / 10}%`;
}

/** ISO 字串 → <input type="datetime-local"> 需要的值(台北時間) */
function toLocalInput(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** datetime-local 的值(視為台北時間)→ ISO 字串 */
function fromLocalInput(v) {
  return v ? `${v}:00+08:00` : '';
}

/** 防止把使用者輸入直接當成 HTML(避免破版/注入) */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/** 小工具:el('div', {class:'card'}, [子節點或字串]) */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** 簡單的浮動提示(操作成功/失敗) */
function toast(message, kind = 'info') {
  let box = document.getElementById('toast-box');
  if (!box) {
    box = el('div', { id: 'toast-box' });
    box.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:100;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(box);
  }
  const colors = {
    info: '#2563eb',
    success: '#16a34a',
    error: '#dc2626',
    warn: '#d97706',
  };
  const t = el('div', {}, message);
  t.style.cssText = `background:${colors[kind] || colors.info};color:#fff;padding:10px 16px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.2);font-size:14px;max-width:360px;`;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/** 檢查後端是否有連上;連不上時在頁面頂端顯示提醒 */
async function checkBackend() {
  try {
    await api('/health');
    return true;
  } catch {
    const bar = el(
      'div',
      { class: 'banner banner-error' },
      `⚠️ 無法連線到後端(${API_BASE})。請先啟動後端:在 server 資料夾執行 npm run dev,再重新整理此頁。`,
    );
    const container = document.querySelector('.container');
    if (container) container.prepend(bar);
    return false;
  }
}
