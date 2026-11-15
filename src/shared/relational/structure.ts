/**
 * (추가) IE 그림에서 테이블, 컬럼, 관계를 더하고 지운다. 글이 원본이라 모두 관계 모델 글을 고치는 계획(RelEditPlan)이다.
 * IE만 쓰는 사람도 모델 전체를 만들 수 있게 한다. 적용은 edit.ts의 applyRelationalEdit로 한다.
 *
 *   테이블 더하기: 글 끝에 'Table1 (id)' 줄을 더한다. id에는 밑줄(기본키)을 긋는다. 이름은 겹치지 않게 고른다.
 *   테이블 지우기: 테이블 줄, 그 테이블의 Foreign Key 줄, 다른 테이블에서 이 테이블을 가리키는 Foreign Key 줄을 지운다
 *                  (가리키던 컬럼은 남긴다). 그 테이블 컬럼들의 설정과 IE 자리도 지운다.
 *   컬럼 더하기: 테이블 줄의 괄호 안 끝에 더한다. 이름은 겹치지 않게 고른다(column1, column2, ...).
 *   컬럼 지우기, 관계 더하기와 지우기, 기본키 바꾸기는 기본키 전파가 걸려 있어 ./keys.ts에 있다.
 *
 * 글의 다른 곳에 오류가 있어도 고친다. 고친 글에 새 오류가 생기면 고치지 않는다('breaks', edit.ts의 stillValid).
 * 고칠 테이블의 줄 자체를 읽을 수 없으면(괄호를 닫지 않은 것 등) 'text-errors'다.
 * 빈 글이나 공백뿐인 글에도 테이블을 더할 수 있다.
 * 줄째로 지울 때는 그 줄의 줄바꿈도 함께 지운다. 줄 뒤의 # 주석은 같이 지운다.
 */
import type { LexToken } from './lexer';
import { nameKey } from './names';
import { formatName } from './text';
import {
  checkNewName,
  fail,
  findTable,
  foreignKeyTokens,
  lineEndOf,
  lineStartOf,
  locate,
  stillValid,
  tableBlockEnd,
  tokenAt,
  type Located,
  type RelEditError,
  type RelEditOk,
  type SettingsDrop,
  type TextReplace,
} from './edit';
import type { RelationalSource, RelColumnDef, RelForeignKeyDef, RelTableDef } from './userSchema';

export type Failed = { ok: false; error: RelEditError };

/** 테이블을 더한 계획과 고른 이름 */
export type RelAddTablePlan = (RelEditOk & { table: string }) | Failed;
/** 컬럼을 더한 계획과 고른 이름 */
export type RelAddColumnPlan = (RelEditOk & { column: string }) | Failed;

/** 테이블 줄의 괄호와 컬럼 낱말 */
export function columnList(loc: Located, def: RelTableDef): { open: LexToken; close: LexToken; items: LexToken[] } | null {
  const head = loc.at.get(`${def.line}:${def.column}`);
  if (head === undefined) return null;
  let i = head + 1;
  while (loc.tokens[i]?.type === 'nl') i++;
  const open = loc.tokens[i];
  if (open?.type !== '(') return null;
  const items: LexToken[] = [];
  for (i++; i < loc.tokens.length; i++) {
    const t = loc.tokens[i];
    if (t.type === ')') return { open, close: t, items };
    if (t.type === 'name') items.push(t);
    else if (t.type !== ',' && t.type !== 'nl') return null;
  }
  return null;
}

/** 줄째로 지운 구간인지 표시한 지울 구간 */
interface Cut {
  from: number;
  to: number;
  whole: boolean;
}

/** 지울 구간을 모아 겹치지 않는 바꾸기로 만든다 */
export class Cuts {
  private list: Cut[] = [];
  constructor(private readonly text: string) {}

  /** 문장 하나(테이블 줄, Foreign Key 줄)를 지운다. 그 줄에 문장뿐이면(뒤의 # 주석은 괜찮다) 줄째로 지운다 */
  statement(start: number, end: number): void {
    const text = this.text;
    const ls = lineStartOf(text, start);
    const le = lineEndOf(text, end);
    const after = text.slice(end, le).trim();
    const alone = text.slice(ls, start).trim() === '' && (after === '' || after.startsWith('#'));
    if (alone) this.list.push({ from: ls, to: Math.min(text.length, le + 1), whole: true });
    else this.list.push({ from: start, to: end, whole: false });
  }

  span(from: number, to: number): void {
    if (to > from) this.list.push({ from, to, whole: false });
  }

  build(): TextReplace[] {
    const sorted = [...this.list].sort((a, b) => a.from - b.from);
    const merged: Cut[] = [];
    for (const c of sorted) {
      const last = merged[merged.length - 1];
      if (last && c.from <= last.to) {
        last.to = Math.max(last.to, c.to);
        last.whole = last.whole && c.whole;
      } else merged.push({ ...c });
    }
    // 줄바꿈이 없는 마지막 줄을 줄째로 지웠으면 앞 줄의 줄바꿈을 지운다(글 끝에 빈 줄이 남지 않게)
    const t = this.text;
    for (const m of merged) {
      if (m.whole && m.to === t.length && !t.endsWith('\n') && m.from > 0 && t[m.from - 1] === '\n') m.from--;
    }
    return merged.map((m) => ({ from: m.from, to: m.to, text: '', underline: null }));
  }
}

/** 겹치지 않는 이름. 후보(candidates)가 모두 겹치면 numbered 뒤에 startAt부터 번호를 붙인다 */
export function uniqueName(taken: Set<string>, candidates: string[], numbered: string, startAt: number): string {
  for (const c of candidates) if (!taken.has(nameKey(c))) return c;
  for (let n = startAt; ; n++) {
    const c = `${numbered}${n}`;
    if (!taken.has(nameKey(c))) return c;
  }
}

/** 컬럼 낱말들을 at 자리에 넣는 바꾸기. comma면 앞에 ', '를 붙인다. pk인 컬럼은 이름 글자(따옴표 제외)에 밑줄을 긋는다 */
export function insertColumns(at: number, comma: boolean, cols: ReadonlyArray<{ name: string; pk: boolean }>): TextReplace {
  let text = '';
  const underlines: Array<{ from: number; to: number }> = [];
  cols.forEach((c, i) => {
    if (comma || i > 0) text += ', ';
    const f = formatName(c.name);
    if (c.pk) underlines.push(f.startsWith('"') ? { from: text.length + 1, to: text.length + f.length - 1 } : { from: text.length, to: text.length + f.length });
    text += f;
  });
  return { from: at, to: at, text, underline: null, underlines };
}

export function planAddTable(source: RelationalSource, preferredName?: string): RelAddTablePlan {
  const loc = locate(source);
  if (!loc) return fail('text-errors');
  const taken = new Set(loc.tables.map((t) => nameKey(t.name)));
  let name: string;
  if (preferredName !== undefined) {
    const checked = checkNewName(preferredName);
    if (!checked.ok) return fail(checked.error);
    if (taken.has(nameKey(checked.name))) return fail('duplicate');
    name = checked.name;
  } else name = uniqueName(taken, [], 'Table', 1);
  const text = source.text;
  // 끝의 공백(빈 줄 포함)은 지우고 새 줄 하나로 잇는다
  const from = text.trimEnd().length;
  const head = `${from > 0 ? '\n' : ''}${formatName(name)} (`;
  const line = `${head}id)`;
  const plan: RelEditOk & { table: string } = {
    ok: true,
    replaces: [{ from, to: text.length, text: line, underline: { from: head.length, to: head.length + 2 } }],
    formats: [],
    settings: null,
    table: name,
  };
  return stillValid(source, plan) ? plan : fail('breaks');
}

/** 이 테이블들의 Foreign Key 문장을 지운다. 찾지 못하면 false */
export function cutForeignKeys(loc: Located, cuts: Cuts, fks: Iterable<RelForeignKeyDef>): boolean {
  for (const fk of fks) {
    const toks = foreignKeyTokens(loc, fk.line, fk.column);
    if (!toks) return false;
    cuts.statement(toks.start, toks.end);
  }
  return true;
}

/** 이 테이블을 가리키는 모든 외래키(자기 자신을 가리키는 것 포함) */
export function referencing(loc: Located, def: RelTableDef): RelForeignKeyDef[] {
  return loc.tables.flatMap((t) => t.foreignKeys.filter((fk) => nameKey(fk.refTable) === nameKey(def.name)));
}

/**
 * 테이블 줄 바로 아래(다음 테이블 줄 앞까지)의 Foreign Key 문장들. 파서가 외래키로 남기지 않은 것(없는 컬럼을 적은 것 등)도 든다.
 * 테이블을 지울 때 그 아래 Foreign Key 줄이 앞 테이블에 붙어 버리지 않게 함께 지운다.
 */
function trailingForeignKeys(loc: Located, close: LexToken): Array<{ start: number; end: number }> {
  const toks = loc.tokens;
  const isFkHead = (i: number) =>
    toks[i - 1]?.type === 'nl' && toks[i]?.type === 'name' && !toks[i].quoted && toks[i].value.toLowerCase() === 'foreign' &&
    toks[i + 1]?.type === 'name' && toks[i + 1].value.toLowerCase() === 'key';
  const isTableHead = (i: number) => toks[i - 1]?.type === 'nl' && toks[i]?.type === 'name' && toks[i + 1]?.type === '(' && !isFkHead(i);
  const out: Array<{ start: number; end: number }> = [];
  let i = toks.indexOf(close) + 1;
  for (;;) {
    while (toks[i]?.type === 'nl') i++;
    if (!isFkHead(i)) return out;
    const start = toks[i].start;
    let last = i;
    for (i++; i < toks.length && !isFkHead(i) && !isTableHead(i); i++) if (toks[i].type !== 'nl') last = i;
    out.push({ start, end: toks[last].end });
  }
}

export function planDeleteTable(source: RelationalSource, table: string): RelEditOk | Failed {
  const loc = locate(source);
  if (!loc) return fail('text-errors');
  const def = findTable(loc, table);
  if (!def) return fail('not-found');
  const head = tokenAt(loc, def.line, def.column, def.name);
  const list = columnList(loc, def);
  if (!head || !list) return fail('text-errors');
  const cuts = new Cuts(source.text);
  cuts.statement(head.start, list.close.end);
  for (const fk of trailingForeignKeys(loc, list.close)) cuts.statement(fk.start, fk.end);
  if (!cutForeignKeys(loc, cuts, new Set([...def.foreignKeys, ...referencing(loc, def)]))) return fail('not-found');
  return finish(loc, cuts.build(), [], [{ kind: 'table', table: def.name }]);
}

function finish(loc: Located, replaces: TextReplace[], inserts: TextReplace[], drops: SettingsDrop[]): RelEditOk | Failed {
  const plan: RelEditOk = { ok: true, replaces: [...replaces, ...inserts], formats: [], settings: null };
  if (drops.length > 0) plan.drops = drops;
  return stillValid(loc.source, plan) ? plan : fail('breaks');
}

export function planAddColumn(
  source: RelationalSource,
  table: string,
  preferredName?: string,
): RelAddColumnPlan {
  const loc = locate(source);
  if (!loc) return fail('text-errors');
  const def = findTable(loc, table);
  if (!def) return fail('not-found');
  const list = columnList(loc, def);
  if (!list) return fail('text-errors');
  const taken = new Set(def.columns.map((c) => nameKey(c.name)));
  let name: string;
  if (preferredName !== undefined) {
    const checked = checkNewName(preferredName);
    if (!checked.ok) return fail(checked.error);
    if (taken.has(nameKey(checked.name))) return fail('duplicate');
    name = checked.name;
  } else name = uniqueName(taken, [], 'column', 1);
  const at = list.items.length > 0 ? list.items[list.items.length - 1].end : list.open.end;
  const plan = finish(loc, [], [insertColumns(at, list.items.length > 0, [{ name, pk: false }])], []);
  return plan.ok ? { ...plan, column: name } : plan;
}
