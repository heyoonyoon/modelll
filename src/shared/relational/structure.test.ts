import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyPlanToSource, applyRelationalEdit, planRenameTable, type RelEditPlan } from './edit';
import { deriveIe } from './ie';
import { fromMarkup, toMarkup } from './markup';
import { columnKey } from './settings';
import { planAddRelationship, planDeleteColumn, planDeleteRelationship } from './keys';
import { planAddColumn, planAddTable, planDeleteTable } from './structure';
import { parseRelational } from './text';
import { readColumnSettings, readIePositions, readRelationalSource, setColumnSetting, setIePosition, setRelationalSource } from './ydoc';
import type { RelationalSource } from './userSchema';

const MODEL = [
  '학과 (_학과코드_, 학과명)',
  '학생 (_학번_, 이름, 학과코드)',
  'Foreign Key (학과코드) references 학과 (학과코드)',
  '수강 (_학번_, 과목, 성적)',
  'Foreign Key (학번) references 학생',
].join('\n');

const src = (markup: string): RelationalSource => fromMarkup(markup);

function ok<T extends RelEditPlan>(plan: T): Extract<T, { ok: true }> {
  if (!plan.ok) throw new Error(`plan failed: ${plan.error}`);
  return plan as Extract<T, { ok: true }>;
}

/** 계획을 적용한 글(일반 텍스트 표기). 오류 없이 읽히는지도 확인한다 */
function run(source: RelationalSource, plan: RelEditPlan): string {
  const next = applyPlanToSource(source, ok(plan));
  expect(parseRelational(next).problems.filter((p) => p.severity === 'error')).toEqual([]);
  return toMarkup(next);
}

function room(markup = MODEL): Y.Doc {
  const doc = new Y.Doc();
  setRelationalSource(doc, fromMarkup(markup));
  return doc;
}

describe('테이블 더하기', () => {
  it('빈 글과 공백뿐인 글에 기본키 id 하나짜리 테이블을 더한다', () => {
    for (const text of ['', '   ', '\n\n  \n']) {
      const plan = ok(planAddTable({ text, underlines: [] }));
      expect(plan.table).toBe('Table1');
      expect(run({ text, underlines: [] }, plan)).toBe('Table1 (_id_)');
    }
  });

  it('글 끝에 새 줄로 잇고 끝의 빈 줄은 정리한다. 이름은 겹치지 않게 고른다', () => {
    const source = src('Table1 (_id_)\ntable2 (a)\n\n');
    const plan = ok(planAddTable(source));
    expect(plan.table).toBe('Table3');
    expect(run(source, plan)).toBe('Table1 (_id_)\ntable2 (a)\nTable3 (_id_)');
  });

  it('원하는 이름: 다듬고, 공백이 있으면 따옴표로 묶고, 겹치거나 못 쓰는 글자면 고치지 않는다', () => {
    const source = src(MODEL);
    const plan = ok(planAddTable(source, '  교수  정보 '));
    expect(plan.table).toBe('교수 정보');
    expect(run(source, plan).split('\n').at(-1)).toBe('"교수 정보" (_id_)');
    const ie = deriveIe(parseRelational(applyPlanToSource(source, plan)).schema, {});
    expect(ie.tables.at(-1)).toMatchObject({ name: '교수 정보', columns: [{ name: 'id', primaryKey: true }] });
    expect(planAddTable(source, '학생')).toEqual({ ok: false, error: 'duplicate' });
    expect(planAddTable(source, 'STUDENT')).toMatchObject({ ok: true });
    expect(planAddTable(source, 'a(b')).toEqual({ ok: false, error: 'chars' });
    expect(planAddTable(source, '  ')).toEqual({ ok: false, error: 'empty' });
  });

  it('글에 오류가 있어도 더한다(새 오류만 없으면)', () => {
    const source = src('A (x');
    const next = applyPlanToSource(source, ok(planAddTable(source)));
    expect(toMarkup(next)).toBe('A (x\nTable1 (_id_)');
    expect(parseRelational(next).problems.filter((p) => p.severity === 'error').map((p) => p.message.key)).toEqual(['rel.syntax.unclosedParen']);
    // 괄호를 닫지 않은 테이블 자체에는 컬럼을 더할 수 없다(그 줄을 읽을 수 없다)
    expect(planAddColumn(source, 'A')).toEqual({ ok: false, error: 'text-errors' });
  });

  it('끝 줄이 주석이어도 그 아래에 더한다', () => {
    const source = src('A (_x_) # 메모');
    expect(run(source, ok(planAddTable(source)))).toBe('A (_x_) # 메모\nTable1 (_id_)');
  });
});

describe('테이블 지우기', () => {
  it('테이블 줄, 그 테이블의 외래키, 그 테이블을 가리키는 외래키를 지우고 가리키던 컬럼은 남긴다', () => {
    const source = src(MODEL);
    expect(run(source, ok(planDeleteTable(source, '학생')))).toBe(['학과 (_학과코드_, 학과명)', '수강 (_학번_, 과목, 성적)'].join('\n'));
    expect(run(source, ok(planDeleteTable(source, '학과')))).toBe(
      ['학생 (_학번_, 이름, 학과코드)', '수강 (_학번_, 과목, 성적)', 'Foreign Key (학번) references 학생'].join('\n'),
    );
    // 마지막 테이블을 지우면 앞 줄의 줄바꿈도 지운다
    expect(run(source, ok(planDeleteTable(source, '수강')))).toBe(MODEL.split('\n').slice(0, 3).join('\n'));
  });

  it('하나뿐인 테이블을 지우면 빈 글. 여러 줄에 걸친 괄호, 따옴표 이름, 대소문자가 다른 이름도 찾는다', () => {
    expect(run(src('A (_x_)\n'), ok(planDeleteTable(src('A (_x_)\n'), 'a')))).toBe('');
    const source = src('"my table" (_a_,\n  b)\nB (_k_, a)\nForeign Key (a) references "my table"\n');
    expect(run(source, ok(planDeleteTable(source, 'MY  TABLE')))).toBe('B (_k_, a)\n');
  });

  it('자기 자신을 가리키는 외래키도 함께 지운다', () => {
    const source = src('Emp (_id_, boss)\nForeign Key (boss) references Emp (id)\nDept (_d_)');
    expect(run(source, ok(planDeleteTable(source, 'Emp')))).toBe('Dept (_d_)');
  });

  it('방 문서: 그 테이블 컬럼들의 설정과 IE 자리를 지운다(다른 테이블 것은 남는다)', () => {
    const doc = room();
    setColumnSetting(doc, '학생', '이름', { type: 'VARCHAR(20)' });
    setColumnSetting(doc, '수강', '성적', { type: 'INT' });
    setIePosition(doc, '학생', { x: 10, y: 20 });
    setIePosition(doc, '학과', { x: 300, y: 20 });
    applyRelationalEdit(doc, ok(planDeleteTable(readRelationalSource(doc), '학생')));
    expect(readColumnSettings(doc)).toEqual({ [columnKey('수강', '성적')]: { type: 'INT' } });
    expect(readIePositions(doc)).toEqual({ 학과: { x: 300, y: 20 } });
    expect(parseRelational(readRelationalSource(doc)).problems.filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('없는 테이블, 오류가 있는 글', () => {
    expect(planDeleteTable(src(MODEL), '교수')).toEqual({ ok: false, error: 'not-found' });
    expect(planDeleteTable(src(''), 'A')).toEqual({ ok: false, error: 'not-found' });
    // 없는 컬럼을 적은 Foreign Key 줄(오류)도 그 테이블 블록이라 함께 지운다
    expect(run(src('A (x)\nForeign Key (y) references A\nB (_b_)'), ok(planDeleteTable(src('A (x)\nForeign Key (y) references A\nB (_b_)'), 'A')))).toBe('B (_b_)');
    expect(planDeleteTable(src('A (x'), 'A')).toEqual({ ok: false, error: 'text-errors' });
  });
});

describe('컬럼 더하기', () => {
  it('괄호 안 끝에 더하고 이름은 겹치지 않게 고른다', () => {
    const source = src('A (_id_, column1)');
    const plan = ok(planAddColumn(source, 'a'));
    expect(plan.column).toBe('column2');
    expect(run(source, plan)).toBe('A (_id_, column1, column2)');
  });

  it('빈 괄호와 여러 줄 괄호에도 더한다', () => {
    expect(run(src('A ()'), ok(planAddColumn(src('A ()'), 'A')))).toBe('A (column1)');
    const source = src('A (_x_,\n  y\n)\nForeign Key (y) references A');
    expect(run(source, ok(planAddColumn(source, 'A', 'z')))).toBe('A (_x_,\n  y, z\n)\nForeign Key (y) references A');
  });

  it('원하는 이름: 따옴표로 묶고, 겹치면(대소문자 무시) 고치지 않는다', () => {
    const source = src(MODEL);
    const plan = ok(planAddColumn(source, '학생', '전화 번호'));
    expect(plan.column).toBe('전화 번호');
    expect(run(source, plan).split('\n')[1]).toBe('학생 (_학번_, 이름, 학과코드, "전화 번호")');
    expect(planAddColumn(source, '학생', '이름')).toEqual({ ok: false, error: 'duplicate' });
    expect(planAddColumn(source, '교수')).toEqual({ ok: false, error: 'not-found' });
    expect(planAddColumn(src(''), 'A')).toEqual({ ok: false, error: 'not-found' });
  });

  it('새 컬럼은 밑줄(기본키)을 물려받지 않는다', () => {
    const source = src('A (_id_)');
    const ie = deriveIe(parseRelational(applyPlanToSource(source, ok(planAddColumn(source, 'A')))).schema, {});
    expect(ie.tables[0].columns.map((c) => c.primaryKey)).toEqual([true, false]);
  });
});

describe('컬럼 지우기', () => {
  it('쉼표와 함께 뺀다(처음, 가운데, 끝, 하나뿐인 컬럼)', () => {
    const source = src('A (_a_, b, c)');
    expect(run(source, ok(planDeleteColumn(source, 'A', 'a')))).toBe('A (b, c)');
    expect(run(source, ok(planDeleteColumn(source, 'A', 'b')))).toBe('A (_a_, c)');
    expect(run(source, ok(planDeleteColumn(source, 'A', 'c')))).toBe('A (_a_, b)');
    expect(run(src('A (_a_)'), ok(planDeleteColumn(src('A (_a_)'), 'A', 'a')))).toBe('A ()');
  });

  it('그 컬럼 하나로 된 외래키 줄을 지운다. 여러 컬럼으로 된 외래키면 고치지 않는다', () => {
    const source = src(MODEL);
    expect(run(source, ok(planDeleteColumn(source, '학생', '학과코드'))).split('\n').slice(1, 3)).toEqual(['학생 (_학번_, 이름)', '수강 (_학번_, 과목, 성적)']);
    const comp = src('S (_c_, _n_)\nE (_s_, c, n)\nForeign Key (c, n) references S');
    expect(planDeleteColumn(comp, 'E', 'c')).toEqual({ ok: false, error: 'composite' });
  });

  it('기본키 컬럼이면 전파한다: 가리키던 외래키에서 그 짝과 자식 컬럼이 빠지고, 기본키가 다 없어지면 외래키도 지운다', () => {
    const source = src(MODEL);
    expect(run(source, ok(planDeleteColumn(source, '학과', '학과코드')))).toBe(
      ['학과 (학과명)', '학생 (_학번_, 이름)', '수강 (_학번_, 과목, 성적)', 'Foreign Key (학번) references 학생'].join('\n'),
    );
    // 복합 기본키의 한 컬럼을 빼면 복합 외래키는 남은 짝만 남는다
    const comp = src('S (_c_, _n_)\nE (_s_, c, n)\nForeign Key (c, n) references S (c, n)');
    expect(run(comp, ok(planDeleteColumn(comp, 'S', 'n')))).toBe('S (_c_)\nE (_s_, c)\nForeign Key (c) references S (c)');
  });

  it('방 문서: 그 컬럼의 설정을 지운다', () => {
    const doc = room();
    setColumnSetting(doc, '학생', '이름', { type: 'VARCHAR(20)' });
    setColumnSetting(doc, '학생', '학번', { type: 'CHAR(8)' });
    applyRelationalEdit(doc, ok(planDeleteColumn(readRelationalSource(doc), '학생', '이름')));
    expect(readColumnSettings(doc)).toEqual({ [columnKey('학생', '학번')]: { type: 'CHAR(8)' } });
    expect(toMarkup(readRelationalSource(doc)).split('\n')[1]).toBe('학생 (_학번_, 학과코드)');
  });

  it('여러 줄 괄호와 따옴표 이름', () => {
    const source = src('A (_x_,\n  "b c",\n  d)');
    expect(run(source, ok(planDeleteColumn(source, 'A', 'B  C')))).toBe('A (_x_,\n  d)');
    expect(planDeleteColumn(source, 'A', 'zz')).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('관계 더하기', () => {
  it('비식별: 부모 기본키와 같은 이름의 컬럼과 Foreign Key 줄을 자식 블록 아래에 더한다', () => {
    const source = src('Dept (_id_, name)\nEmp (_emp_)\nOther (_o_)');
    const plan = ok(planAddRelationship(source, 'Emp', 'Dept', { identifying: false }));
    expect(plan.columns).toEqual(['id']);
    expect(plan.fkIndex).toBe(0);
    expect(run(source, plan)).toBe('Dept (_id_, name)\nEmp (_emp_, id)\nForeign Key (id) references Dept (id)\nOther (_o_)');
    const ie = deriveIe(parseRelational(applyPlanToSource(source, plan)).schema, {});
    expect(ie.links).toEqual([expect.objectContaining({ id: 'Emp#fk1', identifying: false, columns: ['id'] })]);
  });

  it('식별: 더한 컬럼에 밑줄(자식 기본키)을 긋는다. 복합 기본키면 컬럼을 모두 더한다', () => {
    const source = src('S (_c_, _"n o"_)\nE (_s_)\nForeign Key (s) references S2\nS2 (_s_)');
    const plan = ok(planAddRelationship(source, 'E', 'S', { identifying: true }));
    expect(plan.columns).toEqual(['c', 'n o']);
    expect(plan.fkIndex).toBe(1);
    expect(run(source, plan)).toBe(
      'S (_c_, _"n o"_)\nE (_s_, _c_, _"n o"_)\nForeign Key (s) references S2\nForeign Key (c, "n o") references S (c, "n o")\nS2 (_s_)',
    );
    const ie = deriveIe(parseRelational(applyPlanToSource(source, plan)).schema, {});
    expect(ie.links.find((l) => l.id === 'E#fk2')).toMatchObject({ identifying: true, parent: { table: 'S' } });
  });

  it('이름이 겹치면 부모_컬럼, 그래도 겹치면 번호를 붙인다', () => {
    const source = src('P (_id_)\nC (_id_, P_id)');
    const plan = ok(planAddRelationship(source, 'C', 'P', { identifying: false }));
    expect(plan.columns).toEqual(['P_id2']);
    expect(run(source, plan)).toBe('P (_id_)\nC (_id_, P_id, P_id2)\nForeign Key (P_id2) references P (id)');
  });

  it('자기 관계: 이름을 바꾼 컬럼을 더한다. 식별 자기 관계는 기본키가 끝없이 넓어지므로 key-cycle', () => {
    const source = src('Emp (_id_, name)');
    const plan = ok(planAddRelationship(source, 'Emp', 'emp', { identifying: false }));
    expect(plan.columns).toEqual(['Emp_id']);
    expect(run(source, plan)).toBe('Emp (_id_, name, Emp_id)\nForeign Key (Emp_id) references Emp (id)');
    expect(planAddRelationship(source, 'Emp', 'Emp', { identifying: true })).toEqual({ ok: false, error: 'key-cycle' });
  });

  it('부모에 기본키가 없으면 no-primary-key, 테이블이 없으면 not-found', () => {
    const source = src('P (a)\nC (_b_)');
    expect(planAddRelationship(source, 'C', 'P', { identifying: false })).toEqual({ ok: false, error: 'no-primary-key' });
    expect(planAddRelationship(source, 'C', 'X', { identifying: false })).toEqual({ ok: false, error: 'not-found' });
    expect(planAddRelationship(src('  '), 'C', 'P', { identifying: false })).toEqual({ ok: false, error: 'not-found' });
  });

  it('빈 괄호의 자식과 따옴표 부모 이름', () => {
    const source = src('"부모 테이블" (_k_)\nC ()');
    const plan = ok(planAddRelationship(source, 'C', '부모 테이블', { identifying: true }));
    expect(run(source, plan)).toBe('"부모 테이블" (_k_)\nC (_k_)\nForeign Key (k) references "부모 테이블" (k)');
  });

  it('IE만으로 모델을 만든다: 빈 글 → 테이블 둘 → 컬럼 → 관계(방 문서)', () => {
    const doc = room('');
    const step = <T extends RelEditPlan>(make: (s: RelationalSource) => T) => {
      const plan = ok(make(readRelationalSource(doc)));
      applyRelationalEdit(doc, plan);
      return plan;
    };
    const a = step((s) => planAddTable(s)).table;
    const b = step((s) => planAddTable(s)).table;
    step((s) => planAddColumn(s, b, 'title'));
    step((s) => planRenameTable(s, a, 'Author'));
    const rel = step((s) => planAddRelationship(s, b, 'Author', { identifying: false }));
    expect(rel.columns).toEqual(['Author_id']);
    const text = readRelationalSource(doc);
    expect(toMarkup(text)).toBe('Author (_id_)\nTable2 (_id_, title, Author_id)\nForeign Key (Author_id) references Author (id)');
    expect(parseRelational(text).problems).toEqual([]);
  });
});

describe('관계 지우기', () => {
  const SOURCE = src('P (_id_)\nQ (_q_)\nC (_c_, id, q)\nForeign Key (id) references P (id)\nForeign Key (q) references Q');

  it('Foreign Key 줄만 지우고 컬럼은 남긴다(번호 또는 IE 선 id)', () => {
    expect(run(SOURCE, ok(planDeleteRelationship(SOURCE, 'C', 0, { dropColumns: false })))).toBe(
      'P (_id_)\nQ (_q_)\nC (_c_, id, q)\nForeign Key (q) references Q',
    );
    expect(run(SOURCE, ok(planDeleteRelationship(SOURCE, 'C', 'C#fk2', { dropColumns: false })))).toBe(
      'P (_id_)\nQ (_q_)\nC (_c_, id, q)\nForeign Key (id) references P (id)',
    );
  });

  it('dropColumns면 외래키 컬럼과 그 설정도 지운다', () => {
    const doc = room(toMarkup(SOURCE));
    setColumnSetting(doc, 'C', 'q', { notNull: true });
    setColumnSetting(doc, 'C', 'c', { type: 'INT' });
    applyRelationalEdit(doc, ok(planDeleteRelationship(readRelationalSource(doc), 'C', 1, { dropColumns: true })));
    expect(toMarkup(readRelationalSource(doc))).toBe('P (_id_)\nQ (_q_)\nC (_c_, id)\nForeign Key (id) references P (id)');
    expect(readColumnSettings(doc)).toEqual({ [columnKey('C', 'c')]: { type: 'INT' } });
  });

  it('다른 외래키가 쓰는 컬럼은 남긴다', () => {
    const source = src('P (_a_, _b_)\nR (_a_)\nC (_k_, a, b)\nForeign Key (a, b) references P\nForeign Key (a) references R');
    expect(run(source, ok(planDeleteRelationship(source, 'C', 0, { dropColumns: true })))).toBe(
      'P (_a_, _b_)\nR (_a_)\nC (_k_, a)\nForeign Key (a) references R',
    );
  });

  it('식별 관계의 컬럼(자식 기본키)을 빼면 자식을 가리키던 외래키로 전파한다', () => {
    const source = src('P (_id_)\nC (_id_, _n_)\nForeign Key (id) references P\nG (_g_, id, n)\nForeign Key (id, n) references C');
    expect(run(source, ok(planDeleteRelationship(source, 'C', 'C#fk1', { dropColumns: true })))).toBe(
      'P (_id_)\nC (_n_)\nG (_g_, n)\nForeign Key (n) references C',
    );
  });

  it('없는 관계', () => {
    expect(planDeleteRelationship(SOURCE, 'C', 2, { dropColumns: false })).toEqual({ ok: false, error: 'not-found' });
    expect(planDeleteRelationship(SOURCE, 'C', 'C#fk9', { dropColumns: false })).toEqual({ ok: false, error: 'not-found' });
    expect(planDeleteRelationship(SOURCE, 'C', -1, { dropColumns: false })).toEqual({ ok: false, error: 'not-found' });
    expect(planDeleteRelationship(SOURCE, 'P', 0, { dropColumns: false })).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('IE 자리와 이름 바꾸기', () => {
  it('테이블 이름을 바꾸면 IE 자리 키도 옮긴다', () => {
    const doc = room();
    setIePosition(doc, '학생', { x: 5, y: 6 });
    applyRelationalEdit(doc, ok(planRenameTable(readRelationalSource(doc), '학생', 'Student')));
    expect(readIePositions(doc)).toEqual({ student: { x: 5, y: 6 } });
  });

  it('대소문자만 바꾸면 자리 키는 그대로다', () => {
    const doc = room('abc (_x_)');
    setIePosition(doc, 'abc', { x: 1, y: 2 });
    applyRelationalEdit(doc, ok(planRenameTable(readRelationalSource(doc), 'abc', 'ABC')));
    expect(readIePositions(doc)).toEqual({ abc: { x: 1, y: 2 } });
  });
});
