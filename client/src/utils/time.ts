/** 時間顯示工具:一律以 Asia/Taipei 呈現 */

const TZ = 'Asia/Taipei';

export function fmtDateTime(iso: string | number | Date): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TZ,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function fmtDate(iso: string | number | Date): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function fmtTime(iso: string | number | Date): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** 分鐘轉為易讀字串,如 90 → 1 小時 30 分 */
export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest > 0 ? `${h} 小時 ${rest} 分` : `${h} 小時`;
  const d = Math.floor(h / 24);
  const restH = h % 24;
  return restH > 0 ? `${d} 天 ${restH} 小時` : `${d} 天`;
}

export function pct(v: number): string {
  return `${Math.round(v * 1000) / 10}%`;
}

/** epoch ms → datetime-local input 值(台北時間) */
export function toLocalInput(iso: string | number | Date): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** datetime-local 值(視為台北時間)→ ISO 字串 */
export function fromLocalInput(v: string): string {
  if (!v) return '';
  return `${v}:00+08:00`;
}
