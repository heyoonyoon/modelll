import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyIeDocument, ieDocumentOf, MAX_IE_TABLES, planIeDocument, readIeDocument, type IeDocument } from './ieDocument';
import { fromMarkup, toMarkup } from './markup';
import { columnKey } from './settings';
import {
  getColumnSettingsMap,
  getIePositionsMap,
  readColumnSettings,
  readIePositions,
  readRelationalSource,
  readRoomDialect,
  setColumnSetting,
  setIePosition,
  setRelationalSource,
} from './ydoc';

const DOC: IeDocument = {
  dialect: 'mysql',
  tables: [
    {
      name: 'Dept',
      x: 40,
      y: 20,
      columns: [
        { name: 'id', pk: true, type: 'INT' },
        { name: 'name', type: 'VARCHAR(50)', notNull: true, unique: true },
      ],
    },
    {
      name: 'Emp',
      columns: [
        { name: 'emp_no', pk: true, type: 'INT' },
        { name: 'dept_id', notNull: false },
        { name: 'first name', type: "ENUM('a','b')" },
      ],
    },
    { name: 'Badge', columns: [{ name: 'emp_no', pk: true }, { name: 'n', pk: true, type: 'INT' }] },
  ],
  relationships: [
    { child: 'Emp', columns: ['dept_id'], parent: 'Dept', parentColumns: ['id'] },
    { child: 'Badge', columns: ['emp_no'], parent: 'Emp' },
  ],
};

function plan(input: unknown) {
  const p = planIeDocument(input);
  if (!p.ok) throw new Error(p.errors.join('\n'));
  return p;
}

function errorsOf(input: unknown): string[] {
  const p = planIeDocument(input);
  if (p.ok) throw new Error('검사를 통과하면 안 된다');
  return p.errors;
}

describe('planIeDocument: 글, 설정, 자리로 옮긴다', () => {
  it('표준 꼴의 관계 모델 글을 적는다(기본키는 밑줄, 따옴표 안만)', () => {
    const p = plan(DOC);
    expect(toMarkup(p.source)).toBe(
      [
        'Dept (_id_, name)',
        'Emp (_emp_no_, dept_id, "first name")',
        'Foreign Key (dept_id) references Dept (id)',
        'Badge (_emp_no_, _n_)',
        'Foreign Key (emp_no) references Emp (emp_no)',
        '',
      ].join('\n'),
    );
    expect(p.settings).toEqual({
      [columnKey('Dept', 'id')]: { type: 'INT' },
      [columnKey('Dept', 'name')]: { type: 'VARCHAR(50)', notNull: true, unique: true },
      [columnKey('Emp', 'emp_no')]: { type: 'INT' },
      [columnKey('Emp', 'dept_id')]: { notNull: false },
      [columnKey('Emp', 'first name')]: { type: "ENUM('a','b')" },
      [columnKey('Badge', 'n')]: { type: 'INT' },
    });
    expect(p.positions).toEqual({ dept: { x: 40, y: 20 } });
    expect(p.dialect).toBe('mysql');
    expect(p.counts).toEqual({ tables: 3, columns: 7, relationships: 2 });
    expect(p.warnings).toEqual([]);
  });

  it('기본키가 없는 테이블은 받되 경고한다. relationships는 빼도 된다', () => {
    const p = plan({ tables: [{ name: 'Log', columns: [{ name: 'msg' }] }] });
    expect(p.warnings).toEqual(['table "Log" has no primary key']);
    expect(p.dialect).toBeNull();
  });
});

describe('planIeDocument: 틀린 문서는 아무것도 쓰지 않는다', () => {
  it('SQL에 끼어들 수 있는 타입 글자를 받지 않는다', () => {
    for (const type of ["VARCHAR(5)'", 'INT; DROP TABLE x', 'TEXT $$', 'INT # c', 'INT -- c', 'TEXT\\', 'INT /* x */', 'A`b', 'INT(3', 'X'.repeat(101), 'INT\nNOT NULL']) {
      const errors = errorsOf({ tables: [{ name: 'T', columns: [{ name: 'a', type }] }] });
      expect(errors[0], type).toMatch(/^tables\[0\]\.columns\[0\]\.type: .* is not accepted: /);
    }
    expect(errorsOf({ tables: [{ name: 'T', columns: [{ name: 'a', type: 5 }] }] })[0]).toMatch(/must be a string/);
  });

  it('겹치는 이름(대소문자 무시), 빈 이름, 모르는 필드', () => {
    expect(errorsOf({ tables: [{ name: 'T', columns: [] }, { name: 't', columns: [] }] })).toEqual(['tables[1].name: duplicate table "t" (names are compared ignoring letter case)']);
    expect(errorsOf({ tables: [{ name: 'T', columns: [{ name: 'A' }, { name: 'a ' }] }] })[0]).toMatch(/duplicate column "a"/);
    expect(errorsOf({ tables: [{ name: '  ', columns: [] }] })).toEqual(['tables[0].name: must not be empty']);
    expect(errorsOf({ tables: [{ name: 'T', columns: [{ name: 'id', primaryKey: true }] }] })[0]).toMatch(/unknown field "primaryKey"/);
    expect(errorsOf({ tables: [{ name: 'T', columns: ['id'] }] })[0]).toMatch(/not a bare string/);
    expect(errorsOf({ table: [] })[0]).toMatch(/unknown field "table"/);
    expect(errorsOf([])).toEqual(['expected a JSON object like { "tables": [...], "relationships": [...] }']);
  });

  it('없는 테이블과 컬럼, 기본키가 없는 부모, 기본키가 아닌 컬럼, 개수가 다른 외래키', () => {
    const base = (relationships: unknown[], parentCols: Array<{ name: string; pk?: boolean }> = [{ name: 'id', pk: true }]) => ({
      tables: [
        { name: 'P', columns: [...parentCols, { name: 'v' }] },
        { name: 'C', columns: [{ name: 'id', pk: true }, { name: 'pid' }, { name: 'pid2' }] },
      ],
      relationships,
    });
    expect(errorsOf(base([{ child: 'C', columns: ['pid'], parent: 'Nope' }]))).toEqual(['relationships[0].parent: no table named "Nope" in tables']);
    expect(errorsOf(base([{ child: 'C', columns: ['zz'], parent: 'P' }]))[0]).toMatch(/table "C" has no column "zz"/);
    expect(errorsOf(base([{ child: 'C', columns: ['pid'], parent: 'P' }], [{ name: 'id' }]))[0]).toMatch(/table "P" has no primary key/);
    expect(errorsOf(base([{ child: 'C', columns: ['pid'], parent: 'P', parentColumns: ['v'] }]))[0]).toMatch(/"v" is not a primary-key column of "P"/);
    expect(errorsOf(base([{ child: 'C', columns: ['pid', 'pid2'], parent: 'P' }]))[0]).toMatch(/has 2 column\(s\) but the primary key of "P" has 1/);
    expect(errorsOf(base([{ child: 'C', columns: ['pid', 'pid'], parent: 'P' }]))[0]).toMatch(/lists the same column twice/);
    // 유도되는 값이 다르면 알린다
    expect(errorsOf(base([{ child: 'C', columns: ['pid'], parent: 'P', identifying: true }]))[0]).toMatch(/identifying: is derived/);
    expect(errorsOf(base([{ child: 'C', columns: ['pid'], parent: 'P', cardinality: '1:1' }]))[0]).toMatch(/unique/);
    expect(plan(base([{ child: 'C', columns: ['pid'], parent: 'P', identifying: false, cardinality: '1:N' }])).counts.relationships).toBe(1);
  });

  it('기본키를 NULL 허용으로, 자리 하나만, 범위를 벗어난 자리, 모르는 DBMS', () => {
    expect(errorsOf({ tables: [{ name: 'T', columns: [{ name: 'id', pk: true, notNull: false }] }] })[0]).toMatch(/primary-key column cannot be NULL/);
    expect(errorsOf({ tables: [{ name: 'T', x: 1, columns: [] }] })[0]).toMatch(/give both x and y/);
    expect(errorsOf({ tables: [{ name: 'T', x: 1, y: 1e9, columns: [] }] })[0]).toMatch(/x and y must be numbers/);
    expect(errorsOf({ dialect: 'sqlite', tables: [] })).toEqual(['dialect: must be postgresql, mysql or oracle']);
  });

  it('너무 큰 문서', () => {
    const tables = Array.from({ length: MAX_IE_TABLES + 1 }, (_, i) => ({ name: `T${i}`, columns: [] }));
    expect(errorsOf({ tables })[0]).toMatch(/too many tables/);
    const wide = { tables: [{ name: 'T', columns: Array.from({ length: 10_001 }, (_, i) => ({ name: `c${i}` })) }] };
    expect(errorsOf(wide)[0]).toMatch(/too many columns/);
  });

  it('오류는 20개까지 알린다', () => {
    const errors = errorsOf({ tables: Array.from({ length: 30 }, () => ({ name: '', columns: [] })) });
    expect(errors).toHaveLength(21);
    expect(errors[20]).toBe('... and 10 more');
  });
});

describe('applyIeDocument와 readIeDocument', () => {
  it('왕복: 쓴 문서를 그대로 읽는다(읽기 전용 값이 붙는다)', () => {
    const doc = new Y.Doc();
    expect(applyIeDocument(doc, plan(DOC), 'api')).toBe(true);
    const { document, problems } = readIeDocument(doc);
    expect(problems).toEqual([]);
    expect(document.dialect).toBe('mysql');
    const strip = ({ box: _box, ...t }: IeDocument['tables'][number]) => ({ ...t, columns: t.columns.map(({ fk: _fk, inheritedType: _it, ...c }) => c) });
    expect(document.tables.map(strip)).toEqual(DOC.tables);
    expect(document.tables[0].box).toMatchObject({ x: 40, y: 20 });
    expect(document.tables[1].box).toEqual({ x: expect.any(Number), y: expect.any(Number), w: expect.any(Number), h: expect.any(Number) });
    expect(document.tables[1].columns[1]).toEqual({ name: 'dept_id', notNull: false, fk: true, inheritedType: 'INT' });
    expect(document.relationships).toEqual([
      { child: 'Emp', columns: ['dept_id'], parent: 'Dept', parentColumns: ['id'], identifying: false, cardinality: '1:N' },
      { child: 'Badge', columns: ['emp_no'], parent: 'Emp', parentColumns: ['emp_no'], identifying: true, cardinality: '1:N' },
    ]);
    // 읽은 문서를 그대로 다시 보내도 바뀌는 것이 없다
    expect(applyIeDocument(doc, plan(document), 'api')).toBe(false);
  });

  it('통째로 바꾼다: 없어진 테이블과 컬럼의 설정, 없어진 자리와 모양이 틀린 키를 지운다. 한 번의 갱신이다', () => {
    const doc = new Y.Doc();
    setRelationalSource(doc, fromMarkup('Old (_id_, x)  # 주석\nDept (_id_)\n'));
    setColumnSetting(doc, 'Old', 'x', { type: 'TEXT' });
    setColumnSetting(doc, 'Dept', 'gone', { unique: true });
    setIePosition(doc, 'Old', { x: 1, y: 2 });
    setIePosition(doc, 'Dept', { x: 5, y: 5 });
    getColumnSettingsMap(doc).set('junk', 1);
    getIePositionsMap(doc).set('Junk', { x: 0, y: 0 });
    let updates = 0;
    doc.on('update', () => updates++);
    applyIeDocument(doc, plan({ tables: [{ name: 'Dept', columns: [{ name: 'id', pk: true, type: 'INT' }] }] }), 'api');
    expect(updates).toBe(1);
    expect(toMarkup(readRelationalSource(doc))).toBe('Dept (_id_)\n');
    expect(readColumnSettings(doc)).toEqual({ [columnKey('Dept', 'id')]: { type: 'INT' } });
    expect([...getColumnSettingsMap(doc).keys()]).toEqual([columnKey('Dept', 'id')]);
    expect(readIePositions(doc)).toEqual({});
    expect([...getIePositionsMap(doc).keys()]).toEqual([]);
    // dialect를 주지 않으면 그대로 둔다
    expect(readRoomDialect(doc)).toBeNull();
  });

  it('글에 오류가 있는 방도 읽은 만큼 주고 문제를 함께 준다', () => {
    const { document, problems } = ieDocumentOf(fromMarkup('A (_id_)\nB (_id_, a_id)\nForeign Key (a_id) references Nope\n'), {}, {}, null);
    expect(document.tables.map((t) => t.name)).toEqual(['A', 'B']);
    expect(document.relationships).toEqual([{ child: 'B', columns: ['a_id'], parent: 'Nope' }]);
    expect(problems.some((p) => p.severity === 'error')).toBe(true);
  });
});
