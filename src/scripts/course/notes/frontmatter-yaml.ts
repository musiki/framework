// Pure helpers for leading YAML frontmatter: locate the block and tokenize its lines.
// No CodeMirror imports so this stays unit-testable under node --test.

export type YamlTokenKind = 'key' | 'string' | 'number' | 'bool' | 'comment' | 'punct';
export interface YamlToken { from: number; to: number; kind: YamlTokenKind }

/** Offsets of the leading `---` ... `---` block, or null. `end` is the end of the closing delimiter line. */
export const FRONTMATTER_HEAD_CAP = 20000;

/** Like the above but requires >=1 `key:` line (so an opening horizontal rule isn't styled as YAML). Scans only the first FRONTMATTER_HEAD_CAP chars. */
export function findFrontmatter(fullDoc: string): { start: number; end: number; closeFrom: number } | null {
  const fm = findFrontmatterRaw(fullDoc.length > FRONTMATTER_HEAD_CAP ? fullDoc.slice(0, FRONTMATTER_HEAD_CAP) : fullDoc);
  if (!fm) return null;
  const body = fullDoc.slice(0, fm.closeFrom).split(/\r?\n/).slice(1);
  for (const l of body) {
    if (tokenizeYamlLine(l).some(t => t.kind === 'key')) return fm;
  }
  return null;
}

function findFrontmatterRaw(doc: string): { start: number; end: number; closeFrom: number } | null {
  if (!/^---[ \t]*(\r?\n|$)/.test(doc)) return null;
  const re = /\r?\n(---|\.\.\.)[ \t]*(?=\r?\n|$)/g;
  const open = doc.indexOf('\n');
  if (open < 0) return null;
  re.lastIndex = open;
  const m = re.exec(doc);
  if (!m) return null;
  const closeFrom = m.index + (m[0].startsWith('\r') ? 2 : 1);
  return { start: 0, end: m.index + m[0].length, closeFrom };
}

const SCALAR_NUMBER = /^[-+]?(\d[\d_]*(\.\d+)?([eE][-+]?\d+)?|\.\d+|0x[0-9a-fA-F]+|\d{4}-\d{2}-\d{2}([Tt ][\d:.]+(Z|[-+]\d{2}:?\d{2})?)?)$/;
const SCALAR_BOOL = /^(true|false|yes|no|on|off|null|~)$/i;

function scalarTokens(text: string, offset: number, out: YamlToken[]) {
  const lead = text.length - text.trimStart().length;
  const body = text.trim();
  if (!body) return;
  const from = offset + lead;
  // trailing comment: " #..." outside quotes
  let valueEnd = body.length;
  let quote = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === '\\' && quote === '"') i++; else if (c === quote) quote = ''; continue; }
    if ((c === '"' || c === "'") && (i === 0 || /[\s\[{,:]/.test(body[i - 1]))) { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(body[i - 1]))) { valueEnd = i; break; }
  }
  if (valueEnd < body.length) out.push({ from: from + valueEnd, to: from + body.length, kind: 'comment' });
  const value = body.slice(0, valueEnd).trimEnd();
  if (!value) return;
  const kind: YamlTokenKind | null =
    /^(["']).*\1$/.test(value) || /^["']/.test(value) ? 'string'
    : SCALAR_NUMBER.test(value) ? 'number'
    : SCALAR_BOOL.test(value) ? 'bool'
    : null;
  if (kind) { out.push({ from, to: from + value.length, kind }); return; }
  // flow sequences like [a, 1, "b"]
  if (/^[\[{]/.test(value)) {
    const re = /"(?:[^"\\]|\\.)*"?|'[^']*'?|[-+]?\d[\w.:+-]*|\b(?:true|false|null)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      const t = m[0];
      const k: YamlTokenKind = /^["']/.test(t) ? 'string' : SCALAR_BOOL.test(t) ? 'bool' : SCALAR_NUMBER.test(t) ? 'number' : 'string';
      if (k === 'string' && !/^["']/.test(t)) continue;
      out.push({ from: from + m.index, to: from + m.index + t.length, kind: k });
    }
  }
}

/** Tokenize one YAML line (tokens sorted by `from`, non-overlapping); offsets are relative to `lineStart`. */
export function tokenizeYamlLine(line: string, lineStart = 0): YamlToken[] {
  const out = tokenizeRaw(line, lineStart).sort((a, b) => a.from - b.from || a.to - b.to);
  const clean: YamlToken[] = [];
  for (const t of out) if (t.to > t.from && (!clean.length || t.from >= clean[clean.length - 1].to)) clean.push(t);
  return clean;
}

function tokenizeRaw(line: string, lineStart = 0): YamlToken[] {
  const out: YamlToken[] = [];
  if (/^\s*#/.test(line)) {
    const lead = line.length - line.trimStart().length;
    return [{ from: lineStart + lead, to: lineStart + line.length, kind: 'comment' }];
  }
  const m = /^(\s*(?:-\s+)*)((?:"[^"]*"|'[^']*'|[^\s:#'"\[{][^:#]*?))(\s*:)(?=\s|$)(.*)$/.exec(line);
  if (m) {
    const keyFrom = lineStart + m[1].length;
    const bullets = m[1].match(/-\s+/g);
    if (bullets) {
      let p = lineStart + m[1].indexOf('-');
      for (const b of bullets) { const i = m[1].indexOf(b, p - lineStart); out.push({ from: lineStart + i, to: lineStart + i + 1, kind: 'punct' }); p = lineStart + i + b.length; }
    }
    out.push({ from: keyFrom, to: keyFrom + m[2].length, kind: 'key' });
    out.push({ from: keyFrom + m[2].length + (m[3].length - 1), to: keyFrom + m[2].length + m[3].length, kind: 'punct' });
    scalarTokens(m[4], lineStart + line.length - m[4].length, out);
    return out;
  }
  const item = /^(\s*-\s+)(.*)$/.exec(line);
  if (item) {
    const d = item[1].indexOf('-');
    out.push({ from: lineStart + d, to: lineStart + d + 1, kind: 'punct' });
    scalarTokens(item[2], lineStart + item[1].length, out);
    return out;
  }
  scalarTokens(line, lineStart, out);
  return out;
}
