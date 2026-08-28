/**
 * 前端產生 CSV 並觸發下載。加 UTF-8 BOM 讓 Excel 正確顯示中文。
 */

function escapeCell(value: string | number): string {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * 讓 Excel 把值當「純文字」顯示,避免時間欄被當成日期而顯示成 ####(欄寬不足)。
 * 用 Excel 的 ="..." 語法,開啟後即為靠左的完整文字,不需手動加寬欄位。
 */
export function excelText(value: string): string {
  return `="${value.replace(/"/g, '""')}"`;
}

/** rows[0] 通常是標題列 */
export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const body = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 檔名用的時間戳,如 20260907-1530 */
export function fileStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}`;
}
