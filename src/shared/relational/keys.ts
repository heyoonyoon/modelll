/**
 * (추가) 기본키 전파. 관계 모델 글은 IE를 글로 적은 것이고 IE는 글을 그린 것이라, IE에서 하는 보통의 모델링 동작은
 * 글이 어떻게 적혀 있든 막히지 않아야 한다. 그래서 키를 바꾸는 계획은 모두 여기서 모델을 고친 뒤 글에 되써 넣는다.
 *
 * 흐름: 글 → 작은 모델(테이블, 컬럼, 외래키 짝) → 사람이 한 동작 → 전파(propagate) → 바뀐 곳만 글에 고쳐 넣는다.
 *
 * 전파 규칙(ERwin, ERDCloud와 같다)
 *   어떤 테이블의 기본키가 바뀌면 그 테이블을 가리키는 외래키를 모두 새 기본키에 맞춘다.
 *   기본키에 컬럼이 늘면: 자식에 컬럼을 더하고(같은 이름, 겹치면 부모_컬럼, 그래도 겹치면 뒤에 번호) 외래키 목록과 references 목록에 더한다.
 *     그 외래키가 식별 관계(외래키 컬럼이 모두 자식의 기본키)면 더한 컬럼도 자식의 기본키가 되고, 자식을 가리키는 외래키로 계속 전파한다.
 *   기본키에서 컬럼이 빠지면: 그 짝을 외래키에서 빼고 자식의 그 컬럼도 뺀다(그 테이블의 다른 외래키가 쓰면 남긴다).
 *     뺀 컬럼이 자식의 기본키였으면 계속 전파한다. 짝이 하나도 남지 않은 외래키(부모에 기본키가 없어졌다)는 지운다.
 *   식별 관계가 고리를 이루면(자기 자신을 식별 관계로 가리키는 것 포함) 기본키가 끝없이 넓어지므로 고치지 않는다('key-cycle').
 *
 * 글에 오류가 있어도 고친다. 고치기 전부터 있던 오류는 따지지 않고, 새 오류가 생기면 고치지 않는다('breaks', edit.ts의 stillValid).
 *   가리키는 테이블이 없거나 그 테이블에 기본키가 없는 외래키는 그대로 둔다(어떻게 고칠지 알 수 없다).
 *   가리키는 컬럼이 그 테이블의 기본키와 맞지 않는 외래키(기본키가 바뀌었는데 따라오지 않은 것)는 고칠 수 있는 외래키다.
 *     짝은 적은 이름대로(목록을 적지 않았으면 기본키 순서대로) 맞추고, 전파 규칙으로 지금 기본키에 다시 맞춘다:
 *     기본키가 아닌 컬럼을 가리키는 짝은 자식 컬럼과 함께 빼고, 빠진 기본키 컬럼은 짝을 더한다.
 *     고치는 동작이 그 외래키의 자식이나 부모 테이블을 건드리면 함께 고치고, planRepairKeys는 모두 고친다.
 *   'text-errors'는 고칠 테이블의 줄 자체를 읽을 수 없을 때만 돌려준다(괄호를 닫지 않은 것 등).
 *
 * 글 고치기: 지운 컬럼은 붙은 쉼표와 함께 빼고, 더한 컬럼은 괄호 안 끝에, 기본키가 바뀐 컬럼은 밑줄만 바꾼다.
 * 짝이 바뀐 Foreign Key 문장은 그 문장만 새로 적고(가리키는 컬럼 목록을 적었거나 순서가 기본키와 다르면 목록을 적는다),
 * 새 외래키는 자식 블록 아래에 더하고, 지운 외래키는 줄째로 지운다. 바뀌지 않은 테이블과 나머지 글(주석, 줄 배치)은 그대로 둔다.
 * 관계는 자식 테이블과 외래키 번호(그 테이블의 foreignKeys 순서, 0부터) 또는 IE 선의 id('자식#fk1', 1부터)로 가리킨다.
 */
import { nameKey } from './names';
import { indexSchema, resolveForeignKey } from './schema';
import { formatName } from './text';
import {
  fail,
  findTable,
  foreignKeyTokens,
  lineEndOf,
  locate,
  NOTHING,
  planToggleUnderline,
  stillValid,
  tokenAt,
  type ForeignKeyTarget,
  type Located,
  type RelEditOk,
  type RelEditPlan,
  type SettingsDrop,
  type TextFormat,
  type TextReplace,
} from './edit';
import { columnList, Cuts, insertColumns, uniqueName, type Failed } from './structure';
import type { RelationalSource, RelColumnDef, RelForeignKeyDef, RelTableDef } from './userSchema';

/** 관계를 더한 계획. columns는 자식에 더한 컬럼(부모 기본키 순서), fkIndex는 자식 foreignKeys에서 새 외래키의 번호(0부터) */
export type RelAddRelationshipPlan = (RelEditOk & { columns: string[]; fkIndex: number }) | Failed;

// ───────────────────────── 모델 ─────────────────────────

interface MCol {
  name: string;
  pk: boolean;
  /** 글에 있던 컬럼이면 그 정의, 새로 더했으면 null */
  def: RelColumnDef | null;
}

interface MFk {
  /** 짝: columns[i]가 refColumns[i]를 가리킨다 */
  columns: MCol[];
  refColumns: MCol[];
  /** 가리키는 테이블. 글에 없는 테이블을 가리키면 null */
  ref: MTable | null;
  def: RelForeignKeyDef | null;
  /** 가리키는 컬럼 목록을 글에 적었는지(새로 적을 때 따른다) */
  explicit: boolean;
  /** 짝이 바뀌어 문장을 새로 적어야 한다 */
  dirty: boolean;
  /** ok: 맞는 외래키(전파한다), heal: 기본키와 어긋났지만 고칠 수 있다(건드리면 고친다), frozen: 고칠 수 없어 그대로 둔다 */
  state: 'ok' | 'heal' | 'frozen';
}

interface MTable {
  def: RelTableDef;
  columns: MCol[];
  fks: MFk[];
  /** 글에서 뺄 컬럼과 외래키 */
  removedColumns: RelColumnDef[];
  removedFks: RelForeignKeyDef[];
}

interface Model {
  loc: Located;
  tables: MTable[];
  /** 이번 동작이 건드린 테이블. 이 테이블들과 이어진 고칠 수 있는 외래키를 함께 고친다 */
  touched: Set<MTable>;
}

/** 부모에 없는 컬럼을 가리키는 짝의 자리(전파하면 그 짝은 빠진다) */
const ghost = (name: string): MCol => ({ name, pk: false, def: null });

function buildModel(loc: Located): Model {
  const index = indexSchema({ tables: loc.tables });
  const byDef = new Map<RelTableDef, MTable>();
  const colOf = new Map<RelColumnDef, MCol>();
  const tables = loc.tables.map((def) => {
    const t: MTable = { def, columns: [], fks: [], removedColumns: [], removedFks: [] };
    for (const c of def.columns) {
      const m: MCol = { name: c.name, pk: c.primaryKey, def: c };
      colOf.set(c, m);
      t.columns.push(m);
    }
    byDef.set(def, t);
    return t;
  });
  const byName = (t: MTable, name: string) => t.columns.find((c) => nameKey(c.name) === nameKey(name));
  for (const t of tables) {
    for (const fk of t.def.foreignKeys) {
      // 파서는 이 테이블에 있는 컬럼으로 된 외래키만 남긴다
      const columns = fk.columns.map((n) => byName(t, n) ?? ghost(n));
      const explicit = fk.refColumns !== undefined;
      const r = resolveForeignKey(index, fk);
      const base = { columns, def: fk, explicit, dirty: false };
      if (r.ok) {
        t.fks.push({ ...base, refColumns: r.refColumns.map((c) => colOf.get(c)!), ref: byDef.get(r.ref.def)!, state: 'ok' });
      } else if (r.reason === 'unknown-table' || r.reason === 'no-primary-key') {
        t.fks.push({ ...base, refColumns: [], ref: r.reason === 'no-primary-key' ? byDef.get(r.ref.def)! : null, state: 'frozen' });
      } else {
        // 기본키와 어긋난 외래키: 적은 이름대로(목록이 없으면 그 테이블 기본키 순서대로) 짝을 맞춘다
        const parent = byDef.get(r.ref.def)!;
        const pk = parent.columns.filter((c) => c.pk);
        const refColumns = columns.map((_, i) => {
          if (explicit) {
            const name = fk.refColumns![i];
            return name === undefined ? ghost('') : (byName(parent, name) ?? ghost(name));
          }
          return pk[i] ?? ghost('');
        });
        t.fks.push({ ...base, refColumns, ref: parent, state: 'heal' });
      }
    }
  }
  return { loc, tables, touched: new Set() };
}

const tableOf = (m: Model, name: string) => m.tables.find((t) => nameKey(t.def.name) === nameKey(name));
const columnOf = (t: MTable, name: string) => t.columns.find((c) => nameKey(c.name) === nameKey(name));
const pkOf = (t: MTable) => t.columns.filter((c) => c.pk);

function removeColumn(t: MTable, c: MCol): void {
  const i = t.columns.indexOf(c);
  if (i < 0) return;
  t.columns.splice(i, 1);
  if (c.def) t.removedColumns.push(c.def);
}

function removeFk(t: MTable, fk: MFk): void {
  const i = t.fks.indexOf(fk);
  if (i < 0) return;
  t.fks.splice(i, 1);
  if (fk.def) t.removedFks.push(fk.def);
}

/** 자식에 넣을 새 컬럼 이름: 같은 이름, 겹치면 부모_컬럼, 그래도 겹치면 부모_컬럼2, 3, ... */
function migratedName(child: MTable, parent: MTable, col: MCol): string {
  const prefixed = `${parent.def.name}_${col.name}`;
  return uniqueName(new Set(child.columns.map((c) => nameKey(c.name))), [col.name, prefixed], prefixed, 2);
}

/**
 * 맞는 외래키를 모두 가리키는 테이블의 지금 기본키에 맞춘다. 건드린 테이블과 이어진 고칠 수 있는 외래키도 맞는 외래키로 보고 맞춘다.
 * 끝나지 않으면(식별 관계의 고리) 'key-cycle'.
 */
function propagate(m: Model): Failed | null {
  const limit = m.tables.length + 2;
  for (let pass = 0; ; pass++) {
    let changed = false;
    for (const t of m.tables) {
      for (const fk of t.fks) {
        if (fk.state === 'heal' && fk.ref && (m.touched.has(t) || m.touched.has(fk.ref))) {
          fk.state = 'ok';
          fk.dirty = changed = true;
        }
      }
    }
    for (const t of m.tables) {
      for (const fk of [...t.fks]) {
        if (fk.state !== 'ok' || !fk.ref) continue;
        const pk = pkOf(fk.ref);
        // 바꾸기 전에 식별 관계였는지(외래키 컬럼이 모두 자식의 기본키)
        const identifying = fk.columns.length > 0 && fk.columns.every((c) => c.pk);
        const dropped: MCol[] = [];
        const keep: number[] = [];
        fk.columns.forEach((c, i) => {
          if (pk.includes(fk.refColumns[i]) && t.columns.includes(c)) keep.push(i);
          else if (t.columns.includes(c)) dropped.push(c);
        });
        if (keep.length !== fk.columns.length) {
          fk.columns = keep.map((i) => fk.columns[i]);
          fk.refColumns = keep.map((i) => fk.refColumns[i]);
          fk.dirty = changed = true;
          m.touched.add(t);
        }
        for (const p of pk) {
          if (fk.refColumns.includes(p)) continue;
          const c: MCol = { name: migratedName(t, fk.ref, p), pk: identifying, def: null };
          t.columns.push(c);
          fk.columns.push(c);
          fk.refColumns.push(p);
          fk.dirty = changed = true;
          m.touched.add(t);
        }
        if (fk.columns.length === 0) {
          removeFk(t, fk);
          changed = true;
        }
        // 빠진 짝의 자식 컬럼도 뺀다(다른 외래키가 쓰면 남긴다)
        for (const c of dropped) if (!t.fks.some((f) => f.columns.includes(c))) removeColumn(t, c);
      }
    }
    if (!changed) return null;
    if (pass >= limit) return { ok: false, error: 'key-cycle' };
  }
}

// ───────────────────────── 글에 되써 넣기 ─────────────────────────

function sameOrder(a: MCol[], b: MCol[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

function fkText(fk: MFk, ref: MTable): string {
  const list = fk.explicit || !sameOrder(fk.refColumns, pkOf(ref)) ? ` (${fk.refColumns.map((c) => formatName(c.name)).join(', ')})` : '';
  return `Foreign Key (${fk.columns.map((c) => formatName(c.name)).join(', ')}) references ${formatName(ref.def.name)}${list}`;
}

/** 이 테이블이 바뀌었는지(바뀐 테이블만 글에서 고친다) */
function isChanged(t: MTable): boolean {
  return (
    t.removedColumns.length > 0 ||
    t.removedFks.length > 0 ||
    t.columns.some((c) => !c.def || c.pk !== c.def.primaryKey) ||
    t.fks.some((f) => !f.def || f.dirty)
  );
}

/** 모델이 원래 글과 달라진 곳을 계획으로. 새 오류가 생기면 'breaks', 고칠 테이블의 줄을 읽을 수 없으면 'text-errors' */
function emit(m: Model): RelEditOk | Failed {
  const { loc } = m;
  const text = loc.source.text;
  const cuts = new Cuts(text);
  const inserts: TextReplace[] = [];
  const replaces: TextReplace[] = [];
  const formats: TextFormat[] = [];
  const drops: SettingsDrop[] = [];
  for (const t of m.tables) {
    if (!isChanged(t)) continue;
    const list = columnList(loc, t.def);
    if (!list) return fail('text-errors');
    const tok = (c: RelColumnDef) => tokenAt(loc, c.line, c.column, c.name);
    // 뺀 컬럼: 이어진 묶음마다 붙은 쉼표와 함께
    const gone = new Set<number>();
    for (const c of t.removedColumns) {
      const k = tok(c);
      if (!k) return fail('text-errors');
      gone.add(k.start);
    }
    const items = list.items;
    for (let i = 0; i < items.length; ) {
      if (!gone.has(items[i].start)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < items.length && gone.has(items[j + 1].start)) j++;
      if (i > 0) cuts.span(items[i - 1].end, items[j].end);
      else if (j + 1 < items.length) cuts.span(items[i].start, items[j + 1].start);
      else cuts.span(items[i].start, items[j].end);
      i = j + 1;
    }
    for (const c of t.removedColumns) drops.push({ kind: 'column', table: t.def.name, column: c.name });
    // 기본키가 바뀐 컬럼은 밑줄만
    for (const c of t.columns) {
      if (!c.def || c.pk === c.def.primaryKey) continue;
      const k = tok(c.def);
      if (!k) return fail('text-errors');
      formats.push(c.pk ? { from: k.nameStart, to: k.nameEnd, on: true } : { from: k.start, to: k.end, on: false });
    }
    // 더한 컬럼은 남는 마지막 컬럼 뒤에
    const added = t.columns.filter((c) => !c.def);
    if (added.length > 0) {
      const kept = items.filter((x) => !gone.has(x.start));
      const at = kept.length > 0 ? kept[kept.length - 1].end : list.open.end;
      inserts.push(insertColumns(at, kept.length > 0, added));
    }
    // 외래키
    for (const d of t.removedFks) {
      const toks = foreignKeyTokens(loc, d.line, d.column);
      if (!toks) return fail('text-errors');
      cuts.statement(toks.start, toks.end);
    }
    let end = list.close.end;
    const lines: string[] = [];
    for (const fk of t.fks) {
      if (!fk.def) {
        lines.push(fkText(fk, fk.ref!));
        continue;
      }
      const toks = foreignKeyTokens(loc, fk.def.line, fk.def.column);
      if (!toks) {
        if (fk.dirty) return fail('text-errors');
        continue;
      }
      end = Math.max(end, toks.end);
      if (fk.dirty && fk.ref) replaces.push({ from: toks.start, to: toks.end, text: fkText(fk, fk.ref), underline: null });
    }
    if (lines.length > 0) {
      const at = lineEndOf(text, end);
      inserts.push({ from: at, to: at, text: lines.map((l) => `\n${l}`).join(''), underline: null });
    }
  }
  // 넣을 자리가 지울 구간의 시작이면 그 지우기와 합친다(같은 자리의 바꾸기 둘은 적용 순서가 흔들린다)
  const dels = cuts.build();
  const out: TextReplace[] = [...replaces];
  for (const ins of inserts) {
    const hit = dels.find((d) => d.from === ins.from);
    if (hit) Object.assign(hit, { text: ins.text, underline: ins.underline, underlines: ins.underlines });
    else if (dels.some((d) => d.from < ins.from && ins.from < d.to)) return fail('breaks');
    else out.push(ins);
  }
  out.push(...dels);
  const plan: RelEditOk = { ok: true, replaces: out, formats, settings: null };
  if (drops.length > 0) plan.drops = drops;
  return stillValid(loc.source, plan) ? plan : fail('breaks');
}

/** 글을 읽어 모델을 만들고, 동작(act)을 하고, 전파한 뒤 계획으로. act가 실패를 돌려주면 그대로 */
function withModel<T extends object = object>(source: RelationalSource, act: (m: Model) => Failed | T): (RelEditOk & T) | Failed {
  const loc = locate(source);
  if (!loc) return fail('text-errors');
  const m = buildModel(loc);
  const extra = act(m);
  if ('ok' in extra && extra.ok === false) return extra as Failed;
  const stuck = propagate(m);
  if (stuck) return stuck;
  const plan = emit(m);
  return plan.ok ? { ...plan, ...(extra as T) } : plan;
}

// ───────────────────────── 계획 ─────────────────────────

/**
 * 기본키 켜고 끄기. 기본키가 바뀌므로 이 테이블을 가리키는 외래키로 전파한다.
 * 이 테이블 줄을 다시 쓸 수 없으면(괄호를 닫지 않은 것 등) 밑줄만 바꾼다(새 오류가 생기지 않을 때만).
 */
export function planTogglePrimaryKey(source: RelationalSource, table: string, column: string): RelEditPlan {
  const plan = withModel(source, (m) => {
    const t = tableOf(m, table);
    const c = t && columnOf(t, column);
    if (!t || !c) return fail('not-found');
    c.pk = !c.pk;
    m.touched.add(t);
    return {};
  });
  return !plan.ok && plan.error === 'text-errors' ? planToggleUnderline(source, table, column) : plan;
}

/**
 * 컬럼의 키 고르기(없음, PK, FK, PK+FK). 기본키가 바뀌면 전파한다.
 *   FK 켜기: 'Foreign Key (컬럼) references 테이블 [(컬럼)]' 문장을 그 테이블 블록 아래에 더한다(ref 필요).
 *     ref.column이 null이면 가리키는 컬럼 목록을 적지 않는다. 부모 기본키가 여러 컬럼이면 나머지 짝은 전파 규칙대로 더한다.
 *     부모에 기본키가 없으면 'no-primary-key', 기본키가 아닌 컬럼을 가리키면 'breaks'.
 *   FK 끄기: 그 컬럼 하나로 된 외래키 문장을 지운다. 여러 컬럼으로 된 외래키에 들어 있으면 고치지 않는다('composite').
 */
export function planSetKeys(
  source: RelationalSource,
  table: string,
  column: string,
  want: { primaryKey: boolean; foreignKey: boolean; ref?: ForeignKeyTarget },
): RelEditPlan {
  const loose = locate(source);
  if (!loose) return fail('text-errors');
  const def0 = findTable(loose, table);
  const col0 = def0?.columns.find((c) => nameKey(c.name) === nameKey(column));
  if (!def0 || !col0) return fail('not-found');
  const isFk = def0.foreignKeys.some((fk) => fk.columns.some((c) => nameKey(c) === nameKey(column)));
  const pkChange = col0.primaryKey !== want.primaryKey;
  if (isFk === want.foreignKey) return pkChange ? planTogglePrimaryKey(source, table, column) : NOTHING;
  return withModel(source, (m) => {
    const t = tableOf(m, table)!;
    const c = columnOf(t, column)!;
    c.pk = want.primaryKey;
    m.touched.add(t);
    if (want.foreignKey) {
      const ref = want.ref;
      const parent = ref ? tableOf(m, ref.table) : undefined;
      if (!ref || !parent) return fail('not-found');
      const pk = pkOf(parent);
      if (pk.length === 0) return fail('no-primary-key');
      let target = pk[0];
      if (ref.column !== null) {
        const found = columnOf(parent, ref.column);
        if (!found) return fail('not-found');
        if (!found.pk) return fail('breaks');
        target = found;
      }
      t.fks.push({ columns: [c], refColumns: [target], ref: parent, def: null, explicit: ref.column !== null, dirty: false, state: 'ok' });
    } else {
      const own = t.fks.filter((fk) => fk.columns.includes(c));
      if (own.some((fk) => fk.columns.length > 1)) return fail('composite');
      for (const fk of own) removeFk(t, fk);
    }
    return {};
  });
}

/** IE 선의 id('자식#fk1')나 번호(0부터)를 자식 foreignKeys의 번호로 */
function fkIndexOf(fk: number | string): number | null {
  if (typeof fk === 'number') return Number.isInteger(fk) && fk >= 0 ? fk : null;
  const m = /#fk(\d+)$/.exec(fk);
  return m ? Number(m[1]) - 1 : null;
}

function findFk(m: Model, child: string, fk: number | string): { t: MTable; fk: MFk } | null {
  const t = tableOf(m, child);
  const i = fkIndexOf(fk);
  const found = t && i !== null ? t.fks[i] : undefined;
  return t && found ? { t, fk: found } : null;
}

/**
 * (추가) 관계를 식별이나 비식별로 바꾼다: 그 외래키 컬럼들을 자식의 기본키에 넣거나 뺀다. 자식의 기본키가 바뀌므로
 * 자식을 가리키는 외래키로 전파한다(손자 테이블에 컬럼이 더해지거나 빠진다). 이미 그렇게 되어 있으면 아무것도 하지 않는다.
 */
export function planSetIdentifying(source: RelationalSource, child: string, fk: number | string, identifying: boolean): RelEditPlan {
  return withModel(source, (m) => {
    const found = findFk(m, child, fk);
    if (!found) return fail('not-found');
    if (found.fk.columns.every((c) => c.pk === identifying)) return {};
    for (const c of found.fk.columns) c.pk = identifying;
    m.touched.add(found.t);
    return {};
  });
}

/**
 * 컬럼 지우기. 그 컬럼 하나로 된 이 테이블의 외래키는 지우고, 여러 컬럼으로 된 외래키에 들어 있으면 고치지 않는다('composite').
 * 기본키 컬럼이었으면 전파한다: 이 테이블을 가리키는 외래키에서 그 짝과 자식 컬럼이 빠진다(기본키가 다 없어지면 외래키를 지운다).
 * 마지막 컬럼도 뺄 수 있다('T ()'는 맞는 글이다). 지운 컬럼들의 설정도 지운다.
 */
export function planDeleteColumn(source: RelationalSource, table: string, column: string): RelEditPlan {
  return withModel(source, (m) => {
    const t = tableOf(m, table);
    const c = t && columnOf(t, column);
    if (!t || !c) return fail('not-found');
    const own = t.fks.filter((fk) => fk.columns.includes(c));
    if (own.some((fk) => fk.columns.length > 1)) return fail('composite');
    for (const fk of own) removeFk(t, fk);
    removeColumn(t, c);
    m.touched.add(t);
    return {};
  });
}

/**
 * 관계 더하기: 부모의 기본키 컬럼마다 자식에 컬럼을 하나씩 더하고(같은 이름, 겹치면 부모_컬럼, 그래도 겹치면 뒤에 번호),
 * 자식 블록 아래에 'Foreign Key (...) references 부모 (...)' 문장을 더한다. 식별 관계면 더한 컬럼이 자식의 기본키가 되고
 * 자식을 가리키는 외래키로 전파한다. 자기 자신을 식별 관계로 가리키면 'key-cycle', 부모에 기본키가 없으면 'no-primary-key'.
 */
export function planAddRelationship(source: RelationalSource, child: string, parent: string, opts: { identifying: boolean }): RelAddRelationshipPlan {
  let added: MFk | null = null;
  let owner: MTable | null = null;
  const plan = withModel(source, (m) => {
    const c = tableOf(m, child);
    const p = tableOf(m, parent);
    if (!c || !p) return fail('not-found');
    const pk = pkOf(p);
    if (pk.length === 0) return fail('no-primary-key');
    const cols = pk.map((k) => {
      const col: MCol = { name: migratedName(c, p, k), pk: opts.identifying, def: null };
      c.columns.push(col);
      return col;
    });
    added = { columns: cols, refColumns: [...pk], ref: p, def: null, explicit: true, dirty: false, state: 'ok' };
    owner = c;
    c.fks.push(added);
    m.touched.add(c);
    return {};
  });
  if (!plan.ok) return plan;
  const fk = added as MFk | null;
  const t = owner as MTable | null;
  if (!fk || !t) return fail('not-found');
  return { ...plan, columns: fk.columns.map((c) => c.name), fkIndex: t.fks.indexOf(fk) };
}

/**
 * 관계(외래키) 하나를 지운다. fk는 자식 foreignKeys의 번호(0부터) 또는 IE 선의 id(deriveIe의 '자식#fk1').
 * dropColumns면 그 외래키 컬럼도 자식에서 뺀다(그 테이블의 다른 외래키가 쓰는 컬럼은 남긴다).
 * 뺀 컬럼이 자식의 기본키였으면 자식을 가리키는 외래키로 전파한다.
 */
export function planDeleteRelationship(source: RelationalSource, child: string, fk: number | string, opts: { dropColumns: boolean }): RelEditPlan {
  return withModel(source, (m) => {
    const found = findFk(m, child, fk);
    if (!found) return fail('not-found');
    const { t } = found;
    removeFk(t, found.fk);
    if (opts.dropColumns) {
      for (const c of found.fk.columns) if (!t.fks.some((f) => f.columns.includes(c))) removeColumn(t, c);
    }
    m.touched.add(t);
    return {};
  });
}

/** (추가) 기본키와 어긋나 고칠 수 있는 외래키의 수. 그림의 '자동으로 맞추기'를 보일지 정한다 */
export function countRepairableKeys(source: RelationalSource): number {
  const loc = locate(source);
  if (!loc) return 0;
  return buildModel(loc).tables.reduce((n, t) => n + t.fks.filter((f) => f.state === 'heal').length, 0);
}

/**
 * (추가) 기본키와 어긋난 외래키를 모두 지금 기본키에 맞춘다(전파 규칙과 같다). 고칠 것이 없으면 아무것도 바꾸지 않는다.
 * 가리키는 테이블이 없거나 기본키가 없는 외래키, 읽지 못한 줄은 고치지 않는다.
 */
export function planRepairKeys(source: RelationalSource): RelEditPlan {
  return withModel(source, (m) => {
    for (const t of m.tables) if (t.fks.some((f) => f.state === 'heal')) m.touched.add(t);
    return {};
  });
}
