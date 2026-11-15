/**
 * 관계 모델 편집기의 자동완성 후보. 캐럿 앞의 글을 보고 그 자리에 올 수 있는 이름을 고른다.
 *
 *   Foreign Key (|              지금 테이블의 컬럼
 *   Foreign Key (a) |           references
 *   Foreign Key (a) references |T   테이블 이름
 *   ... references T (|         T의 컬럼(기본키 먼저)
 *   Table (a, |                 다른 테이블의 기본키로 만든 이름(Table1_id)과 이미 쓴 컬럼 이름
 *   줄 맨 앞                     Foreign Key
 */
import { formatName, parseRelational } from '../../shared/relational/text';
import { nameKey } from '../../shared/relational/names';
import type { RelationalSource, RelSchema, RelTableDef } from '../../shared/relational/types';

export interface Completion {
  /** 바꿀 구간(캐럿 앞에 이미 친 글자) */
  from: number;
  to: number;
  items: string[];
}

const WORD_TAIL = /[\p{L}\p{N}_]+$/u;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const MAX_ITEMS = 8;

function tableByName(schema: RelSchema, name: string): RelTableDef | undefined {
  const key = nameKey(name.replace(/^"|"$/g, ''));
  return schema.tables.find((t) => nameKey(t.name) === key);
}

/** 이 줄(1부터)이 속한 테이블: 그 줄이나 그 위에서 마지막으로 시작한 테이블 */
function tableAtLine(schema: RelSchema, line: number): RelTableDef | undefined {
  let found: RelTableDef | undefined;
  for (const t of schema.tables) if (t.line <= line && (!found || t.line >= found.line)) found = t;
  return found;
}

const listed = (list: string) =>
  new Set(
    list
      .split(',')
      .map((s) => nameKey(s.trim().replace(/^"|"$/g, '')))
      .filter(Boolean),
  );

function candidates(schema: RelSchema, before: string, line: number): string[] {
  let m: RegExpMatchArray | null;
  // ... references T (a, |
  if ((m = before.match(/^\s*foreign\s+key\s*\([^)]*\)\s*references\s+("[^"]*"|[^\s(]+)\s*\(([^)]*)$/i))) {
    const table = tableByName(schema, m[1]);
    if (!table) return [];
    const used = listed(m[2]);
    const cols = [...table.columns.filter((c) => c.primaryKey), ...table.columns.filter((c) => !c.primaryKey)];
    return cols.map((c) => c.name).filter((n) => !used.has(nameKey(n)));
  }
  // ... references |
  if (/^\s*foreign\s+key\s*\([^)]*\)\s*references\s+$/i.test(before)) {
    const own = tableAtLine(schema, line);
    const others = schema.tables.filter((t) => t !== own);
    return [...others, ...(own ? [own] : [])].map((t) => t.name);
  }
  // Foreign Key (a) |
  if (/^\s*foreign\s+key\s*\([^)]*\)\s*$/i.test(before)) return ['references'];
  // Foreign Key (a, |
  if ((m = before.match(/^\s*foreign\s+key\s*\(([^)]*)$/i))) {
    const table = tableAtLine(schema, line);
    if (!table) return [];
    const used = listed(m[1]);
    const fkCols = new Set(table.foreignKeys.flatMap((fk) => fk.columns.map(nameKey)));
    const cols = table.columns.map((c) => c.name).filter((n) => !used.has(nameKey(n)));
    // 아직 외래키로 쓰지 않은 컬럼을 먼저
    return [...cols.filter((n) => !fkCols.has(nameKey(n))), ...cols.filter((n) => fkCols.has(nameKey(n)))];
  }
  // 줄 맨 앞
  if (/^\s*$/.test(before)) return ['Foreign Key'];
  // Table (a, |
  if ((m = before.match(/^\s*("[^"]*"|[^\s(]+)\s*\(([^)]*)$/))) {
    const own = tableByName(schema, m[1]);
    const used = listed(m[2]);
    const out: string[] = [];
    for (const t of schema.tables) {
      if (own && t === own) continue;
      for (const c of t.columns) if (c.primaryKey) out.push(`${t.name}_${c.name}`);
    }
    for (const t of schema.tables) for (const c of t.columns) out.push(c.name);
    return out.filter((n) => !used.has(nameKey(n)));
  }
  return [];
}

/** 캐럿 자리의 후보. 고른 구간이 있거나, 낱말 중간이거나, 맞는 후보가 없으면 null */
export function completionAt(source: RelationalSource | string, caret: number, schema?: RelSchema): Completion | null {
  const text = typeof source === 'string' ? source : source.text;
  if (caret < 0 || caret > text.length) return null;
  if (caret < text.length && WORD_CHAR.test(text[caret])) return null;
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const lineBefore = text.slice(lineStart, caret);
  const prefix = lineBefore.match(WORD_TAIL)?.[0] ?? '';
  if (prefix === '') return null;
  const before = lineBefore.slice(0, lineBefore.length - prefix.length);
  const line = text.slice(0, lineStart).split('\n').length;
  const sch = schema ?? parseRelational(source).schema;

  const lower = prefix.toLowerCase();
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of candidates(sch, before, line)) {
    const name = raw === 'Foreign Key' || raw === 'references' ? raw : formatName(raw);
    const key = name.toLowerCase();
    if (seen.has(key) || !key.startsWith(lower) || key === lower) continue;
    seen.add(key);
    items.push(name);
    if (items.length >= MAX_ITEMS) break;
  }
  return items.length > 0 ? { from: caret - prefix.length, to: caret, items } : null;
}
