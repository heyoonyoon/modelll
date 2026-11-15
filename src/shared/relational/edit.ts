/**
 * (추가) IE 그림에서 고친 것을 관계 모델 글에 되써 넣는다. 글이 원본이고, IE는 계속 글에서 유도한다.
 *
 *   컬럼 이름 바꾸기: 테이블 줄의 그 컬럼 + 그 테이블의 Foreign Key (컬럼, ...) 목록의 같은 이름
 *                     + 이 테이블을 가리키는 Foreign Key 줄의 references 이테이블 (컬럼, ...) 목록의 같은 이름. 그 컬럼의 설정 키도 옮긴다.
 *   테이블 이름 바꾸기: 테이블 줄의 이름 + 모든 references 옛이름. 그 테이블 컬럼들의 설정 키도 옮긴다.
 *   기본키 켜고 끄기: 테이블 줄의 그 컬럼 이름에 밑줄 서식(UNDERLINE_ATTR)을 긋거나 지운다(전파는 ./keys.ts).
 *
 * 자리는 parseRelational이 준 위치(이름 시작의 줄, 칸)와 같은 규칙의 낱말(lex)로 찾고, 그 낱말만 바꾼다.
 * 글에 오류가 있어도 고칠 낱말을 찾을 수 있으면 고친다. 바꾼 결과에 새 오류가 생기면 고치지 않는다(stillValid).
 * 기본키 켜고 끄기와 키 고르기(planTogglePrimaryKey, planSetKeys)는 기본키 전파 때문에 ./keys.ts로 옮겼다.
 * 새 이름은 cleanName으로 다듬고 필요하면 formatName처럼 큰따옴표로 묶는다. 비교는 nameKey로 한다.
 * 쉼표, 괄호, 큰따옴표, #, 줄바꿈, 화살표(->, →)가 든 이름은 받지 않는다(글이 읽기 어려워진다).
 * 바꾼 이름 글자의 밑줄은 바꾸기 전 이름 첫 글자의 밑줄을 따른다(따옴표에는 긋지 않는다).
 * 테이블과 컬럼, 관계를 더하고 지우는 계획은 ./structure.ts에 있다(같은 RelEditPlan을 쓴다).
 * 테이블 이름을 바꾸거나 테이블을 지우면 IE 자리(ydoc.ts의 ie-positions)도 따라 옮기거나 지운다.
 */
import * as Y from 'yjs';
import { lex, underlineMask, type LexToken } from './lexer';
import { maskToRanges } from './markup';
import { cleanName, nameKey } from './names';
import { columnKey } from './settings';
import { formatName, parseRelational } from './text';
import { getColumnSettingsMap, getIePositionsMap, getRelationalText } from './ydoc';
import { UNDERLINE_ATTR, type RelationalSource, type RelTableDef } from './userSchema';

/** 고칠 수 없는 이유 */
export type RelEditError =
  /** 고칠 테이블의 줄 자체를 읽을 수 없다(괄호를 닫지 않은 것 등). 다른 곳의 오류로는 돌려주지 않는다 */
  | 'text-errors'
  /** 글에서 그 테이블이나 컬럼을 찾지 못했다 */
  | 'not-found'
  /** 빈 이름 */
  | 'empty'
  /** 쓸 수 없는 글자가 들었다 */
  | 'chars'
  /** 같은 이름이 이미 있다 */
  | 'duplicate'
  /** 바꾸면 글에 오류가 생긴다 */
  | 'breaks'
  /** (추가) 여러 컬럼으로 된 외래키라서 이 컬럼만 뺄 수 없다 */
  | 'composite'
  /** (추가) 관계를 맺으려는 부모 테이블에 기본키가 없다 */
  | 'no-primary-key'
  /** (추가) 식별 관계가 고리를 이뤄(자기 자신을 식별 관계로 가리키는 것 포함) 기본키를 끝없이 넓혀야 한다 */
  | 'key-cycle';

/**
 * 글의 한 구간을 바꾼다. underline은 넣는 글자 안에서 밑줄을 그을 구간(없으면 긋지 않음).
 * (추가) underlines는 밑줄을 그을 구간이 여럿일 때 더 적는 구간들이다(넣는 글자 안의 자리).
 */
export interface TextReplace {
  from: number;
  to: number;
  text: string;
  underline: { from: number; to: number } | null;
  underlines?: Array<{ from: number; to: number }>;
}

/** 글 구간의 밑줄을 켜거나 끈다 */
export interface TextFormat {
  from: number;
  to: number;
  on: boolean;
}

/** 설정 키를 옮길 것 */
export type SettingsMove = { kind: 'column'; table: string; from: string; to: string } | { kind: 'table'; from: string; to: string };

/** (추가) 지울 설정. 테이블이면 그 테이블 컬럼들의 설정과 IE 자리를 함께 지운다 */
export type SettingsDrop = { kind: 'column'; table: string; column: string } | { kind: 'table'; table: string };

export type RelEditPlan =
  | { ok: true; replaces: TextReplace[]; formats: TextFormat[]; settings: SettingsMove | null; drops?: SettingsDrop[] }
  | { ok: false; error: RelEditError };

/** 고칠 수 있는 계획 */
export type RelEditOk = Extract<RelEditPlan, { ok: true }>;

export const fail = (error: RelEditError): { ok: false; error: RelEditError } => ({ ok: false, error });
export const NOTHING: RelEditPlan = { ok: true, replaces: [], formats: [], settings: null };

/** 새 이름 확인. 쓸 수 있으면 다듬은 이름 */
export function checkNewName(raw: string): { ok: true; name: string } | { ok: false; error: RelEditError } {
  if (/[\r\n]/.test(raw)) return { ok: false, error: 'chars' };
  const name = cleanName(raw);
  if (name === '') return { ok: false, error: 'empty' };
  if (/[(),"#]/.test(name) || name.includes('->') || name.includes('→')) return { ok: false, error: 'chars' };
  return { ok: true, name };
}

/** 글과 낱말의 자리 찾기 */
export interface Located {
  source: RelationalSource;
  tables: RelTableDef[];
  tokens: LexToken[];
  /** '줄:칸' → 낱말 번호 */
  at: Map<string, number>;
  mask: Uint8Array;
}

/**
 * 글에서 테이블과 낱말의 자리를 찾는다. 글에 오류가 있어도 읽은 부분에서 찾는다(낱말이 그 자리에 있는지는 따로 확인한다).
 * strict면 오류가 하나라도 있을 때 null이다(지금은 쓰는 곳이 없다).
 */
export function locate(source: RelationalSource, strict = false): Located | null {
  const parsed = parseRelational(source);
  if (strict && parsed.problems.some((p) => p.severity === 'error')) return null;
  const tokens = lex(source.text);
  const at = new Map<string, number>();
  tokens.forEach((t, i) => at.set(`${t.line}:${t.column}`, i));
  return { source, tables: parsed.schema.tables, tokens, at, mask: underlineMask(source.text.length, source.underlines) };
}

export function tokenAt(loc: Located, line: number, column: number, name: string): LexToken | null {
  const i = loc.at.get(`${line}:${column}`);
  if (i === undefined) return null;
  const t = loc.tokens[i];
  return t.type === 'name' && nameKey(t.value) === nameKey(name) ? t : null;
}

/** Foreign Key 줄의 낱말들: 이 테이블의 컬럼, 가리키는 테이블, 가리키는 컬럼(적었으면) */
export function foreignKeyTokens(
  loc: Located,
  line: number,
  column: number,
): { start: number; end: number; columns: LexToken[]; ref: LexToken; refColumns: LexToken[] } | null {
  let i = loc.at.get(`${line}:${column}`);
  if (i === undefined) return null;
  const toks = loc.tokens;
  const skipNl = () => {
    while (i! < toks.length && toks[i!].type === 'nl') i!++;
  };
  const start = toks[i].start;
  i += 2; // Foreign Key
  skipNl();
  if (toks[i]?.type !== '(') return null;
  i++;
  const list = (): LexToken[] | null => {
    const out: LexToken[] = [];
    for (;;) {
      skipNl();
      const t = toks[i!];
      if (!t) return null;
      i!++;
      if (t.type === ')') return out;
      if (t.type === 'name') out.push(t);
      else if (t.type !== ',') return null;
    }
  };
  const columns = list();
  if (!columns) return null;
  skipNl();
  if (toks[i]?.type !== 'name' || toks[i].value.toLowerCase() !== 'references') return null;
  i++;
  const ref = toks[i];
  if (ref?.type !== 'name') return null;
  i++;
  let refColumns: LexToken[] = [];
  if (toks[i]?.type === '(') {
    i++;
    const l = list();
    if (!l) return null;
    refColumns = l;
  }
  // 문장의 끝: 가리키는 컬럼 목록을 적었으면 닫는 괄호, 아니면 테이블 이름
  return { start, end: toks[i - 1].end, columns, ref, refColumns };
}

/** 낱말 하나를 새 이름으로 바꾼다(이름 첫 글자의 밑줄을 따른다) */
function replaceToken(loc: Located, t: LexToken, name: string): TextReplace {
  const text = formatName(name);
  const underlined = t.nameEnd > t.nameStart && loc.mask[t.nameStart] === 1;
  const inner = text.startsWith('"') ? { from: 1, to: text.length - 1 } : { from: 0, to: text.length };
  return { from: t.start, to: t.end, text, underline: underlined ? inner : null };
}

/** 계획을 글(밑줄 포함)에 적용한 결과. 화면 밖(확인, 테스트)에서 쓴다 */
export function applyPlanToSource(source: RelationalSource, plan: Extract<RelEditPlan, { ok: true }>): RelationalSource {
  const mask = underlineMask(source.text.length, source.underlines);
  for (const f of plan.formats) mask.fill(f.on ? 1 : 0, f.from, f.to);
  const sorted = [...plan.replaces].sort((a, b) => a.from - b.from);
  let text = '';
  const parts: Uint8Array[] = [];
  let pos = 0;
  for (const r of sorted) {
    text += source.text.slice(pos, r.from) + r.text;
    parts.push(mask.subarray(pos, r.from));
    const m = new Uint8Array(r.text.length);
    if (r.underline) m.fill(1, r.underline.from, r.underline.to);
    for (const u of r.underlines ?? []) m.fill(1, u.from, u.to);
    parts.push(m);
    pos = r.to;
  }
  text += source.text.slice(pos);
  parts.push(mask.subarray(pos));
  const out = new Uint8Array(text.length);
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return { text, underlines: maskToRanges(out) };
}

/** 오류의 종류(메시지 키)별 개수. 자리가 밀려도 같은 오류로 센다 */
function errorCounts(source: RelationalSource): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of parseRelational(source).problems) if (p.severity === 'error') out.set(p.message.key, (out.get(p.message.key) ?? 0) + 1);
  return out;
}

/**
 * 바꾼 글에 새 오류가 생기지 않았는지. 바꾸기 전부터 있던 오류는 따지지 않는다(글의 다른 곳이 틀려도 그림에서 고칠 수 있게).
 * 오류의 종류마다 바꾼 뒤의 개수가 바꾸기 전보다 많지 않아야 한다. 오류가 없던 글이면 바꾼 글에도 오류가 없어야 한다.
 */
export function stillValid(source: RelationalSource, plan: Extract<RelEditPlan, { ok: true }>): boolean {
  const before = errorCounts(source);
  for (const [key, n] of errorCounts(applyPlanToSource(source, plan))) if (n > (before.get(key) ?? 0)) return false;
  return true;
}

export const findTable = (loc: Located, table: string) => loc.tables.find((t) => nameKey(t.name) === nameKey(table));

export function planRenameColumn(source: RelationalSource, table: string, column: string, newName: string): RelEditPlan {
  const checked = checkNewName(newName);
  if (!checked.ok) return fail(checked.error);
  const loc = locate(source);
  if (!loc) return fail('text-errors');
  const def = findTable(loc, table);
  const col = def?.columns.find((c) => nameKey(c.name) === nameKey(column));
  if (!def || !col) return fail('not-found');
  const name = checked.name;
  if (name === col.name) return NOTHING;
  if (def.columns.some((c) => c !== col && nameKey(c.name) === nameKey(name))) return fail('duplicate');
  const head = tokenAt(loc, col.line, col.column, col.name);
  if (!head) return fail('not-found');
  const replaces: TextReplace[] = [replaceToken(loc, head, name)];
  const same = (t: LexToken) => nameKey(t.value) === nameKey(col.name);
  for (const other of loc.tables) {
    for (const fk of other.foreignKeys) {
      const own = other === def;
      const pointsHere = nameKey(fk.refTable) === nameKey(def.name);
      if (!own && !pointsHere) continue;
      const toks = foreignKeyTokens(loc, fk.line, fk.column);
      if (!toks) return fail('not-found');
      if (own) for (const t of toks.columns.filter(same)) replaces.push(replaceToken(loc, t, name));
      if (pointsHere) for (const t of toks.refColumns.filter(same)) replaces.push(replaceToken(loc, t, name));
    }
  }
  const plan: RelEditPlan = { ok: true, replaces, formats: [], settings: { kind: 'column', table: def.name, from: col.name, to: name } };
  return stillValid(source, plan) ? plan : fail('breaks');
}

export function planRenameTable(source: RelationalSource, table: string, newName: string): RelEditPlan {
  const checked = checkNewName(newName);
  if (!checked.ok) return fail(checked.error);
  const loc = locate(source);
  if (!loc) return fail('text-errors');
  const def = findTable(loc, table);
  if (!def) return fail('not-found');
  const name = checked.name;
  if (name === def.name) return NOTHING;
  if (loc.tables.some((t) => t !== def && nameKey(t.name) === nameKey(name))) return fail('duplicate');
  const head = tokenAt(loc, def.line, def.column, def.name);
  if (!head) return fail('not-found');
  const replaces: TextReplace[] = [replaceToken(loc, head, name)];
  for (const other of loc.tables) {
    for (const fk of other.foreignKeys) {
      if (nameKey(fk.refTable) !== nameKey(def.name)) continue;
      const toks = foreignKeyTokens(loc, fk.line, fk.column);
      if (!toks) return fail('not-found');
      replaces.push(replaceToken(loc, toks.ref, name));
    }
  }
  const plan: RelEditPlan = { ok: true, replaces, formats: [], settings: { kind: 'table', from: def.name, to: name } };
  return stillValid(source, plan) ? plan : fail('breaks');
}

/**
 * 밑줄만 켜고 끈다(기본키 전파 없이). 끄면 그 이름 낱말의 밑줄을 모두 지우고, 켜면 이름 글자(따옴표 제외)에 긋는다.
 * 그 테이블 줄을 다시 쓸 수 없을 때(괄호를 닫지 않은 것 등) keys.ts의 planTogglePrimaryKey가 쓴다.
 * 새 오류가 생기면 고치지 않는다('breaks').
 */
export function planToggleUnderline(source: RelationalSource, table: string, column: string): RelEditPlan {
  const loc = locate(source, false);
  if (!loc) return fail('text-errors');
  const def = findTable(loc, table);
  const col = def?.columns.find((c) => nameKey(c.name) === nameKey(column));
  if (!def || !col) return fail('not-found');
  const t = tokenAt(loc, col.line, col.column, col.name);
  if (!t) return fail('not-found');
  const formats: TextFormat[] = col.primaryKey ? [{ from: t.start, to: t.end, on: false }] : [{ from: t.nameStart, to: t.nameEnd, on: true }];
  const plan: RelEditPlan = { ok: true, replaces: [], formats, settings: null };
  return stillValid(source, plan) ? plan : fail('breaks');
}

/** (추가) 외래키가 가리킬 곳. column이 null이면 references 테이블만 적는다(그 테이블의 기본키를 가리킨다) */
export interface ForeignKeyTarget {
  table: string;
  column: string | null;
}

/** 줄 머리(그 줄 첫 글자 자리)와 줄 끝(줄바꿈 자리 또는 글 끝) */
export const lineStartOf = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
export const lineEndOf = (text: string, pos: number) => {
  const nl = text.indexOf('\n', pos);
  return nl < 0 ? text.length : nl;
};

/** 테이블 블록(테이블 줄과 그 테이블의 Foreign Key 줄들)의 마지막 줄 끝. 찾지 못하면 null */
export function tableBlockEnd(loc: Located, def: RelTableDef): number | null {
  const head = loc.at.get(`${def.line}:${def.column}`);
  if (head === undefined) return null;
  let end = -1;
  let depth = 0;
  for (let i = head; i < loc.tokens.length; i++) {
    const t = loc.tokens[i];
    if (t.type === '(') depth++;
    else if (t.type === ')' && --depth === 0) {
      end = t.end;
      break;
    }
  }
  if (end < 0) return null;
  for (const fk of def.foreignKeys) {
    const toks = foreignKeyTokens(loc, fk.line, fk.column);
    if (!toks) return null;
    end = Math.max(end, toks.end);
  }
  return lineEndOf(loc.source.text, end);
}

/** 이 테이블 컬럼들의 설정 키와 컬럼 이름(맞춘 이름) */
function tableSettingKeys(map: Y.Map<unknown>, table: string): Array<[string, string]> {
  const want = nameKey(table);
  const out: Array<[string, string]> = [];
  for (const key of [...map.keys()]) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(key);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed) || parsed[0] !== want || typeof parsed[1] !== 'string') continue;
    out.push([key, parsed[1]]);
  }
  return out;
}

/** 키 하나를 옮긴다. 옛 키에 값이 없는데 새 키에 예전 값이 남아 있으면 지운다 */
function moveKey(map: Y.Map<unknown>, from: string, to: string): void {
  if (from === to) return;
  if (map.has(from)) {
    const v = map.get(from);
    map.delete(from);
    map.set(to, v);
  } else if (map.has(to)) {
    map.delete(to);
  }
}

/** 설정 키 옮기기(한 트랜잭션 안에서 부른다). 테이블이면 IE 자리도 옮긴다 */
function moveSettings(doc: Y.Doc, move: SettingsMove): void {
  const map = getColumnSettingsMap(doc);
  const pairs: Array<[string, string]> = [];
  if (move.kind === 'column') {
    pairs.push([columnKey(move.table, move.from), columnKey(move.table, move.to)]);
  } else {
    for (const [key, column] of tableSettingKeys(map, move.from)) pairs.push([key, columnKey(move.to, column)]);
    moveKey(getIePositionsMap(doc), nameKey(move.from), nameKey(move.to));
  }
  // 옛 이름에 설정이 없었는데 새 이름 자리에 예전 설정이 남아 있으면 지운다(바꾼 컬럼은 설정이 없는 그대로)
  for (const [from, to] of pairs) moveKey(map, from, to);
}

/** (추가) 설정 지우기(한 트랜잭션 안에서 부른다). 테이블이면 그 테이블 컬럼들의 설정과 IE 자리를 지운다 */
function dropSettings(doc: Y.Doc, drop: SettingsDrop): void {
  const map = getColumnSettingsMap(doc);
  if (drop.kind === 'column') {
    map.delete(columnKey(drop.table, drop.column));
    return;
  }
  for (const [key] of tableSettingKeys(map, drop.table)) map.delete(key);
  getIePositionsMap(doc).delete(nameKey(drop.table));
}

/**
 * 계획을 방 문서에 한 트랜잭션으로 적용한다(뒤쪽 자리부터 바꿔 앞의 자리가 밀리지 않게). 팀원에게도 바로 간다.
 * 넣은 글자는 이웃 글자의 밑줄을 물려받지 않고, 계획의 underline 구간에만 밑줄을 긋는다.
 */
export function applyRelationalEdit(doc: Y.Doc, plan: RelEditOk, origin?: unknown): void {
  if (plan.replaces.length === 0 && plan.formats.length === 0 && !plan.settings && !plan.drops?.length) return;
  const ytext = getRelationalText(doc);
  doc.transact(() => {
    for (const f of plan.formats) ytext.format(f.from, f.to - f.from, { [UNDERLINE_ATTR]: f.on ? true : null });
    for (const r of [...plan.replaces].sort((a, b) => b.from - a.from)) {
      ytext.delete(r.from, r.to - r.from);
      ytext.insert(r.from, r.text, { [UNDERLINE_ATTR]: null });
      for (const u of [...(r.underline ? [r.underline] : []), ...(r.underlines ?? [])]) {
        if (u.to > u.from) ytext.format(r.from + u.from, u.to - u.from, { [UNDERLINE_ATTR]: true });
      }
    }
    if (plan.settings) moveSettings(doc, plan.settings);
    for (const d of plan.drops ?? []) dropSettings(doc, d);
  }, origin);
}
