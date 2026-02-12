/**
 * Parses a raw .pw command string into { command, args }.
 * Handles quoted arguments: fill "Email" "test@example.com"
 * Returns null for empty lines and comments.
 */
export function parseCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const tokens = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
        tokens.push(current);
        current = "";
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  if (tokens.length === 0) return null;

  return { command: tokens[0].toLowerCase(), args: tokens.slice(1) };
}
