// Tiny CSV helpers shared by the FRED and Norges Bank adapters (no quoting needed for these feeds).

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Split into non-empty lines, tolerant of CRLF and a UTF-8 BOM. */
export function csvLines(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** Parse a numeric cell; accepts a decimal comma. null for '.', '', 'NaN' and other non-numbers. */
export function num(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const c = cell.trim().replace(/^"|"$/g, '').replace(',', '.');
  if (c === '' || c === '.') return null;
  const v = Number(c);
  return Number.isFinite(v) ? v : null;
}

export const unquote = (s: string | undefined): string => (s ?? '').trim().replace(/^"|"$/g, '');
