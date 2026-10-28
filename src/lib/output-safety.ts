/**
 * Serializes JSON for an inline <script> element without allowing user-controlled
 * values to terminate the element. JSON.stringify alone does not escape </script>.
 */
export function serializeJsonForHtmlScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Prevents spreadsheet applications from treating exported user data as a formula. */
export function neutralizeSpreadsheetFormula(value: unknown) {
  const text = String(value ?? "");
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function csvCell(value: unknown) {
  return `"${neutralizeSpreadsheetFormula(value).replace(/"/g, '""')}"`;
}
