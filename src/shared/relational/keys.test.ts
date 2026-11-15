import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyPlanToSource, applyRelationalEdit, planRenameColumn, planToggleUnderline, type RelEditPlan } from './edit';
import { deriveIe } from './ie';
import {
  countRepairableKeys,
  planAddRelationship,
  planDeleteColumn,
  planDeleteRelationship,
  planRepairKeys,
  planSetIdentifying,
  planSetKeys,
  planTogglePrimaryKey,
} from './keys';
import { planAddColumn } from './structure';
import { fromMarkup, toMarkup } from './markup';
import { columnKey } from './settings';
import { parseRelational } from './text';
import { getColumnSettingsMap, readColumnSettings, readRelationalSource, setColumnSetting, setRelationalSource } from './ydoc';
import type { RelationalSource } from './userSchema';

const src = (markup: string): RelationalSource => fromMarkup(markup);
const lines = (...l: string[]) => l.join('\n');

function ok<T extends RelEditPlan>(plan: T): Extract<T, { ok: true }> {
  if (!plan.ok) throw new Error(`plan failed: ${plan.error}`);
  return plan as Extract<T, { ok: true }>;
}

const errors = (s: RelationalSource) => parseRelational(s).problems.filter((p) => p.severity === 'error');

/** 계획을 적용한 글(일반 텍스트 표기). 오류 없이 읽히는지도 확인한다 */
function run(source: RelationalSource, plan: RelEditPlan): string {
  const next = applyPlanToSource(source, ok(plan));
  expect(errors(next)).toEqual([]);
  return toMarkup(next);
}

// 사용자가 알린 경우: Table1 ← Table2(비식별) ← Table3, Table3은 Table1도 가리킨다
const BUG = lines(
  'Table1 (_id_)',
  'Table2 (_id_, Table1_id)',
  'Foreign Key (Table1_id) references Table1 (id)',
  'Table3 (_id_, Table2_id, Table1_id)',
  'Foreign Key (Table2_id) references Table2 (id)',
  'Foreign Key (Table1_id) references Table1 (id)',
);
const BUG_IDENTIFYING = lines(
  'Table1 (_id_)',
  'Table2 (_id_, _Table1_id_)',
  'Foreign Key (Table1_id) references Table1 (id)',
  'Table3 (_id_, Table2_id, Table1_id, Table2_Table1_id)',
  'Foreign Key (Table2_id, Table2_Table1_id) references Table2 (id, Table1_id)',
  'Foreign Key (Table1_id) references Table1 (id)',
);

describe('식별 관계로 바꾸기(사용자가 알린 경우)', () => {
  it('원인: 예전처럼 밑줄만 바꾸면 Table3이 가리키는 Table2의 기본키가 두 컬럼이 되어 글이 깨졌다. 이제 밑줄만 바꾸는 것도 새 오류면 막는다', () => {
    const source = src(BUG);
    expect(planToggleUnderline(source, 'Table2', 'Table1_id')).toEqual({ ok: false, error: 'breaks' });
  });

  it('식별로 바꾸면 Table2의 새 기본키를 Table3으로 전파한다(이름이 겹치면 부모_컬럼)', () => {
    const source = src(BUG);
    expect(run(source, planSetIdentifying(source, 'Table2', 'Table2#fk1', true))).toBe(BUG_IDENTIFYING);
    const ie = deriveIe(parseRelational(applyPlanToSource(source, ok(planSetIdentifying(source, 'Table2', 0, true)))).schema, {});
    expect(ie.links.map((l) => [l.id, l.identifying, l.columns])).toEqual([
      ['Table2#fk1', true, ['Table1_id']],
      ['Table3#fk1', false, ['Table2_id', 'Table2_Table1_id']],
      ['Table3#fk2', false, ['Table1_id']],
    ]);
  });

  it('다시 비식별로 바꾸면 전파한 컬럼과 그 설정이 빠져 처음 글로 돌아간다. 방 문서에서는 한 번에 되돌린다', () => {
    const doc = new Y.Doc();
    setRelationalSource(doc, src(BUG));
    const origin = { ie: true };
    const undo = new Y.UndoManager([doc.getText('relational-text'), getColumnSettingsMap(doc)], { trackedOrigins: new Set([origin]) });
    applyRelationalEdit(doc, ok(planSetIdentifying(readRelationalSource(doc), 'Table2', 'Table2#fk1', true)), origin);
    expect(toMarkup(readRelationalSource(doc))).toBe(BUG_IDENTIFYING);
    setColumnSetting(doc, 'Table3', 'Table2_Table1_id', { notNull: true });
    undo.stopCapturing();
    applyRelationalEdit(doc, ok(planSetIdentifying(readRelationalSource(doc), 'Table2', 'Table2#fk1', false)), origin);
    expect(toMarkup(readRelationalSource(doc))).toBe(BUG);
    expect(readColumnSettings(doc)).toEqual({});
    undo.undo();
    expect(toMarkup(readRelationalSource(doc))).toBe(BUG_IDENTIFYING);
    undo.undo();
    expect(toMarkup(readRelationalSource(doc))).toBe(BUG);
  });

  it('이미 그렇게 되어 있으면 아무것도 바꾸지 않고, 없는 관계는 not-found', () => {
    const source = src(BUG);
    expect(ok(planSetIdentifying(source, 'Table2', 0, false))).toMatchObject({ replaces: [], formats: [] });
    expect(planSetIdentifying(source, 'Table2', 'Table2#fk2', true)).toEqual({ ok: false, error: 'not-found' });
    expect(planSetIdentifying(source, 'Nope', 0, true)).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('기본키 전파', () => {
  const CHAIN = lines('A (_a_)', 'B (_b_)', 'C (_c_, _b_)', 'Foreign Key (b) references B', 'D (_d_, c, b)', 'Foreign Key (c, b) references C');

  it('사슬: A → B(식별) → C(식별) → D(비식별). B가 A의 식별 자식이 되면 C와 D까지 컬럼이 이어진다', () => {
    const source = src(CHAIN);
    const plan = ok(planAddRelationship(source, 'B', 'A', { identifying: true }));
    expect(plan).toMatchObject({ columns: ['a'], fkIndex: 0 });
    expect(run(source, plan)).toBe(
      lines(
        'A (_a_)',
        'B (_b_, _a_)',
        'Foreign Key (a) references A (a)',
        'C (_c_, _b_, _a_)',
        'Foreign Key (b, a) references B',
        'D (_d_, c, b, a)',
        'Foreign Key (c, b, a) references C',
      ),
    );
    // 거꾸로: 관계와 그 컬럼을 지우면 처음 글로 돌아간다
    const after = applyPlanToSource(source, plan);
    expect(run(after, planDeleteRelationship(after, 'B', 'B#fk1', { dropColumns: true }))).toBe(CHAIN);
  });

  it('기본키 켜고 끄기도 전파한다(되돌리면 처음 글)', () => {
    const source = src(lines('P (_id_, code)', 'C (_c_, id)', 'Foreign Key (id) references P'));
    const plan = ok(planTogglePrimaryKey(source, 'P', 'code'));
    const after = applyPlanToSource(source, plan);
    expect(toMarkup(after)).toBe(lines('P (_id_, _code_)', 'C (_c_, id, code)', 'Foreign Key (id, code) references P'));
    expect(run(after, planTogglePrimaryKey(after, 'P', 'code'))).toBe(toMarkup(source));
    // 마지막 기본키를 끄면 부모에 기본키가 없어 외래키와 그 컬럼이 빠진다
    expect(run(source, planTogglePrimaryKey(source, 'P', 'id'))).toBe(lines('P (id, code)', 'C (_c_)'));
  });

  it('가리키는 컬럼 목록을 적었거나 순서가 기본키와 다르면 목록을 적는다', () => {
    const source = src(lines('P (code, _id_)', 'C (_c_, id)', 'Foreign Key (id) references P'));
    expect(run(source, planTogglePrimaryKey(source, 'P', 'code'))).toBe(lines('P (_code_, _id_)', 'C (_c_, id, code)', 'Foreign Key (id, code) references P (id, code)'));
  });

  it('PK+FK 키 고르기도 전파하고, 여러 컬럼 기본키를 가리키면 나머지 짝을 채운다', () => {
    const source = src(lines('S (_c_, _n_)', 'E (_e_, c)', 'G (_g_, e)', 'Foreign Key (e) references E'));
    expect(run(source, planSetKeys(source, 'E', 'c', { primaryKey: true, foreignKey: true, ref: { table: 'S', column: 'c' } }))).toBe(
      // 식별 관계(c가 기본키)라서 채운 n도 기본키가 되고 G로 이어진다
      lines('S (_c_, _n_)', 'E (_e_, _c_, _n_)', 'Foreign Key (c, n) references S (c, n)', 'G (_g_, e, c, n)', 'Foreign Key (e, c, n) references E'),
    );
    expect(planSetKeys(source, 'E', 'c', { primaryKey: false, foreignKey: true, ref: { table: 'G', column: 'e' } })).toEqual({ ok: false, error: 'breaks' });
    expect(planSetKeys(src('S (x)\nE (_e_, c)'), 'E', 'c', { primaryKey: false, foreignKey: true, ref: { table: 'S', column: null } })).toEqual({
      ok: false,
      error: 'no-primary-key',
    });
  });

  it('컬럼 지우기: 식별 사슬의 기본키 컬럼을 지우면 손자까지 빠진다. 설정도 지운다', () => {
    const doc = new Y.Doc();
    setRelationalSource(doc, src(lines('A (_a_, _k_)', 'B (_b_, _a_, _k_)', 'Foreign Key (a, k) references A', 'C (_c_, b, a, k)', 'Foreign Key (b, a, k) references B')));
    setColumnSetting(doc, 'C', 'k', { type: 'INT' });
    setColumnSetting(doc, 'C', 'c', { type: 'INT' });
    applyRelationalEdit(doc, ok(planDeleteColumn(readRelationalSource(doc), 'A', 'k')));
    expect(toMarkup(readRelationalSource(doc))).toBe(lines('A (_a_)', 'B (_b_, _a_)', 'Foreign Key (a) references A', 'C (_c_, b, a)', 'Foreign Key (b, a) references B'));
    expect(readColumnSettings(doc)).toEqual({ [columnKey('C', 'c')]: { type: 'INT' } });
  });

  it('기본키 컬럼 이름을 바꿔도 가리키는 쪽이 그대로 맞는다', () => {
    const source = src(BUG_IDENTIFYING);
    const next = applyPlanToSource(source, ok(planRenameColumn(source, 'Table2', 'Table1_id', 'parent_id')));
    expect(errors(next)).toEqual([]);
    expect(toMarkup(next).split('\n')[4]).toBe('Foreign Key (Table2_id, Table2_Table1_id) references Table2 (id, parent_id)');
  });

  it('고리: 비식별 고리는 한 번 퍼지고 멈추고, 식별 관계 고리와 식별 자기 관계는 key-cycle', () => {
    const cyc = src(lines('A (_a_, b, x)', 'Foreign Key (b) references B', 'B (_b_, a)', 'Foreign Key (a) references A'));
    expect(run(cyc, planTogglePrimaryKey(cyc, 'A', 'x'))).toBe(lines('A (_a_, b, _x_)', 'Foreign Key (b) references B', 'B (_b_, a, x)', 'Foreign Key (a, x) references A'));
    const one = applyPlanToSource(cyc, ok(planSetIdentifying(cyc, 'A', 0, true)));
    expect(errors(one)).toEqual([]);
    expect(planSetIdentifying(one, 'B', 0, true)).toEqual({ ok: false, error: 'key-cycle' });
    const self = src(lines('Emp (_id_, boss)', 'Foreign Key (boss) references Emp (id)'));
    expect(planSetIdentifying(self, 'Emp', 0, true)).toEqual({ ok: false, error: 'key-cycle' });
    // 비식별 자기 관계는 기본키가 늘면 한 번만 퍼진다
    const self2 = src(lines('Emp (_id_, boss, name)', 'Foreign Key (boss) references Emp (id)'));
    expect(run(self2, planTogglePrimaryKey(self2, 'Emp', 'name'))).toBe(
      lines('Emp (_id_, boss, _name_, Emp_name)', 'Foreign Key (boss, Emp_name) references Emp (id, name)'),
    );
  });

  it('글의 다른 곳에 오류가 있어도 고치고 새 오류는 만들지 않는다. text-errors는 고칠 테이블의 줄을 읽을 수 없을 때만', () => {
    const bad = src(`${BUG}\nX (_y_`);
    for (const plan of [
      planSetIdentifying(bad, 'Table2', 0, true),
      planDeleteColumn(bad, 'Table1', 'id'),
      planAddRelationship(bad, 'Table3', 'Table1', { identifying: true }),
      planDeleteRelationship(bad, 'Table3', 0, { dropColumns: true }),
      planTogglePrimaryKey(bad, 'Table2', 'Table1_id'),
    ]) {
      expect(plan.ok).toBe(true);
      if (plan.ok) expect(errors(applyPlanToSource(bad, plan)).map((p) => p.message.key)).toEqual(['rel.syntax.unclosedParen']);
    }
    // 괄호를 닫지 않은 X 자체는 다시 쓸 수 없다. 기본키 밑줄만은 새 오류가 없으면 바꾼다
    expect(planAddRelationship(bad, 'X', 'Table1', { identifying: false })).toEqual({ ok: false, error: 'text-errors' });
    expect(planTogglePrimaryKey(bad, 'X', 'y').ok).toBe(true);
    const good = src(BUG);
    for (const plan of [
      planSetIdentifying(good, 'Table3', 0, true),
      planTogglePrimaryKey(good, 'Table1', 'id'),
      planDeleteColumn(good, 'Table2', 'id'),
      planAddRelationship(good, 'Table1', 'Table3', { identifying: false }),
      planAddRelationship(good, 'Table3', 'Table2', { identifying: true }),
    ]) {
      expect(plan.ok).toBe(true);
      if (plan.ok) expect(errors(applyPlanToSource(good, plan))).toEqual([]);
    }
  });
});

// 사용자의 방(3yrrqcf2ki)이 지나온 상태. 백업 파일에서 읽었다
const ROOM_1931 = lines(
  'Table1 (_id_, dwqdwq)',
  'Table2 (_id_, _Table1_id_)',
  'Foreign Key (Table1_id) references Table1 (id)',
  'Table3 (_id_, Table2_id, Table1_id)',
  'Foreign Key (Table2_id, Table1_id) references Table2 (id, Table1_id)',
  'Table4 (_id_)',
);
const ROOM_BROKEN = lines(
  'Table1 (_id_, dwqdwq)',
  'Table2 (_id_, Table1_id)',
  'Foreign Key (Table1_id) references Table1 (id)',
  'Table3 (_id_, Table2_id, Table1_id)',
  'Foreign Key (Table2_id, Table1_id) references Table2 (id, Table1_id)',
  'Table4 (_id_)',
);

describe('사용자의 방이 깨진 경위와 되풀이', () => {
  it('원인: 식별 관계(Table2 ← Table3 복합 외래키)에서 Table1_id의 밑줄만 지우면(예전 빌드) 지금의 깨진 글이 된다', () => {
    const source = src(ROOM_1931);
    const at = source.text.indexOf('Table1_id)');
    const underlineOnly = { ok: true as const, replaces: [], formats: [{ from: at, to: at + 'Table1_id'.length, on: false }], settings: null };
    const broken = applyPlanToSource(source, underlineOnly);
    expect(toMarkup(broken)).toBe(ROOM_BROKEN);
    expect(errors(broken).map((p) => p.message.key)).toEqual(['rel.schema.refNotPrimaryKey']);
    // 지금은 같은 동작이 전파된다: Table3의 짝과 컬럼이 빠진다
    expect(run(source, planSetIdentifying(source, 'Table2', 'Table2#fk1', false))).toBe(
      lines('Table1 (_id_, dwqdwq)', 'Table2 (_id_, Table1_id)', 'Foreign Key (Table1_id) references Table1 (id)', 'Table3 (_id_, Table2_id)', 'Foreign Key (Table2_id) references Table2 (id)', 'Table4 (_id_)'),
    );
    expect(planToggleUnderline(source, 'Table2', 'Table1_id')).toEqual({ ok: false, error: 'breaks' });
  });

  for (const [name, start] of [
    ['Table3이 Table1도 따로 가리킬 때', BUG],
    ['Table3이 Table1을 따로 가리키지 않을 때', ROOM_1931],
  ] as const) {
    it(`식별 켜고 끄기를 되풀이해도 늘 맞는 글이고 처음으로 돌아온다(${name}, 되돌리기 포함)`, () => {
      const doc = new Y.Doc();
      setRelationalSource(doc, src(start));
      const origin = { ie: true };
      const undo = new Y.UndoManager([doc.getText('relational-text'), getColumnSettingsMap(doc)], { trackedOrigins: new Set([origin]), captureTimeout: 0 });
      const ident = () => deriveIe(parseRelational(readRelationalSource(doc)).schema, {}).links.find((l) => l.id === 'Table2#fk1')!.identifying;
      const first = ident();
      for (let i = 0; i < 6; i++) {
        applyRelationalEdit(doc, ok(planSetIdentifying(readRelationalSource(doc), 'Table2', 'Table2#fk1', !ident())), origin);
        expect(errors(readRelationalSource(doc))).toEqual([]);
      }
      expect(toMarkup(readRelationalSource(doc))).toBe(start);
      applyRelationalEdit(doc, ok(planSetIdentifying(readRelationalSource(doc), 'Table2', 'Table2#fk1', !first)), origin);
      const flipped = toMarkup(readRelationalSource(doc));
      for (let i = 0; i < 7; i++) {
        undo.undo();
        expect(errors(readRelationalSource(doc))).toEqual([]);
      }
      expect(toMarkup(readRelationalSource(doc))).toBe(start);
      for (let i = 0; i < 7; i++) undo.redo();
      expect(toMarkup(readRelationalSource(doc))).toBe(flipped);
      expect(errors(readRelationalSource(doc))).toEqual([]);
    });
  }
});

describe('오류가 있는 글에서 고치기와 자동으로 맞추기', () => {
  it('깨진 방의 글에서 IE 편집이 모두 된다: 컬럼 더하기, 관계 더하기, 식별로 바꾸기(이어진 외래키는 함께 고친다)', () => {
    let s = src(ROOM_BROKEN);
    const step = (plan: RelEditPlan) => {
      const before = errors(s).length;
      s = applyPlanToSource(s, ok(plan));
      expect(errors(s).length).toBeLessThanOrEqual(before);
    };
    step(planAddColumn(s, 'Table4'));
    step(planAddRelationship(s, 'Table4', 'Table1', { identifying: false }));
    expect(toMarkup(s).split('\n').slice(-2)).toEqual(['Table4 (_id_, column1, Table1_id)', 'Foreign Key (Table1_id) references Table1 (id)']);
    expect(errors(s)).toHaveLength(1);
    // Table2를 건드리면 Table2를 가리키는 Table3의 어긋난 외래키도 맞춘다(식별이면 Table1_id가 다시 기본키라 그대로 맞는다)
    step(planSetIdentifying(s, 'Table2', 'Table2#fk1', true));
    expect(errors(s)).toEqual([]);
    expect(toMarkup(s).split('\n').slice(1, 5)).toEqual([
      'Table2 (_id_, _Table1_id_)',
      'Foreign Key (Table1_id) references Table1 (id)',
      'Table3 (_id_, Table2_id, Table1_id)',
      'Foreign Key (Table2_id, Table1_id) references Table2 (id, Table1_id)',
    ]);
  });

  it('planRepairKeys: 기본키와 어긋난 외래키를 지금 기본키에 맞춘다(전파 규칙과 같다)', () => {
    const source = src(ROOM_BROKEN);
    expect(countRepairableKeys(source)).toBe(1);
    const fixed = applyPlanToSource(source, ok(planRepairKeys(source)));
    expect(toMarkup(fixed)).toBe(
      lines('Table1 (_id_, dwqdwq)', 'Table2 (_id_, Table1_id)', 'Foreign Key (Table1_id) references Table1 (id)', 'Table3 (_id_, Table2_id)', 'Foreign Key (Table2_id) references Table2 (id)', 'Table4 (_id_)'),
    );
    expect(errors(fixed)).toEqual([]);
    expect(countRepairableKeys(fixed)).toBe(0);
    // 목록을 적지 않은 외래키의 개수가 모자라면 빠진 기본키 컬럼을 더한다
    const implicit = src(lines('P (_a_, _b_)', 'C (_c_, x)', 'Foreign Key (x) references P'));
    expect(run(implicit, planRepairKeys(implicit))).toBe(lines('P (_a_, _b_)', 'C (_c_, x, b)', 'Foreign Key (x, b) references P'));
    // 고칠 수 없는 오류(없는 테이블, 기본키 없는 부모)는 그대로 두고 아무것도 바꾸지 않는다
    const unknown = src(lines('C (_c_, x)', 'Foreign Key (x) references Nope', 'Q (a)', 'D (_d_, a)', 'Foreign Key (a) references Q'));
    expect(countRepairableKeys(unknown)).toBe(0);
    expect(ok(planRepairKeys(unknown))).toMatchObject({ replaces: [], formats: [] });
  });

  it('어긋난 외래키의 자식 테이블을 건드리는 동작도 그 외래키를 고친다', () => {
    const source = src(ROOM_BROKEN);
    const next = applyPlanToSource(source, ok(planTogglePrimaryKey(source, 'Table3', 'Table2_id')));
    expect(errors(next)).toEqual([]);
    expect(toMarkup(next).split('\n').slice(3, 5)).toEqual(['Table3 (_id_, _Table2_id_)', 'Foreign Key (Table2_id) references Table2 (id)']);
  });
});
