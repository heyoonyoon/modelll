/**
 * (추가) IE 그림을 JSON 한 덩어리(IeDocument)로 주고받는다. API(/api/rooms/:id/ie), MCP(get_ie_diagram, set_ie_diagram), CLI(modelll ie)가 쓴다.
 * 방에 저장된 세 가지(관계 모델 글, 컬럼 설정, IE 상자 자리)와 DBMS를 한 번에 읽고, 한 트랜잭션으로 통째로 바꾼다.
 *
 *   {
 *     "dialect": "postgresql",                        // 없거나 null이면 바꾸지 않는다
 *     "tables": [
 *       { "name": "Dept", "x": 0, "y": 0,              // x, y는 사람이(또는 AI가) 정한 자리. 없으면 자동 배치
 *         "columns": [ { "name": "id", "pk": true, "type": "INT" }, { "name": "name", "type": "VARCHAR(50)", "notNull": true, "unique": true } ] }
 *     ],
 *     "relationships": [ { "child": "Emp", "columns": ["dept_id"], "parent": "Dept", "parentColumns": ["id"] } ]
 *   }
 *
 * 읽기에만 있는 값(써 보낼 때는 무시한다): 테이블의 box(지금 그려진 자리와 크기), 컬럼의 fk, inheritedType,
 * 맨 위의 problems(글의 문제), room, url, title. 관계의 identifying과 cardinality는 유도한 값이라 써 보낼 때 다르면 오류로 알린다
 * (기본키 표시와 UNIQUE로 정해진다는 것을 알려 주려고).
 *
 * 쓰기는 모두 검사한 뒤에만 한다(일부만 쓰지 않는다). 글은 표준 꼴로 새로 적으므로 사람이 적은 # 주석과 줄 배치는 사라진다.
 * 문서에 없는 테이블과 컬럼의 설정, 문서에 없거나 x, y를 뺀 테이블의 자리는 지운다.
 * 이름은 nameKey로 비교한다(대소문자, 연속 공백을 따지지 않는다). 오류 문장은 영어다(AI와 CLI가 읽는다).
 */
import type * as Y from 'yjs';
import { deriveIe } from './ie';
import { layoutIe } from './layout';
import { cleanName, nameKey } from './names';
import { indexSchema, resolveForeignKey } from './schema';
import { cleanType, columnKey, MAX_TYPE_LENGTH } from './settings';
import { formatName, parseRelational } from './text';
import type { ColumnSetting, ColumnSettings, IePositions, RelationalSource, RelProblem, SqlDialect, TextRange } from './userSchema';
import {
  getColumnSettingsMap,
  getIePositionsMap,
  readColumnSettings,
  readIePositions,
  readRelationalSource,
  readRoomDialect,
  setRelationalSource,
  setRoomDialect,
} from './ydoc';

// ───────────────────────── 모양 ─────────────────────────

export interface IeDocColumn {
  name: string;
  /** 기본키 컬럼(관계 모델 글의 밑줄). 없으면 false */
  pk?: boolean;
  /** SQL 타입. 없으면 미지정 */
  type?: string | null;
  /** true면 NOT NULL, false면 NULL 허용, 없으면 미지정(기본키는 언제나 NOT NULL) */
  notNull?: boolean | null;
  /** true면 UNIQUE */
  unique?: boolean | null;
  /** (읽기 전용) 외래키에 든 컬럼 */
  fk?: boolean;
  /** (읽기 전용) 타입이 없는 외래키 컬럼이 가리키는 컬럼에서 물려받는 타입 */
  inheritedType?: string;
}

export interface IeDocTable {
  name: string;
  /** 상자 왼쪽 위 자리(월드 좌표, px). 둘 다 있거나 둘 다 없다. 없으면 자동 배치 */
  x?: number;
  y?: number;
  columns: IeDocColumn[];
  /** (읽기 전용) 지금 그려진 자리와 크기 */
  box?: { x: number; y: number; w: number; h: number };
}

export interface IeDocRelationship {
  /** 외래키를 가진 테이블 */
  child: string;
  /** child의 외래키 컬럼(순서대로 parentColumns와 짝짓는다) */
  columns: string[];
  /** 가리키는 테이블 */
  parent: string;
  /** parent의 기본키 컬럼. 없으면 parent의 기본키를 적은 순서대로 */
  parentColumns?: string[];
  /** (유도) 외래키 컬럼이 모두 child의 기본키면 true(실선) */
  identifying?: boolean;
  /** (유도) 외래키 컬럼 묶음이 child의 기본키 전체를 품거나 UNIQUE 컬럼을 품으면 '1:1', 아니면 '1:N' */
  cardinality?: '1:1' | '1:N';
}

export interface IeDocument {
  dialect?: SqlDialect | null;
  tables: IeDocTable[];
  relationships: IeDocRelationship[];
}

// ───────────────────────── 제한 ─────────────────────────

export const MAX_IE_TABLES = 500;
/** 모든 테이블의 컬럼 수 합 */
export const MAX_IE_COLUMNS = 10_000;
export const MAX_IE_RELATIONSHIPS = 2000;
/** 테이블과 컬럼 이름의 최대 길이(글자) */
export const MAX_IE_NAME_LENGTH = 128;
/** 상자 자리의 절댓값 한도 */
export const MAX_IE_COORDINATE = 1_000_000;
/** 만들어지는 관계 모델 글의 최대 크기(바이트). 모델 API가 받는 글과 같다 */
export const MAX_IE_TEXT_BYTES = 256 * 1024;
/** 한 번에 알리는 오류 수 */
const MAX_ERRORS = 20;

// ───────────────────────── 읽기 ─────────────────────────

/** 저장된 상태(글, 설정, 자리, DBMS)를 문서 모양으로. problems는 글의 문제(위치는 글 기준) */
export function ieDocumentOf(
  source: RelationalSource,
  settings: ColumnSettings,
  positions: IePositions,
  dialect: SqlDialect | null,
): { document: IeDocument; problems: RelProblem[] } {
  const { schema, problems } = parseRelational(source);
  const index = indexSchema(schema);
  const ie = deriveIe(schema, settings);
  const layout = layoutIe(ie, positions);
  const stored = (table: string, column: string): ColumnSetting => {
    const key = columnKey(table, column);
    return Object.hasOwn(settings, key) ? settings[key] : {};
  };

  const tables: IeDocTable[] = ie.tables.map((t) => {
    const out: IeDocTable = { name: t.name, columns: [] };
    const key = nameKey(t.name);
    if (Object.hasOwn(positions, key)) {
      out.x = positions[key].x;
      out.y = positions[key].y;
    }
    out.columns = t.columns.map((c) => {
      const s = stored(t.name, c.name);
      const col: IeDocColumn = { name: c.name };
      if (c.primaryKey) col.pk = true;
      if (c.type !== null) col.type = c.type;
      if (typeof s.notNull === 'boolean') col.notNull = s.notNull;
      if (typeof s.unique === 'boolean') col.unique = s.unique;
      if (c.foreignKey) col.fk = true;
      if (c.inheritedType !== null) col.inheritedType = c.inheritedType;
      return col;
    });
    const box = layout.tables[t.name];
    if (box) out.box = { x: box.x, y: box.y, w: box.w, h: box.h };
    return out;
  });

  const links = new Map(ie.links.map((l) => [l.id, l]));
  const relationships: IeDocRelationship[] = [];
  for (const table of index.tables) {
    table.def.foreignKeys.forEach((fk, i) => {
      const resolved = resolveForeignKey(index, fk);
      const rel: IeDocRelationship = {
        child: table.def.name,
        columns: [...fk.columns],
        parent: resolved.ok ? resolved.ref.def.name : fk.refTable,
      };
      if (resolved.ok) rel.parentColumns = resolved.refColumns.map((c) => c.name);
      else if (fk.refColumns) rel.parentColumns = [...fk.refColumns];
      const link = links.get(`${table.def.name}#fk${i + 1}`);
      if (link) {
        rel.identifying = link.identifying;
        rel.cardinality = link.child.max === '1' ? '1:1' : '1:N';
      }
      relationships.push(rel);
    });
  }
  return { document: { dialect, tables, relationships }, problems };
}

/** 방 문서에서 읽는다 */
export function readIeDocument(doc: Y.Doc): { document: IeDocument; problems: RelProblem[] } {
  return ieDocumentOf(readRelationalSource(doc), readColumnSettings(doc), readIePositions(doc), readRoomDialect(doc));
}

// ───────────────────────── 검사와 계획 ─────────────────────────

/** 검사를 마친 쓰기 계획. 방에 그대로 맞춘다 */
export interface IeWritePlan {
  source: RelationalSource;
  settings: ColumnSettings;
  positions: IePositions;
  /** null이면 DBMS를 바꾸지 않는다 */
  dialect: SqlDialect | null;
  counts: { tables: number; columns: number; relationships: number };
  /** 받기는 하지만 알릴 것(기본키가 없는 테이블 등) */
  warnings: string[];
}

export type IePlanResult = ({ ok: true } & IeWritePlan) | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const TOP_KEYS = new Set(['dialect', 'tables', 'relationships']);
const TOP_IGNORED = new Set(['room', 'url', 'title', 'problems', 'warnings', 'ok']);
const TABLE_KEYS = new Set(['name', 'x', 'y', 'columns']);
const TABLE_IGNORED = new Set(['box']);
const COLUMN_KEYS = new Set(['name', 'pk', 'type', 'notNull', 'unique']);
const COLUMN_IGNORED = new Set(['fk', 'inheritedType']);
const REL_KEYS = new Set(['child', 'columns', 'parent', 'parentColumns', 'identifying', 'cardinality']);

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** 타입 글자가 왜 안 되는지(cleanType과 같은 규칙) */
function typeProblem(value: string): string {
  if (/[;\\#$`]|--|\/\*|\*\//.test(value)) return 'it contains ; \\ # $ ` -- /* or */, which are not allowed in a type';
  if (/[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(value)) return 'it contains a line break or a control character';
  if ((value.split("'").length - 1) % 2 !== 0 || (value.split('"').length - 1) % 2 !== 0) return 'its quotes are not balanced';
  if (value.trim().length > MAX_TYPE_LENGTH) return `it is longer than ${MAX_TYPE_LENGTH} characters`;
  return 'its parentheses are not balanced';
}

/**
 * 받은 값(JSON에서 읽은 것)을 검사하고 쓰기 계획을 만든다. 하나라도 틀리면 아무것도 쓰지 않도록 오류 목록만 돌려준다.
 * 오류 문장은 'tables[1].columns[0].type: ...' 처럼 자리를 앞에 붙인다.
 */
export function planIeDocument(input: unknown): IePlanResult {
  const errors: string[] = [];
  const err = (path: string, message: string) => {
    errors.push(path ? `${path}: ${message}` : message);
  };
  const done = (): IePlanResult => {
    const shown = errors.slice(0, MAX_ERRORS);
    if (errors.length > MAX_ERRORS) shown.push(`... and ${errors.length - MAX_ERRORS} more`);
    return { ok: false, errors: shown };
  };

  if (!isObj(input)) return { ok: false, errors: ['expected a JSON object like { "tables": [...], "relationships": [...] }'] };
  const unknownKeys = (o: Obj, path: string, keys: Set<string>, ignored: Set<string>) => {
    for (const k of Object.keys(o)) {
      if (!keys.has(k) && !ignored.has(k)) err(path, `unknown field "${k}" (allowed: ${[...keys].join(', ')})`);
    }
  };
  unknownKeys(input, '', TOP_KEYS, TOP_IGNORED);

  let dialect: SqlDialect | null = null;
  if (input.dialect !== undefined && input.dialect !== null) {
    if (input.dialect === 'postgresql' || input.dialect === 'mysql' || input.dialect === 'oracle') dialect = input.dialect;
    else err('dialect', 'must be postgresql, mysql or oracle');
  }

  if (!Array.isArray(input.tables)) {
    err('tables', 'must be an array of tables');
    return done();
  }
  const relsRaw = input.relationships === undefined || input.relationships === null ? [] : input.relationships;
  if (!Array.isArray(relsRaw)) {
    err('relationships', 'must be an array');
    return done();
  }
  if (input.tables.length > MAX_IE_TABLES) err('tables', `too many tables (${input.tables.length}; the limit is ${MAX_IE_TABLES})`);
  if (relsRaw.length > MAX_IE_RELATIONSHIPS) err('relationships', `too many relationships (${relsRaw.length}; the limit is ${MAX_IE_RELATIONSHIPS})`);
  const totalColumns = input.tables.reduce<number>((n, t) => n + (isObj(t) && Array.isArray(t.columns) ? t.columns.length : 0), 0);
  if (totalColumns > MAX_IE_COLUMNS) err('tables', `too many columns in total (${totalColumns}; the limit is ${MAX_IE_COLUMNS})`);
  if (errors.length > 0) return done();

  /** 이름을 검사하고 다듬는다. 틀리면 null */
  const nameOf = (value: unknown, path: string): string | null => {
    if (typeof value !== 'string') {
      err(path, 'must be a string');
      return null;
    }
    const name = cleanName(value);
    if (name === '') err(path, 'must not be empty');
    else if (name.length > MAX_IE_NAME_LENGTH) err(path, `is longer than ${MAX_IE_NAME_LENGTH} characters`);
    else if (/[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(name)) err(path, 'contains a control character');
    else return name;
    return null;
  };
  const optBool = (o: Obj, field: string, path: string): boolean | undefined => {
    const v = o[field];
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'boolean') return v;
    err(`${path}.${field}`, 'must be true, false or omitted');
    return undefined;
  };

  interface Col {
    name: string;
    pk: boolean;
    setting: ColumnSetting;
  }
  interface Table {
    name: string;
    columns: Col[];
    byKey: Map<string, Col>;
    point: { x: number; y: number } | null;
    fks: Array<{ columns: string[]; parent: Table; parentColumns: string[] }>;
  }
  const tables: Table[] = [];
  const tableByKey = new Map<string, Table>();

  input.tables.forEach((raw, ti) => {
    const path = `tables[${ti}]`;
    if (!isObj(raw)) {
      err(path, 'must be an object like { "name": "...", "columns": [...] }');
      return;
    }
    unknownKeys(raw, path, TABLE_KEYS, TABLE_IGNORED);
    const name = nameOf(raw.name, `${path}.name`);
    let point: Table['point'] = null;
    const hasX = raw.x !== undefined && raw.x !== null;
    const hasY = raw.y !== undefined && raw.y !== null;
    if (hasX || hasY) {
      const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_IE_COORDINATE;
      if (!hasX || !hasY) err(path, 'give both x and y, or neither (automatic placement)');
      else if (!ok(raw.x) || !ok(raw.y)) err(path, `x and y must be numbers between -${MAX_IE_COORDINATE} and ${MAX_IE_COORDINATE}`);
      else point = { x: Math.round(raw.x as number), y: Math.round(raw.y as number) };
    }
    if (!Array.isArray(raw.columns)) {
      err(`${path}.columns`, 'must be an array of columns (it may be empty)');
      return;
    }
    const columns: Col[] = [];
    const byKey = new Map<string, Col>();
    raw.columns.forEach((rc, ci) => {
      const cpath = `${path}.columns[${ci}]`;
      if (typeof rc === 'string') {
        err(cpath, 'must be an object like { "name": "id", "pk": true }, not a bare string');
        return;
      }
      if (!isObj(rc)) {
        err(cpath, 'must be an object like { "name": "id", "pk": true }');
        return;
      }
      unknownKeys(rc, cpath, COLUMN_KEYS, COLUMN_IGNORED);
      const cname = nameOf(rc.name, `${cpath}.name`);
      const pk = optBool(rc, 'pk', cpath) === true;
      const setting: ColumnSetting = {};
      if (rc.type !== undefined && rc.type !== null) {
        if (typeof rc.type !== 'string') err(`${cpath}.type`, 'must be a string such as "VARCHAR(50)"');
        else if (rc.type.trim() !== '') {
          const t = cleanType(rc.type);
          if (t === null) err(`${cpath}.type`, `${JSON.stringify(rc.type.slice(0, 60))} is not accepted: ${typeProblem(rc.type)}`);
          else setting.type = t;
        }
      }
      const notNull = optBool(rc, 'notNull', cpath);
      if (notNull !== undefined) {
        if (pk && notNull === false) err(`${cpath}.notNull`, 'a primary-key column cannot be NULL; remove notNull or set it to true');
        setting.notNull = notNull;
      }
      const unique = optBool(rc, 'unique', cpath);
      if (unique !== undefined) setting.unique = unique;
      if (cname === null) return;
      const key = nameKey(cname);
      if (byKey.has(key)) {
        err(`${cpath}.name`, `duplicate column "${cname}" in this table (names are compared ignoring letter case)`);
        return;
      }
      const col = { name: cname, pk, setting };
      byKey.set(key, col);
      columns.push(col);
    });
    if (name === null) return;
    const key = nameKey(name);
    if (tableByKey.has(key)) {
      err(`${path}.name`, `duplicate table "${name}" (names are compared ignoring letter case)`);
      return;
    }
    const table: Table = { name, columns, byKey, point, fks: [] };
    tableByKey.set(key, table);
    tables.push(table);
  });
  if (errors.length > 0) return done();

  /** 이름 목록을 검사한다 */
  const nameList = (value: unknown, path: string): string[] | null => {
    if (!Array.isArray(value) || value.length === 0) {
      err(path, 'must be a non-empty array of column names');
      return null;
    }
    const out: string[] = [];
    value.forEach((v, i) => {
      const n = nameOf(v, `${path}[${i}]`);
      if (n !== null) out.push(n);
    });
    if (out.length !== value.length) return null;
    if (new Set(out.map(nameKey)).size !== out.length) {
      err(path, 'lists the same column twice');
      return null;
    }
    return out;
  };

  relsRaw.forEach((raw, ri) => {
    const path = `relationships[${ri}]`;
    if (!isObj(raw)) {
      err(path, 'must be an object like { "child": "...", "columns": [...], "parent": "...", "parentColumns": [...] }');
      return;
    }
    unknownKeys(raw, path, REL_KEYS, new Set());
    const childName = nameOf(raw.child, `${path}.child`);
    const parentName = nameOf(raw.parent, `${path}.parent`);
    const cols = nameList(raw.columns, `${path}.columns`);
    const pcolsGiven = raw.parentColumns !== undefined && raw.parentColumns !== null;
    const pcols = pcolsGiven ? nameList(raw.parentColumns, `${path}.parentColumns`) : null;
    if (childName === null || parentName === null || cols === null || (pcolsGiven && pcols === null)) return;
    const child = tableByKey.get(nameKey(childName));
    const parent = tableByKey.get(nameKey(parentName));
    if (!child) err(`${path}.child`, `no table named "${childName}" in tables`);
    if (!parent) err(`${path}.parent`, `no table named "${parentName}" in tables`);
    if (!child || !parent) return;
    const childCols: Col[] = [];
    for (const c of cols) {
      const found = child.byKey.get(nameKey(c));
      if (!found) err(`${path}.columns`, `table "${child.name}" has no column "${c}"; add the foreign-key column to that table's columns first`);
      else childCols.push(found);
    }
    const parentKey = parent.columns.filter((c) => c.pk);
    if (parentKey.length === 0) {
      err(`${path}.parent`, `table "${parent.name}" has no primary key; a foreign key must reference the primary key, so mark its key column(s) with "pk": true`);
      return;
    }
    let refCols: Col[] = parentKey;
    if (pcols) {
      const found: Col[] = [];
      for (const c of pcols) {
        const col = parent.byKey.get(nameKey(c));
        if (!col) err(`${path}.parentColumns`, `table "${parent.name}" has no column "${c}"`);
        else if (!col.pk) err(`${path}.parentColumns`, `"${c}" is not a primary-key column of "${parent.name}"; only the primary key (${parentKey.map((k) => k.name).join(', ')}) can be referenced`);
        else found.push(col);
      }
      if (found.length !== pcols.length) return;
      if (found.length !== parentKey.length) {
        err(`${path}.parentColumns`, `must list all ${parentKey.length} primary-key column(s) of "${parent.name}": ${parentKey.map((k) => k.name).join(', ')}`);
        return;
      }
      refCols = found;
    }
    if (childCols.length !== cols.length) return;
    if (childCols.length !== refCols.length) {
      err(`${path}.columns`, `has ${childCols.length} column(s) but the primary key of "${parent.name}" has ${refCols.length} (${refCols.map((k) => k.name).join(', ')})`);
      return;
    }
    // 유도되는 값을 함께 보냈다면 맞는지 본다
    const identifying = childCols.every((c) => c.pk);
    if (raw.identifying !== undefined && raw.identifying !== null) {
      if (typeof raw.identifying !== 'boolean') err(`${path}.identifying`, 'must be true, false or omitted');
      else if (raw.identifying !== identifying) {
        err(
          `${path}.identifying`,
          identifying
            ? 'is derived: these foreign-key columns are all part of the primary key of the child, so the relationship is identifying'
            : 'is derived: mark every foreign-key column of the child "pk": true to make the relationship identifying (or remove this field)',
        );
      }
    }
    const childKey = child.columns.filter((c) => c.pk);
    const one = (childKey.length > 0 && childKey.every((k) => childCols.includes(k))) || childCols.some((c) => c.setting.unique === true);
    if (raw.cardinality !== undefined && raw.cardinality !== null) {
      if (raw.cardinality !== '1:1' && raw.cardinality !== '1:N') err(`${path}.cardinality`, 'must be "1:1", "1:N" or omitted');
      else if ((raw.cardinality === '1:1') !== one) {
        err(
          `${path}.cardinality`,
          one
            ? 'is derived and is 1:1 here, because the foreign-key columns cover the primary key of the child or include a unique column'
            : 'is derived: make it 1:1 by setting "unique": true on the foreign-key column (or by making the foreign-key columns the whole primary key of the child), or remove this field',
        );
      }
    }
    child.fks.push({ columns: childCols.map((c) => c.name), parent, parentColumns: refCols.map((c) => c.name) });
  });
  if (errors.length > 0) return done();

  // 글로 적는다. 기본키 컬럼 이름에 밑줄(따옴표는 빼고)
  let text = '';
  const underlines: TextRange[] = [];
  for (const t of tables) {
    text += `${formatName(t.name)} (`;
    t.columns.forEach((c, i) => {
      if (i > 0) text += ', ';
      const f = formatName(c.name);
      if (c.pk) underlines.push(f.startsWith('"') ? { from: text.length + 1, to: text.length + f.length - 1 } : { from: text.length, to: text.length + f.length });
      text += f;
    });
    text += ')\n';
    for (const fk of t.fks) {
      text += `Foreign Key (${fk.columns.map(formatName).join(', ')}) references ${formatName(fk.parent.name)} (${fk.parentColumns.map(formatName).join(', ')})\n`;
    }
  }
  if (new TextEncoder().encode(text).length > MAX_IE_TEXT_BYTES) {
    return { ok: false, errors: [`the relational model would be larger than ${MAX_IE_TEXT_BYTES / 1024} KB`] };
  }
  const source: RelationalSource = { text, underlines };

  // 적은 글을 다시 읽어 같은 구조가 나오는지 확인한다(표기로 적을 수 없는 이름을 걸러 낸다)
  const parsed = parseRelational(source);
  const parseErrors = parsed.problems.filter((p) => p.severity === 'error');
  const same =
    parsed.schema.tables.length === tables.length &&
    parsed.schema.tables.every((pt, i) => {
      const t = tables[i];
      return (
        pt.name === t.name &&
        pt.columns.length === t.columns.length &&
        pt.columns.every((pc, j) => pc.name === t.columns[j].name && pc.primaryKey === t.columns[j].pk) &&
        pt.foreignKeys.length === t.fks.length
      );
    });
  if (parseErrors.length > 0 || !same) {
    const where = parseErrors[0] ? ` (line ${parseErrors[0].line}: ${text.split('\n')[parseErrors[0].line - 1] ?? ''})` : '';
    return { ok: false, errors: [`a table or column name cannot be written in the relational notation${where}; rename it`] };
  }

  const settings: ColumnSettings = {};
  const positions: IePositions = {};
  const warnings: string[] = [];
  for (const t of tables) {
    if (t.point) positions[nameKey(t.name)] = t.point;
    if (!t.columns.some((c) => c.pk)) warnings.push(`table "${t.name}" has no primary key`);
    for (const c of t.columns) if (Object.keys(c.setting).length > 0) settings[columnKey(t.name, c.name)] = c.setting;
  }
  return {
    ok: true,
    source,
    settings,
    positions,
    dialect,
    counts: { tables: tables.length, columns: totalColumns, relationships: tables.reduce((n, t) => n + t.fks.length, 0) },
    warnings,
  };
}

// ───────────────────────── 쓰기 ─────────────────────────

function snapshot(doc: Y.Doc): string {
  return JSON.stringify([readRelationalSource(doc), readColumnSettings(doc), readIePositions(doc), readRoomDialect(doc)]);
}

/**
 * 계획대로 방을 맞춘다. 한 트랜잭션이라 방에 있는 사람에게는 한 번에 바뀌어 보인다.
 * 설정과 자리는 계획에 없는 키를 모두 지우고(모양이 틀린 키도), 달라진 값만 고친다. 바뀐 것이 있었는지 돌려준다.
 */
export function applyIeDocument(doc: Y.Doc, plan: IeWritePlan, origin?: unknown): boolean {
  const before = snapshot(doc);
  doc.transact(() => {
    setRelationalSource(doc, plan.source, origin);
    const replace = (map: Y.Map<unknown>, want: Record<string, unknown>) => {
      for (const key of [...map.keys()]) if (!Object.hasOwn(want, key)) map.delete(key);
      for (const [key, value] of Object.entries(want)) {
        if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) map.set(key, { ...(value as object) });
      }
    };
    replace(getColumnSettingsMap(doc), plan.settings);
    replace(getIePositionsMap(doc), plan.positions);
    if (plan.dialect) setRoomDialect(doc, plan.dialect, origin);
  }, origin);
  return snapshot(doc) !== before;
}
