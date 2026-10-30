/**
 * CSV serialization (FE-M10) — PURE, RFC 4180 shape, no dependency.
 *
 * Rules:
 * - Records are separated by CRLF and the file ends with a CRLF.
 * - A cell is quoted when it contains a comma, a double quote, CR or LF, or
 *   when it has leading/trailing whitespace; embedded quotes are doubled.
 * - `null` / `undefined` becomes an EMPTY cell. It is never "0": "the backend
 *   did not report this" and "this is zero" are different financial facts.
 *
 * CSV INJECTION GUARD (mandatory — broker symbols and rejection reasons come
 * from outside the terminal). A cell whose first character is a formula
 * trigger is prefixed with an apostrophe so spreadsheet software treats it as
 * text. `=`, `+`, `@`, TAB and CR are always guarded.
 *
 * DELIBERATE DEVIATION for `-`: the blanket rule also covers a leading minus,
 * but a plain negative number is a NUMBER, not a formula, and prefixing it
 * would corrupt every negative P&L value in the export (and turn it into text
 * in Excel). A `-` cell is therefore guarded ONLY when it is not a plain
 * decimal literal, which keeps `-12.34` intact while still defusing
 * `-1+1`, `-cmd|…` and similar payloads. This is recorded in the methodology
 * table and in the milestone docs.
 */

export const CSV_NEWLINE = "\r\n";

/** A cell value as produced by a report builder; `null` = "not reported". */
export type CsvCell = string | null | undefined;

/** Plain decimal literals (optionally negative) are data, not formulas. */
const PLAIN_DECIMAL = /^-?\d+(?:\.\d+)?$/;
const ALWAYS_GUARDED = new Set(["=", "+", "@", "\t", "\r"]);

function needsQuoting(value: string): boolean {
  return /[",\r\n]/.test(value) || value !== value.trim();
}

/** Neutralize a spreadsheet formula trigger. See the module header. */
export function guardInjection(value: string): string {
  const first = value.charAt(0);
  if (first === "") return value;
  if (first === "-") {
    return PLAIN_DECIMAL.test(value) ? value : `'${value}`;
  }
  return ALWAYS_GUARDED.has(first) ? `'${value}` : value;
}

/** One CSV field: injection-guarded, then quoted only when required. */
export function toCsvCell(value: CsvCell): string {
  const raw = value === null || value === undefined ? "" : value;
  const guarded = guardInjection(raw);
  return needsQuoting(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * Serialize a table. `headers` and every row are written in the given order —
 * the column order is part of each report's contract and is never re-sorted.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [headers.map(toCsvCell).join(",")];
  for (const row of rows) lines.push(row.map(toCsvCell).join(","));
  return lines.join(CSV_NEWLINE) + CSV_NEWLINE;
}
