import { describe, expect, it } from 'vitest';
import { completionAt } from './complete';
import type { RelationalSource } from '../../shared/relational/types';

/** | 자리를 캐럿으로 본다. 각 테이블의 첫 컬럼에 밑줄(기본키)을 긋는다 */
function at(withCaret: string) {
  const caret = withCaret.indexOf('|');
  const text = withCaret.replace('|', '');
  const underlines: { from: number; to: number }[] = [];
  const re = /^[^\s(]+\s*\(([^,)\s]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length - m[1].length;
    underlines.push({ from: start, to: start + m[1].length });
  }
  const source: RelationalSource = { text, underlines };
  return completionAt(source, caret);
}

const BASE = 'Table1 (id, name)\nTable2 (id, Table1_id)\nForeign Key (Table1_id) references Table1 (id)\nTable3 (id, Table2_id, Table1_id)\n';

describe('completionAt', () => {
  it('references 뒤 괄호 안에서 그 테이블의 컬럼을 준다', () => {
    const c = at(BASE + 'Foreign Key (Table2_id, Table1_id) references Table2 (id, Tab|)');
    expect(c?.items).toEqual(['Table1_id']);
    expect(c && [c.from, c.to]).toBeTruthy();
  });

  it('references 뒤에서 테이블 이름을 준다', () => {
    expect(at(BASE + 'Foreign Key (Table2_id) references Ta|')?.items).toEqual(['Table1', 'Table2', 'Table3']);
  });

  it('Foreign Key 괄호 안에서 지금 테이블의 컬럼을 준다', () => {
    expect(at(BASE + 'Foreign Key (Tab|')?.items).toEqual(['Table2_id', 'Table1_id']);
  });

  it('줄 맨 앞에서 Foreign Key를 준다', () => {
    expect(at(BASE + 'fo|')?.items).toEqual(['Foreign Key']);
  });

  it('외래키 컬럼 목록 뒤에서 references를 준다', () => {
    expect(at(BASE + 'Foreign Key (Table2_id) re|')?.items).toEqual(['references']);
  });

  it('테이블 컬럼 목록에서 다른 테이블의 기본키 이름을 준다', () => {
    expect(at(BASE + 'Table4 (id, Table3|')?.items[0]).toBe('Table3_id');
  });

  it('낱말 중간이나 다 친 이름에서는 주지 않는다', () => {
    expect(at(BASE + 'Foreign Key (Table2_id) references Table1|x')).toBeNull();
    expect(at(BASE + 'Foreign Key (Table2_id) references Table3|')).toBeNull();
  });
});
