// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomContext } from '../collab/hooks';
import type { Room } from '../collab/room';
import { setLocale, t } from '../i18n';
import { PANE_IDS } from '../layout/types';
import { columnKey, getRelationalText, layoutIe, readColumnSettings, readIePositions, readRelationalSource, setColumnSetting, setIePosition, type IeModel } from './engine';
import { IeDiagram } from './IeDiagram';
import { IePane, PaneIcon, RelationalTextPane, SqlPane, paneTitleKey } from './panes';
import { resetRelPanes, useRelPanes } from './paneStore';
import { ColumnSettingsTable, type SettingsTable } from './SqlParts';
import { makeTestRoom } from './testRoom';
import { fromRuns, type RelationalSource, type Run } from './richText';
import { insertRuns, readSource } from './yTextBinding';
import { useToasts } from '../ui/toast';

/** 틀의 너비는 가장 가까운 [data-w] 조상의 값으로 알린다(jsdom은 배치를 계산하지 않는다) */
class FakeResizeObserver {
  constructor(private cb: (entries: Array<{ contentRect: { width: number; height: number } }>) => void) {}
  observe(el: Element) {
    const w = Number(el.closest('[data-w]')?.getAttribute('data-w') ?? 1200);
    this.cb([{ contentRect: { width: w, height: 600 } }]);
  }
  unobserve() {}
  disconnect() {}
}

function Box({ w = 1200, children }: { w?: number; children: ReactNode }) {
  return (
    <div data-w={w} style={{ width: w, height: 600 }}>
      {children}
    </div>
  );
}

function inRoom(room: Room, ui: ReactNode) {
  return render(
    <RoomContext.Provider value={room}>
      <Box>{ui}</Box>
    </RoomContext.Provider>,
  );
}

/** 다른 사람이 고친 것처럼 다른 문서에서 고쳐 받는다 */
function remoteEdit(doc: Y.Doc, edit: (text: Y.Text) => void) {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  const sv = Y.encodeStateVector(other);
  edit(getRelationalText(other));
  act(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, sv), 'remote'));
}

/** 수업 표기의 글. ${'이름'} 으로 끼운 이름에 밑줄(기본키)을 긋는다 */
function rich(strings: TemplateStringsArray, ...keys: string[]): RelationalSource {
  const runs: Run[] = [];
  strings.forEach((part, i) => {
    runs.push({ text: part, underline: false });
    if (i < keys.length) runs.push({ text: keys[i], underline: true });
  });
  return fromRuns(runs);
}

const MODEL = rich`학과 (${'학과코드'}, 학과명)
학생 (${'학번'}, 이름, 학과코드)
Foreign Key (학과코드) references 학과
과목 (${'과목코드'}, 과목명)
수강 (${'학번'}, ${'과목코드'}, 성적)
Foreign Key (학번) references 학생
Foreign Key (과목코드) references 과목 (과목코드)
`;

function roomWith(source: string | RelationalSource): Room {
  const room = makeTestRoom();
  const src = typeof source === 'string' ? { text: source, underlines: [] } : source;
  if (src.text) insertRuns(getRelationalText(room.doc), 0, toRunsOf(src));
  return room;
}

function toRunsOf(src: RelationalSource): Run[] {
  const runs: Run[] = [];
  let pos = 0;
  for (const r of src.underlines) {
    if (r.from > pos) runs.push({ text: src.text.slice(pos, r.from), underline: false });
    runs.push({ text: src.text.slice(r.from, r.to), underline: true });
    pos = r.to;
  }
  if (pos < src.text.length) runs.push({ text: src.text.slice(pos), underline: false });
  return runs;
}

beforeEach(() => {
  setLocale('ko');
  localStorage.clear();
  resetRelPanes();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pane 목록', () => {
  it('pane은 ERD, 관계 모델, IE, SQL 넷이고 제목과 아이콘이 있다', () => {
    expect(PANE_IDS).toEqual(['erd', 'relational', 'ie', 'sql']);
    expect(PANE_IDS.map((p) => t(paneTitleKey(p)))).toEqual(['ERD', '관계 모델', 'IE 다이어그램', 'SQL']);
    for (const p of PANE_IDS) {
      const { container } = render(<PaneIcon pane={p} />);
      expect(container.querySelector(`svg[data-pane-icon="${p}"]`)).not.toBeNull();
      cleanup();
    }
  });
});

describe('관계 모델 편집기', () => {
  it('빈 편집기는 수업 표기 예시만 보이고, 머리 줄에는 밑줄 버튼 하나뿐이다', () => {
    inRoom(roomWith(''), <RelationalTextPane />);
    const editor = screen.getByTestId('relational-editor') as HTMLTextAreaElement;
    expect(editor.placeholder).toBe('학생 (학번, 이름, 학과코드)\nForeign Key (학과코드) references 학과 (학과코드)');
    expect(editor.placeholder).not.toMatch(/->|_/);
    expect(editor.value).toBe('');
    const pane = screen.getByTestId('pane-relational');
    // 채점, 도움말, 결과 칸이 없다. 버튼은 밑줄 하나
    const buttons = pane.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    const button = screen.getByTestId('relational-underline');
    expect(button.getAttribute('aria-label')).toBe('밑줄');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('title')).toMatch(/^기본키 이름에 밑줄을 긋습니다 \((⌘U|Ctrl\+U)\)$/);
    expect(pane.textContent?.replace(/\u200b/g, '')).toBe('밑줄1');
    expect(screen.queryByTestId('relational-problem')).toBeNull();
  });

  it('친 글은 방 문서에 들어가고, 남이 고친 글은 바로 보인다', () => {
    const room = roomWith('');
    inRoom(room, <RelationalTextPane />);
    const editor = screen.getByTestId('relational-editor') as HTMLTextAreaElement;
    editor.value = '학생 (학번)';
    editor.setSelectionRange(7, 7);
    fireEvent.input(editor);
    expect(getRelationalText(room.doc).toString()).toBe('학생 (학번)');
    remoteEdit(room.doc, (text) => text.insert(text.length, '\n과목 (과목코드)'));
    expect(editor.value).toBe('학생 (학번)\n과목 (과목코드)');
    expect(screen.getByTestId('pane-relational').querySelectorAll('.rel-gutter span')).toHaveLength(2);
  });

  it('문제가 있는 줄은 줄 번호에 표시하고 그 자리에 물결 밑줄을 긋는다. 줄에 머물거나 표시에 올리면 문장을 보인다', () => {
    inRoom(roomWith(rich`학생 (${'학번'}, 이름)\n과목 (${'과목코드'}, 과목명\n수강 (${'학번'})\nForeign Key (학번) references 없는테이블`), <RelationalTextPane />);
    const pane = screen.getByTestId('pane-relational');
    const marked = [...pane.querySelectorAll<HTMLElement>('.rel-gutter span[data-problem]')];
    expect(marked.map((s) => [s.dataset.line, s.dataset.problem])).toEqual([
      ['2', 'error'],
      ['4', 'error'],
    ]);
    const squiggles = pane.querySelectorAll('.rel-squiggle.is-error');
    expect(squiggles.length).toBeGreaterThanOrEqual(2);
    expect([...squiggles].some((s) => s.textContent?.includes('없는테이블'))).toBe(true);
    expect(screen.queryByTestId('relational-problem')).toBeNull();

    // 표시에 마우스를 올린다
    fireEvent.mouseEnter(marked[1]);
    const pop = screen.getByTestId('relational-problem');
    expect(pop.textContent).toContain('없는테이블');
    expect(pop.textContent).not.toContain('rel.');
    fireEvent.mouseLeave(marked[1]);
    expect(screen.queryByTestId('relational-problem')).toBeNull();

    // 캐럿을 그 줄에 둔다
    const editor = screen.getByTestId('relational-editor') as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(16, 16);
    fireEvent.select(editor);
    expect(screen.getByTestId('relational-problem').className).toContain('is-error');
    expect(editor.getAttribute('aria-describedby')).toBe('rel-problem-pop');
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    // 문제가 없는 줄로 옮기면 사라진다
    editor.setSelectionRange(2, 2);
    fireEvent.select(editor);
    expect(screen.queryByTestId('relational-problem')).toBeNull();
  });

  it('편집기 안의 키는 캔버스 단축키(window)로 새지 않는다', () => {
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    inRoom(roomWith(rich`학생 (${'학번'})`), <RelationalTextPane />);
    const editor = screen.getByTestId('relational-editor');
    for (const key of ['Delete', 'Backspace', 'v', 'z', 'Escape']) fireEvent.keyDown(editor, { key });
    expect(outside).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outside);
  });

  it('다른 pane이 자리를 보여 달라고 하면 그 자리를 고른다', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    inRoom(roomWith(MODEL), <RelationalTextPane />);
    const editor = screen.getByTestId('relational-editor') as HTMLTextAreaElement;
    act(() => useRelPanes.setState({ reveal: { line: 2, column: 1, endColumn: 3, token: 1 } }));
    expect(document.activeElement).toBe(editor);
    expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe('학생');
  });
});

describe('관계 모델 편집기의 밑줄', () => {
  const ulWords = () => [...document.querySelectorAll('.rel-editor-marks .rel-ul')].map((e) => e.textContent);

  it('밑줄은 거울 층에 그리고, 밑줄 버튼과 단축키로 긋는다. IE가 기본키로 그린다', () => {
    const room = roomWith('Player (SSN, Name)');
    inRoom(
      room,
      <>
        <RelationalTextPane />
        <IePane />
      </>,
    );
    const editor = screen.getByTestId('relational-editor') as HTMLTextAreaElement;
    const button = screen.getByTestId('relational-underline');
    expect(ulWords()).toEqual([]);
    const pk = () => document.querySelector('[data-table="Player"] [data-column="SSN"] .ie-col')!.classList.contains('is-pk');
    expect(pk()).toBe(false);
    editor.focus();
    editor.setSelectionRange(8, 11);
    fireEvent.select(editor);
    // 버튼을 눌러도 편집기의 고른 구간을 잃지 않는다
    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button);
    expect(readSource(getRelationalText(room.doc)).underlines).toEqual([{ from: 8, to: 11 }]);
    expect(ulWords()).toEqual(['SSN']);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(editor);
    expect(pk()).toBe(true);
    // 거울의 줄은 원래 줄과 글자가 같다
    expect(document.querySelector('.rel-editor-markline')!.textContent).toBe('Player (SSN, Name)');
    // 단축키로 지운다
    fireEvent.keyDown(editor, { code: 'KeyU', key: 'u', metaKey: isMac(), ctrlKey: !isMac() });
    expect(ulWords()).toEqual([]);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('팀원이 그은 밑줄이 바로 보인다', () => {
    const room = roomWith('학생 (학번, 이름)');
    inRoom(room, <RelationalTextPane />);
    remoteEdit(room.doc, (text) => text.format(4, 2, { underline: true }));
    expect(ulWords()).toEqual(['학번']);
  });

  it('예전 표기(_이름_, 컬럼 -> 테이블)는 보통 문제 표시로 보인다', () => {
    inRoom(roomWith('학생 (_학번_, 학과코드 -> 학과)'), <RelationalTextPane />);
    const marked = [...document.querySelectorAll<HTMLElement>('.rel-gutter span[data-problem]')];
    expect(marked.map((m) => m.dataset.line)).toEqual(['1']);
    expect(document.querySelectorAll('.rel-editor-marks .rel-squiggle').length).toBeGreaterThanOrEqual(1);
    expect(ulWords()).toEqual([]);
  });
});

// ───────────────────────── IE ─────────────────────────

describe('IE 그림의 선 끝', () => {
  const col = (name: string, o: Partial<IeModel['tables'][number]['columns'][number]> = {}) => ({
    name,
    primaryKey: false,
    foreignKey: false,
    type: null,
    notNull: null,
    inheritedType: null,
    unique: false,
    ...o,
  });
  const model: IeModel = {
    tables: [
      { name: 'P', columns: [col('id', { primaryKey: true, notNull: true, type: 'INT' })] },
      { name: 'A', columns: [col('id', { primaryKey: true, foreignKey: true, notNull: true })] },
      { name: 'B', columns: [col('id', { primaryKey: true, notNull: true }), col('p', { foreignKey: true, notNull: false, inheritedType: 'INT' })] },
      { name: 'C', columns: [col('id', { primaryKey: true, notNull: true }), col('p', { foreignKey: true })] },
    ],
    links: [
      // 식별: 부모 최소 1, 자식 최대 1(기본키 전체), 자식 최소는 모름
      { id: 'a', child: { table: 'A', min: null, max: '1' }, parent: { table: 'P', min: 1, max: '1' }, identifying: true, columns: ['id'] },
      // 비식별, NULL 허용: 부모 최소 0, 자식 여럿
      { id: 'b', child: { table: 'B', min: null, max: 'N' }, parent: { table: 'P', min: 0, max: '1' }, identifying: false, columns: ['p'] },
      // 비식별, NULL 미지정: 부모 최소도 모름
      { id: 'c', child: { table: 'C', min: null, max: 'N' }, parent: { table: 'P', min: null, max: '1' }, identifying: false, columns: ['p'] },
    ],
  };

  function draw() {
    const { container } = render(
      <Box>
        <IeDiagram model={model} layout={layoutIe(model)} />
      </Box>,
    );
    const end = (link: string, which: 'child' | 'parent') => container.querySelector<SVGGElement>(`[data-link-id="${link}"] .ie-end[data-end="${which}"]`)!;
    const marks = (link: string, which: 'child' | 'parent') =>
      [...end(link, which).querySelectorAll('.ie-mark')].map((m) => m.getAttribute('class')!.replace('ie-mark ie-mark-', ''));
    return { container, end, marks };
  }

  it('최소 1은 막대, 0은 동그라미, 모르면 그리지 않는다. 최대 1은 막대, N은 까마귀발', () => {
    const { end, marks } = draw();
    expect(end('a', 'parent').dataset.kind).toBe('exactly-one');
    expect(marks('a', 'parent')).toEqual(['bar', 'bar']);
    expect(end('a', 'child').dataset.kind).toBe('max-one');
    expect(marks('a', 'child')).toEqual(['bar']);
    expect(end('b', 'parent').dataset.kind).toBe('zero-or-one');
    expect(marks('b', 'parent')).toEqual(['bar', 'circle']);
    expect(end('b', 'child').dataset.kind).toBe('max-many');
    expect(marks('b', 'child')).toEqual(['crow']);
    expect(end('c', 'parent').dataset.kind).toBe('max-one');
    expect(marks('c', 'parent')).toEqual(['bar']);
  });

  it('식별 관계는 실선, 비식별 관계는 점선', () => {
    const { container } = draw();
    const line = (id: string) => container.querySelector(`[data-link-id="${id}"] .ie-link-line`)!;
    expect(container.querySelector('[data-link-id="a"]')!.getAttribute('data-identifying')).toBe('true');
    expect(line('a').classList.contains('is-dashed')).toBe(false);
    expect(line('b').classList.contains('is-dashed')).toBe(true);
    expect(line('c').classList.contains('is-dashed')).toBe(true);
  });

  it('타입은 정한 것만 적고, 물려받은 타입은 흐리게 적는다', () => {
    const { container } = draw();
    const types = [...container.querySelectorAll('.ie-type')].map((n) => [n.textContent, n.classList.contains('is-inherited')]);
    expect(types).toEqual([
      ['INT', false],
      ['INT', true],
    ]);
    expect(container.querySelector('[data-table="C"] .ie-type')).toBeNull();
    // 기호 설명 상자는 그림 안에 그리지 않는다. 칸 이름 줄은 언제나 있다
    expect(screen.queryByTestId('ie-legend')).toBeNull();
    expect(screen.getByTestId('ie-colhead-A').textContent).toBe('키이름타입NULL');
  });
});

describe('IE pane', () => {
  it('글이 없으면 빈 그림에 테이블 추가 버튼을 보인다(글을 먼저 적으라고 하지 않는다)', () => {
    inRoom(roomWith(''), <IePane />);
    expect(screen.getByTestId('ie-diagram')).not.toBeNull();
    expect(screen.getByTestId('ie-empty').textContent).toContain('아직 테이블이 없습니다');
    expect(screen.getByTestId('ie-empty').textContent).not.toContain('관계 모델을 적으면');
    expect(screen.getByTestId('ie-empty-add').getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByTestId('ie-tools').getAttribute('role')).toBe('toolbar');
  });

  it('글에서 테이블과 선을 그리고, 글이 바뀌면 바로 따라간다', () => {
    const room = roomWith(MODEL);
    const { container } = inRoom(room, <IePane />);
    const names = () => [...container.querySelectorAll('g.ie-table')].map((g) => g.getAttribute('data-table'));
    expect(names()).toEqual(['학과', '학생', '과목', '수강']);
    expect(container.querySelectorAll('.ie-link')).toHaveLength(3);
    expect(screen.queryByTestId('ie-problem-badge')).toBeNull();
    remoteEdit(room.doc, (text) => {
      const at = text.length;
      insertRuns(text, at, [
        { text: '사물함 (', underline: false },
        { text: '번호', underline: true },
        { text: ', 학번)\nForeign Key (학번) references 학생\n', underline: false },
      ]);
    });
    expect(names()).toContain('사물함');
    expect(container.querySelectorAll('.ie-link')).toHaveLength(4);
  });

  it('글에 오류가 있으면 읽은 만큼 그리고 오류 수 배지를 보인다. 누르면 편집기의 첫 문제로 간다', () => {
    inRoom(roomWith(rich`학생 (${'학번'}, 학과코드)\nForeign Key (학과코드) references 학과\n과목 (${'과목코드'}, 과목명\n`), <IePane />);
    expect(document.querySelector('g.ie-table[data-table="학생"]')).not.toBeNull();
    const badge = screen.getByTestId('ie-problem-badge');
    expect(badge.getAttribute('aria-label')).toMatch(/^오류 \d+개, 경고 \d+개$/);
    fireEvent.click(badge);
    const reveal = useRelPanes.getState().reveal!;
    expect(reveal.line).toBe(2);
    expect(reveal.token).toBe(1);
  });

  /** 끌지 않고 누른다(그림은 포인터를 잡아 끌기와 누르기를 가린다) */
  const press = (el: Element) => {
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(el, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  };
  const cell = (id: string) => screen.getByTestId(id);
  /** 칸에 보이는 글자(안내 글자와 툴팁은 빼고) */
  const shown = (id: string, sel: string) => cell(id).querySelector(sel)?.textContent ?? '';
  const tag = (c: string) => shown(`ie-key-${c}`, '.ie-tag');
  const nullText = (c: string) => shown(`ie-null-${c}`, '.ie-null');
  const typeText = (c: string) => shown(`ie-type-${c}`, '.ie-type');

  it('테이블을 눌러도 편집기의 글을 고르지 않는다', () => {
    inRoom(roomWith(MODEL), <IePane />);
    const box = document.querySelector('g.ie-table[data-table="과목"]')!;
    press(box.querySelector('.ie-box')!);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(useRelPanes.getState().reveal).toBeNull();
    expect(box.getAttribute('role')).toBe('group');
  });

  it('각 행은 키 | 이름 | 타입 | NULL 네 칸이고, 칸 경계는 테이블 안에서 같다', () => {
    const room = roomWith(MODEL);
    setColumnSetting(room.doc, '학생', '이름', { type: 'VARCHAR(20)', notNull: false });
    const { container } = inRoom(room, <IePane />);
    const rows = [...container.querySelectorAll('[data-table="학생"] .ie-row')];
    const xOf = (row: Element, kind: string) => row.querySelector(`.ie-cell-${kind} .ie-cell-hit`)!.getAttribute('x');
    for (const kind of ['key', 'name', 'type', 'null']) expect(new Set(rows.map((r) => xOf(r, kind))).size).toBe(1);
    expect(tag('학생.학번')).toBe('PK');
    expect(tag('학생.학과코드')).toBe('FK');
    expect(nullText('학생.학번')).toBe('NOT NULL');
    expect(nullText('학생.이름')).toBe('NULL');
    expect(nullText('학생.학과코드')).toBe('');
    expect(typeText('학생.이름')).toBe('VARCHAR(20)');
    // 타입이 없는 칸은 글자 없이 비어 있다(올려 두면 보이는 옅은 안내만 있다)
    expect(cell('ie-type-학생.학번').querySelector('.ie-type')).toBeNull();
    expect(cell('ie-type-학생.학번').querySelector('.ie-type-hint')).not.toBeNull();
    // 칸 경계 세 줄
    expect(container.querySelectorAll('[data-table="학생"] .ie-grid-line')).toHaveLength(3);
  });

  it('타입 칸을 누르면 그 자리에서 고치고 SQL에 반영된다. Esc는 버리고, 빈 값은 미지정, 틀린 값은 쓰지 않는다', () => {
    const room = roomWith(MODEL);
    inRoom(
      room,
      <>
        <IePane />
        <SqlPane />
      </>,
    );
    press(cell('ie-type-학생.이름'));
    const input = () => screen.getByTestId('ie-type-input-학생.이름') as HTMLInputElement;
    expect(document.activeElement).toBe(input());
    fireEvent.change(input(), { target: { value: ' VARCHAR(20) ' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.queryByTestId('ie-type-input-학생.이름')).toBeNull();
    expect(readColumnSettings(room.doc)).toEqual({ [columnKey('학생', '이름')]: { type: 'VARCHAR(20)' } });
    expect(screen.getByTestId('sql-code').textContent).toMatch(/`이름` VARCHAR\(20\)/);
    expect((screen.getByTestId('type-input-학생.이름') as HTMLInputElement).value).toBe('VARCHAR(20)');

    // Esc는 버린다
    press(cell('ie-type-학생.이름'));
    fireEvent.change(input(), { target: { value: 'TEXT' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(typeText('학생.이름')).toBe('VARCHAR(20)');

    // 틀린 값은 쓰지 않고 입력칸에 표시한다
    press(cell('ie-type-학생.이름'));
    fireEvent.change(input(), { target: { value: 'INT; DROP TABLE x' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().title).toContain('쓸 수 없는 타입');
    expect(readColumnSettings(room.doc)).toEqual({ [columnKey('학생', '이름')]: { type: 'VARCHAR(20)' } });

    // 빈 값은 미지정으로 돌린다(칸을 떠날 때도 쓴다)
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.blur(input());
    expect(readColumnSettings(room.doc)).toEqual({});
  });

  it('타입 칸은 고른 DBMS의 흔한 타입 콤보박스다. 길이 있는 타입은 괄호 안을 골라 둔 채 채우고, 없는 타입은 바로 쓴다', () => {
    const room = roomWith(MODEL);
    inRoom(
      room,
      <>
        <IePane />
        <SqlPane />
      </>,
    );
    press(cell('ie-type-학생.이름'));
    const input = () => screen.getByTestId('ie-type-input-학생.이름') as HTMLInputElement;
    const options = () => [...screen.getByTestId('ie-type-input-학생.이름-options').querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(input().getAttribute('role')).toBe('combobox');
    expect(options()).toContain('VARCHAR(255)');
    expect(options()).toContain('DATETIME');
    // 적으면 좁힌다
    fireEvent.change(input(), { target: { value: 'var' } });
    expect(options()).toEqual(['VARCHAR(255)']);
    fireEvent.click(screen.getByText('VARCHAR(255)'));
    expect(input().value).toBe('VARCHAR(255)');
    expect([input().selectionStart, input().selectionEnd]).toEqual([8, 11]);
    expect(readColumnSettings(room.doc)).toEqual({});
    fireEvent.change(input(), { target: { value: 'VARCHAR(40)' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(typeText('학생.이름')).toBe('VARCHAR(40)');
    // 괄호 없는 타입은 고르면 바로 쓴다(방향키와 Enter로)
    press(cell('ie-type-학생.학번'));
    fireEvent.change(screen.getByTestId('ie-type-input-학생.학번'), { target: { value: 'BIG' } });
    fireEvent.keyDown(screen.getByTestId('ie-type-input-학생.학번'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('ie-type-input-학생.학번'), { key: 'Enter' });
    expect(typeText('학생.학번')).toBe('BIGINT');
    // DBMS는 pane이 아니라 위쪽 바에서 한 번 고르고 IE와 SQL이 같은 값을 쓴다
    expect(screen.queryByTestId('ie-dialect')).toBeNull();
    expect(screen.queryByTestId('sql-dialect')).toBeNull();
    fireEvent.click(screen.getByTestId('dialect-select'));
    expect(screen.getByTestId('dialect-select').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByTestId('dialect-select-menu-oracle'));
    expect(screen.queryByTestId('dialect-select-menu')).toBeNull();
    expect(screen.getByTestId('dialect-select').dataset.value).toBe('oracle');
    expect(screen.getByTestId('dialect-select').textContent).toContain('Oracle');
    expect(screen.getByTestId('pane-sql').dataset.dialect).toBe('oracle');
    expect(screen.getByTestId('pane-ie').dataset.dialect).toBe('oracle');
    press(cell('ie-type-학생.학과코드'));
    const oracle = [...screen.getByTestId('ie-type-input-학생.학과코드-options').querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(oracle).toContain('VARCHAR2(255)');
    expect(oracle).not.toContain('DATETIME');
    fireEvent.keyDown(screen.getByTestId('ie-type-input-학생.학과코드'), { key: 'Escape' });
    // SQL 표의 타입 칸도 같은 목록이다
    fireEvent.focus(screen.getByTestId('type-input-학생.이름'));
    expect(screen.getByTestId('type-input-학생.이름-options').textContent).toContain('NUMBER(10,2)');
  });

  /** 칸을 눌러 메뉴를 열고 항목을 고른다 */
  const choose = (cellId: string, menu: 'null' | 'key', value: string) => {
    press(cell(cellId));
    fireEvent.click(screen.getByTestId(`ie-${menu}-menu-${value}`));
  };

  it('NULL 칸은 누르면 미지정, NOT NULL, NULL 메뉴가 뜨고 고른 것을 쓴다(순환하지 않는다). 기본키는 바꿀 수 없다', () => {
    const room = roomWith(MODEL);
    inRoom(room, <IePane />);
    const nn = () => cell('ie-null-학생.학과코드').getAttribute('data-value');
    expect(nn()).toBe('unset');
    press(cell('ie-null-학생.학과코드'));
    const menu = screen.getByTestId('ie-null-menu');
    expect([...menu.querySelectorAll('[role="menuitemradio"]')].map((b) => b.textContent)).toEqual(['미지정', 'NOT NULL', 'NULL']);
    expect(screen.getByTestId('ie-null-menu-unset').getAttribute('aria-checked')).toBe('true');
    // 지금 값에 포커스가 간다
    expect(document.activeElement).toBe(screen.getByTestId('ie-null-menu-unset'));
    fireEvent.click(screen.getByTestId('ie-null-menu-null'));
    expect(nn()).toBe('null');
    expect(screen.queryByTestId('ie-null-menu')).toBeNull();
    expect(document.querySelector<SVGGElement>('.ie-link[data-child="학생"]')!.dataset.parentEnd).toBe('zero-or-one');
    // 키보드로도 연다. Esc는 아무것도 바꾸지 않고 닫는다
    fireEvent.keyDown(cell('ie-null-학생.학과코드'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('ie-null-menu'), { key: 'Escape' });
    expect(screen.queryByTestId('ie-null-menu')).toBeNull();
    expect(nn()).toBe('null');
    // 같은 칸을 다시 누르면 닫힌다
    press(cell('ie-null-학생.학과코드'));
    press(cell('ie-null-학생.학과코드'));
    expect(screen.queryByTestId('ie-null-menu')).toBeNull();
    choose('ie-null-학생.학과코드', 'null', 'unset');
    expect(nn()).toBe('unset');
    expect(readColumnSettings(room.doc)).toEqual({});
    press(cell('ie-null-학생.학번'));
    expect(screen.queryByTestId('ie-null-menu')).toBeNull();
    expect(cell('ie-null-학생.학번').getAttribute('data-value')).toBe('not-null');
    expect(cell('ie-null-학생.학번').getAttribute('data-edit')).toBeNull();
    expect(readColumnSettings(room.doc)).toEqual({});
  });

  it('그림에서 고친 것은 그림의 ⌘Z로 되돌린다', () => {
    const room = roomWith(MODEL);
    inRoom(room, <IePane />);
    choose('ie-null-학생.이름', 'null', 'not-null');
    choose('ie-null-학생.이름', 'null', 'null');
    expect(cell('ie-null-학생.이름').getAttribute('data-value')).toBe('null');
    const stage = document.querySelector('.ie-stage')!;
    fireEvent.keyDown(stage, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(cell('ie-null-학생.이름').getAttribute('data-value')).toBe('not-null');
    fireEvent.keyDown(stage, { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    expect(cell('ie-null-학생.이름').getAttribute('data-value')).toBe('null');
  });

  it('이름 칸을 두 번 누르면 이름을 바꾼다: 글의 테이블 줄, Foreign Key 줄, references가 함께 바뀌고 설정이 따라간다', () => {
    const room = roomWith(MODEL);
    setColumnSetting(room.doc, '학과', '학과코드', { type: 'CHAR(4)' });
    inRoom(
      room,
      <>
        <IePane />
        <SqlPane />
      </>,
    );
    press(cell('ie-name-학과.학과코드'));
    expect(screen.queryByTestId('ie-name-input-학과.학과코드')).toBeNull();
    press(cell('ie-name-학과.학과코드'));
    const input = screen.getByTestId('ie-name-input-학과.학과코드') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '코드' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const text = getRelationalText(room.doc).toString();
    expect(text.split('\n')[0]).toBe('학과 (코드, 학과명)');
    // 가리키는 컬럼을 적지 않은 외래키는 그대로(기본키를 가리킨다)
    expect(text.split('\n')[2]).toBe('Foreign Key (학과코드) references 학과');
    expect(tag('학과.코드')).toBe('PK');
    expect(typeText('학과.코드')).toBe('CHAR(4)');
    expect(screen.getByTestId('sql-code').textContent).toMatch(/`코드` CHAR\(4\)/);

    // 이미 있는 이름은 쓰지 않고 표시한다
    press(cell('ie-name-학과.학과명'));
    press(cell('ie-name-학과.학과명'));
    const again = screen.getByTestId('ie-name-input-학과.학과명') as HTMLInputElement;
    fireEvent.change(again, { target: { value: '코드' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(again.getAttribute('aria-invalid')).toBe('true');
    expect(again.title).toBe('같은 이름이 이미 있습니다.');
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(getRelationalText(room.doc).toString().split('\n')[0]).toBe('학과 (코드, 학과명)');

    // 되돌리기 한 번에 글과 설정이 함께 돌아간다
    fireEvent.keyDown(document.querySelector('.ie-stage')!, { key: 'z', code: 'KeyZ', metaKey: true });
    expect(getRelationalText(room.doc).toString().split('\n')[0]).toBe('학과 (학과코드, 학과명)');
    expect(readColumnSettings(room.doc)).toEqual({ [columnKey('학과', '학과코드')]: { type: 'CHAR(4)' } });
  });

  it('테이블 이름을 두 번 누르면 바꾸고 references도 함께 바뀐다', () => {
    const room = roomWith(MODEL);
    inRoom(room, <IePane />);
    press(cell('ie-table-name-과목'));
    press(cell('ie-table-name-과목'));
    const input = screen.getByTestId('ie-table-name-input-과목') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Course' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const lines = getRelationalText(room.doc).toString().split('\n');
    expect(lines[3]).toBe('Course (과목코드, 과목명)');
    expect(lines[6]).toBe('Foreign Key (과목코드) references Course (과목코드)');
    expect(document.querySelector('.ie-link[data-parent="Course"]')).not.toBeNull();
  });

  it('키 칸은 없음, PK, FK, PK+FK 메뉴. PK는 글의 그 이름에 밑줄을 켜고 끈다', () => {
    const room = roomWith(MODEL);
    inRoom(room, <IePane />);
    press(cell('ie-key-과목.과목명'));
    expect([...screen.getByTestId('ie-key-menu').querySelectorAll('[role="menuitemradio"]')].map((b) => b.textContent)).toEqual(['없음', 'PK', 'FK', 'PK + FK']);
    expect(screen.getByTestId('ie-key-menu-none').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('ie-key-menu-pk'));
    expect(readRelationalSource(room.doc).underlines.map((r) => getRelationalText(room.doc).toString().slice(r.from, r.to))).toContain('과목명');
    expect(tag('과목.과목명')).toBe('PK');
    expect(cell('ie-null-과목.과목명').getAttribute('data-value')).toBe('not-null');
    choose('ie-key-과목.과목명', 'key', 'none');
    expect(tag('과목.과목명')).toBe('');
  });

  it('FK를 고르면 가리킬 테이블과 기본키를 골라 Foreign Key 줄을 더하고, 끄면 지운다. 그림의 ⌘Z 한 번에 돌아간다', () => {
    const room = roomWith(MODEL);
    inRoom(room, <IePane />);
    const before = getRelationalText(room.doc).toString();
    choose('ie-key-과목.과목명', 'key', 'fk');
    // 아직 글은 그대로이고 가리킬 곳을 고르는 칸이 뜬다
    expect(getRelationalText(room.doc).toString()).toBe(before);
    const table = screen.getByTestId('ie-fk-table') as HTMLSelectElement;
    expect([...table.options].map((o) => o.value)).toEqual(['학과', '학생', '과목', '수강']);
    expect(table.value).toBe('학과');
    expect((screen.getByTestId('ie-fk-column') as HTMLSelectElement).value).toBe('학과코드');
    // 기본키가 둘인 수강을 고르면 그 기본키들 중에서 고른다
    fireEvent.change(table, { target: { value: '수강' } });
    expect([...(screen.getByTestId('ie-fk-column') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['학번', '과목코드']);
    fireEvent.change(table, { target: { value: '학과' } });
    fireEvent.click(screen.getByTestId('ie-fk-confirm'));
    expect(screen.queryByTestId('ie-fk-form')).toBeNull();
    const lines = getRelationalText(room.doc).toString().split('\n');
    expect(lines.slice(3, 5)).toEqual(['과목 (과목코드, 과목명)', 'Foreign Key (과목명) references 학과 (학과코드)']);
    expect(tag('과목.과목명')).toBe('FK');
    expect(document.querySelector('.ie-link[data-child="과목"][data-parent="학과"]')).not.toBeNull();
    // FK 끄기: 그 줄을 지운다
    choose('ie-key-과목.과목명', 'key', 'none');
    expect(getRelationalText(room.doc).toString()).toBe(before);
    // PK+FK도 한 번에, 되돌리기 한 번에 글이 돌아간다
    choose('ie-key-수강.성적', 'key', 'pkfk');
    fireEvent.click(screen.getByTestId('ie-fk-confirm'));
    expect(tag('수강.성적')).toBe('PKFK');
    expect(getRelationalText(room.doc).toString().split('\n').at(-2)).toBe('Foreign Key (성적) references 학과 (학과코드)');
    fireEvent.keyDown(document.querySelector('.ie-stage')!, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(tag('수강.성적')).toBe('');
    expect(getRelationalText(room.doc).toString()).toBe(before);
  });

  it('기본키를 더하면 그 테이블을 가리키는 외래키로 전파해 글이 깨지지 않는다(되돌리기 한 번에 돌아간다)', () => {
    const room = roomWith(MODEL);
    inRoom(room, <IePane />);
    const before = getRelationalText(room.doc).toString();
    // 과목에 기본키를 더하면 수강(과목의 식별 자식)에 과목명이 기본키로 더해지고 references 목록이 늘어난다
    choose('ie-key-과목.과목명', 'key', 'pkfk');
    fireEvent.click(screen.getByTestId('ie-fk-confirm'));
    expect(screen.queryByTestId('ie-fk-form')).toBeNull();
    const lines = getRelationalText(room.doc).toString().split('\n');
    expect(lines.slice(3, 8)).toEqual([
      '과목 (과목코드, 과목명)',
      'Foreign Key (과목명) references 학과 (학과코드)',
      '수강 (학번, 과목코드, 성적, 과목명)',
      'Foreign Key (학번) references 학생',
      'Foreign Key (과목코드, 과목명) references 과목 (과목코드, 과목명)',
    ]);
    expect(tag('수강.과목명')).toBe('PKFK');
    expect(screen.queryByTestId('ie-problem-badge')).toBeNull();
    fireEvent.keyDown(document.querySelector('.ie-stage')!, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(getRelationalText(room.doc).toString()).toBe(before);
  });

  it('여러 컬럼으로 된 외래키의 한 컬럼은 FK를 끌 수 없고 이유를 알린다', () => {
    const room = roomWith(rich`A (${'x'}, ${'y'})\nB (${'k'}, x, y)\nForeign Key (x, y) references A\n`);
    inRoom(room, <IePane />);
    const before = getRelationalText(room.doc).toString();
    choose('ie-key-B.x', 'key', 'none');
    expect(getRelationalText(room.doc).toString()).toBe(before);
    expect(useToasts.getState().items.map((i) => i.message).join('\n')).toContain('여러 컬럼으로 된 외래키');
  });

  it('글에 오류가 있어도 그림에서 고친다. 기본키와 어긋난 외래키는 자동으로 맞추기 한 번에 고친다', () => {
    // 글에서 과목명에 밑줄을 그어 수강의 references 과목 (과목코드) 목록과 기본키 수가 어긋났다
    const room = roomWith(rich`학과 (${'학과코드'}, 학과명)
학생 (${'학번'}, 이름, 학과코드)
Foreign Key (학과코드) references 학과
과목 (${'과목코드'}, ${'과목명'})
수강 (${'학번'}, ${'과목코드'}, 성적)
Foreign Key (학번) references 학생
Foreign Key (과목코드) references 과목 (과목코드)
`);
    inRoom(room, <IePane />);
    expect(screen.getByTestId('ie-problem-badge').getAttribute('aria-label')).toMatch(/^오류 1/);
    press(cell('ie-name-학생.이름'));
    press(cell('ie-name-학생.이름'));
    const input = screen.getByTestId('ie-name-input-학생.이름') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '성명' } });
    fireEvent.blur(input);
    expect(getRelationalText(room.doc).toString().split('\n')[1]).toBe('학생 (학번, 성명, 학과코드)');
    expect(useToasts.getState().items.map((i) => i.message).join('\n')).not.toContain('오류');
    // 자동으로 맞추기: 수강(과목의 식별 자식)에 과목명이 기본키로 더해진다
    fireEvent.click(screen.getByTestId('ie-repair-keys'));
    expect(getRelationalText(room.doc).toString().split('\n').slice(4)).toEqual([
      '수강 (학번, 과목코드, 성적, 과목명)',
      'Foreign Key (학번) references 학생',
      'Foreign Key (과목코드, 과목명) references 과목 (과목코드, 과목명)',
      '',
    ]);
    expect(screen.queryByTestId('ie-problem-badge')).toBeNull();
    expect(screen.queryByTestId('ie-repair-keys')).toBeNull();
  });

  it('글을 고치면 IE가 바로 따라오고, 글에서 컬럼 이름을 바꾸면 설정 없는 새 컬럼이 된다', () => {
    const room = roomWith(MODEL);
    setColumnSetting(room.doc, '학생', '이름', { type: 'VARCHAR(20)', notNull: true });
    inRoom(room, <IePane />);
    expect(typeText('학생.이름')).toBe('VARCHAR(20)');
    remoteEdit(room.doc, (text) => {
      const at = text.toString().indexOf('이름');
      text.delete(at, 2);
      text.insert(at, '성명');
    });
    expect(screen.queryByTestId('ie-type-학생.이름')).toBeNull();
    expect(typeText('학생.성명')).toBe('');
    expect(cell('ie-null-학생.성명').getAttribute('data-value')).toBe('unset');
  });
});

// ───────────────────────── SQL ─────────────────────────

describe('IE pane 구조 편집', () => {
  /** 끌지 않고 누른다 */
  const press = (el: Element, x = 10, y = 10) => {
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: x, clientY: y });
    fireEvent.pointerUp(el, { pointerId: 1, button: 0, clientX: x, clientY: y });
  };
  /** el에서 눌러 to에서 놓는다(그 사이 dx, dy만큼 움직인다) */
  const dragTo = (el: Element, to: Element, dx: number, dy: number) => {
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(el, { pointerId: 1, button: 0, clientX: 10 + dx / 2, clientY: 10 + dy / 2 });
    fireEvent.pointerMove(el, { pointerId: 1, button: 0, clientX: 10 + dx, clientY: 10 + dy });
    fireEvent.pointerUp(to, { pointerId: 1, button: 0, clientX: 10 + dx, clientY: 10 + dy });
  };
  const boxOf = (table: string) => document.querySelector(`g.ie-table[data-table="${table}"] .ie-box`)!;
  const textOf = (room: Room) => getRelationalText(room.doc).toString();
  const underlinedWords = (room: Room) => {
    const src = readRelationalSource(room.doc);
    return src.underlines.map((u) => src.text.slice(u.from, u.to));
  };
  const toasts = () => useToasts.getState().items.map((i) => i.message).join('\n');
  const stage = () => document.querySelector('.ie-stage')!;
  const DEPT = rich`부서 (${'부서번호'}, 부서명)
사원 (${'사번'}, 이름)
`;

  beforeEach(() => useToasts.setState({ items: [] }));

  it('빈 그림에서 테이블을 더하면 글에 Table1 (id)가 생기고(id는 기본키), 자리를 적고, 바로 이름을 고친다', () => {
    const room = roomWith('');
    inRoom(room, <IePane />);
    fireEvent.click(screen.getByTestId('ie-empty-add'));
    expect(textOf(room)).toBe('Table1 (id)');
    expect(underlinedWords(room)).toEqual(['id']);
    expect(Object.keys(readIePositions(room.doc))).toEqual(['table1']);
    expect(screen.queryByTestId('ie-empty')).toBeNull();
    const input = screen.getByTestId('ie-table-name-input-Table1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '학생' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textOf(room)).toBe('학생 (id)');
    // 이름을 바꾸면 자리도 따라간다
    expect(Object.keys(readIePositions(room.doc))).toEqual(['학생']);
    // 도구 줄의 테이블 추가는 겹치지 않는 이름을 고르고 새 테이블도 IE_ORIGIN이라 ⌘Z로 글과 자리가 함께 돌아간다
    fireEvent.click(screen.getByTestId('ie-tool-add-table'));
    // 버튼만 눌러서는 생기지 않고, 그림을 누른 자리에 놓인다
    expect(textOf(room)).toBe('학생 (id)');
    press(document.querySelector('.ie-svg')!, 600, 400);
    expect(textOf(room)).toBe('학생 (id)\nTable1 (id)');
    fireEvent.keyDown(screen.getByTestId('ie-table-name-input-Table1'), { key: 'Escape' });
    fireEvent.keyDown(stage(), { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(textOf(room)).toBe('학생 (id)');
    expect(Object.keys(readIePositions(room.doc))).toEqual(['학생']);
  });

  it('빈 곳을 두 번 눌러도 테이블은 생기지 않는다. 테이블 추가 버튼을 누른 뒤 누른 자리에 놓이고, Esc는 그만둔다', () => {
    const room = roomWith('학생 (id)');
    inRoom(room, <IePane />);
    const svg = document.querySelector('.ie-svg')!;
    press(svg, 400, 300);
    press(svg, 400, 300);
    expect(textOf(room)).toBe('학생 (id)');
    fireEvent.click(screen.getByTestId('ie-tool-add-table'));
    expect(screen.getByTestId('ie-tool-add-table').getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('ie-tool-add-table').getAttribute('aria-pressed')).toBe('false');
    press(svg, 400, 300);
    expect(textOf(room)).toBe('학생 (id)');
    fireEvent.click(screen.getByTestId('ie-tool-add-table'));
    press(svg, 400, 300);
    expect(textOf(room)).toBe('학생 (id)\nTable1 (id)');
    const p = readIePositions(room.doc).table1;
    expect(p.x).toBe(400 - 110);
    expect(p.y).toBe(300 - 20);
  });

  it('컬럼 추가는 이름만 있는 컬럼을 더하고 바로 이름을 고친다. 행의 삭제 버튼은 컬럼을 뺀다', () => {
    const room = roomWith(MODEL);
    inRoom(room, <IePane />);
    fireEvent.click(screen.getByTestId('ie-add-column-학과'));
    expect(textOf(room).split('\n')[0]).toBe('학과 (학과코드, 학과명, column1)');
    // 타입은 추측하지 않는다
    expect(readColumnSettings(room.doc)[columnKey('학과', 'column1')]).toBeUndefined();
    const input = screen.getByTestId('ie-name-input-학과.column1') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '위치' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(textOf(room).split('\n')[0]).toBe('학과 (학과코드, 학과명, 위치)');
    fireEvent.click(screen.getByTestId('ie-delete-column-학과.위치'));
    expect(textOf(room).split('\n')[0]).toBe('학과 (학과코드, 학과명)');
    expect(screen.getByTestId('ie-delete-column-학과.학과명').getAttribute('aria-label')).toBe('학과 테이블의 학과명 컬럼 삭제');
  });

  it('테이블 삭제 버튼과 Delete 키는 테이블과 그 테이블에 걸린 Foreign Key 줄을 지운다', () => {
    const room = roomWith(MODEL);
    inRoom(room, <IePane />);
    fireEvent.click(screen.getByTestId('ie-delete-table-학생'));
    expect(textOf(room)).not.toContain('학생 (');
    expect(textOf(room)).not.toContain('references 학생');
    expect(document.querySelector('g.ie-table[data-table="학생"]')).toBeNull();
    // 상자를 눌러 고르고 Delete
    press(boxOf('과목'));
    expect(document.querySelector('g.ie-table[data-table="과목"]')!.getAttribute('data-selected')).toBe('true');
    fireEvent.keyDown(stage(), { key: 'Delete' });
    expect(textOf(room)).not.toContain('과목 (');
    expect(textOf(room)).not.toContain('references 과목');
    expect(textOf(room)).toContain('수강 (학번, 과목코드, 성적)');
  });

  const dot = (table: string, side = 'right') => screen.getByTestId(`ie-connect-${table}-${side}`);

  it('상자의 연결 점을 끌어 다른 상자에 놓으면 끈 쪽이 부모인 비식별 관계를 잇고, 그 관계를 고른다', () => {
    const room = roomWith(DEPT);
    const { container } = inRoom(room, <IePane />);
    // 관계 그리기 도구와 자동 정렬은 없다(도구 줄은 테이블 추가 하나)
    expect(screen.queryByTestId('ie-tool-arrange')).toBeNull();
    // 도구 줄: 테이블 추가와 DBMS 고르기
    expect(screen.getByTestId('ie-tools').querySelectorAll('button')).toHaveLength(2);
    expect(screen.getByTestId('ie-dialect-select')).toBeTruthy();
    expect(screen.queryByTestId('ie-tool-identifying')).toBeNull();
    expect(screen.queryByTestId('ie-tool-non-identifying')).toBeNull();
    expect(screen.queryByTestId('ie-tool-select')).toBeNull();
    expect(dot('부서').getAttribute('data-connect-from')).toBe('부서');
    const svg = document.querySelector('.ie-svg')!;
    fireEvent.pointerDown(dot('부서'), { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    // 끄는 동안 고무줄 선은 끈 연결 점에서 시작하고, 놓을 상자를 표시한다
    fireEvent.pointerMove(boxOf('사원'), { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    const rubber = screen.getByTestId('ie-rubber');
    const dotMark = dot('부서').querySelector('.ie-connect-dot-mark')!;
    expect(rubber.getAttribute('x1')).toBe(dotMark.getAttribute('cx'));
    expect(rubber.getAttribute('y1')).toBe(dotMark.getAttribute('cy'));
    expect(screen.getByTestId('ie-draft-target')).not.toBeNull();
    fireEvent.pointerUp(boxOf('사원'), { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    expect(textOf(room)).toContain('사원 (사번, 이름, 부서번호)\nForeign Key (부서번호) references 부서 (부서번호)');
    expect(underlinedWords(room)).toEqual(['부서번호', '사번']);
    const link = container.querySelector('.ie-link[data-link-id="사원#fk1"]')!;
    expect(link.getAttribute('data-identifying')).toBe('false');
    expect(link.getAttribute('data-parent')).toBe('부서');
    expect(link.getAttribute('data-selected')).toBe('true');
    expect(screen.queryByTestId('ie-rubber')).toBeNull();
    // 상자는 옮기지 않는다(다른 상자 자리만 함께 적는다)
    expect(readIePositions(room.doc).부서).toBeDefined();
    expect(svg).not.toBeNull();
  });

  it('작은 창에서 식별과 비식별을 바꾼다(외래키 컬럼의 기본키 밑줄, 되돌리기 한 번)', () => {
    const room = roomWith(DEPT);
    const { container } = inRoom(room, <IePane />);
    dragTo(dot('부서'), boxOf('사원'), 80, 120);
    const linkOf = () => container.querySelector('.ie-link[data-link-id="사원#fk1"]')!;
    expect(screen.getByTestId('ie-link-mode-non-identifying').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('ie-link-mode-identifying'));
    expect(linkOf().getAttribute('data-identifying')).toBe('true');
    expect(underlinedWords(room)).toEqual(['부서번호', '사번', '부서번호']);
    expect(textOf(room)).toContain('Foreign Key (부서번호) references 부서 (부서번호)');
    expect(screen.getByTestId('ie-link-mode-identifying').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('ie-link-mode-non-identifying'));
    expect(linkOf().getAttribute('data-identifying')).toBe('false');
    expect(underlinedWords(room)).toEqual(['부서번호', '사번']);
    fireEvent.keyDown(stage(), { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(linkOf().getAttribute('data-identifying')).toBe('true');
  });

  it('식별로 바꾸면 자식의 새 기본키를 손자 테이블로 전파한다(글 오류 없이, 되돌리기 한 번)', () => {
    const room = roomWith(rich`Table1 (${'id'})
Table2 (${'id'}, Table1_id)
Foreign Key (Table1_id) references Table1 (id)
Table3 (${'id'}, Table2_id, Table1_id)
Foreign Key (Table2_id) references Table2 (id)
Foreign Key (Table1_id) references Table1 (id)
`);
    const before = textOf(room);
    const { container } = inRoom(room, <IePane />);
    press(document.querySelector('.ie-link[data-link-id="Table2#fk1"] .ie-link-hit')!);
    fireEvent.click(screen.getByTestId('ie-link-mode-identifying'));
    expect(useToasts.getState().items.map((i) => i.message).join('\n')).not.toContain('오류');
    expect(container.querySelector('.ie-link[data-link-id="Table2#fk1"]')!.getAttribute('data-identifying')).toBe('true');
    expect(textOf(room)).toContain('Table3 (id, Table2_id, Table1_id, Table2_Table1_id)\nForeign Key (Table2_id, Table2_Table1_id) references Table2 (id, Table1_id)');
    expect(screen.queryByTestId('ie-problem-badge')).toBeNull();
    fireEvent.keyDown(stage(), { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(textOf(room)).toBe(before);
  });

  it('빈 곳이나 같은 상자에 놓거나 Esc를 누르면 잇지 않는다', () => {
    const room = roomWith(DEPT);
    inRoom(room, <IePane />);
    const svg = document.querySelector('.ie-svg')!;
    dragTo(dot('부서'), svg, 300, 300);
    expect(screen.queryByTestId('ie-rubber')).toBeNull();
    dragTo(dot('부서', 'left'), boxOf('부서'), 30, 30);
    fireEvent.pointerDown(dot('부서', 'top'), { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(svg, { pointerId: 1, button: 0, clientX: 200, clientY: 200 });
    expect(screen.getByTestId('ie-rubber')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('ie-rubber')).toBeNull();
    fireEvent.pointerUp(boxOf('사원'), { pointerId: 1, button: 0, clientX: 200, clientY: 200 });
    expect(textOf(room)).toBe(DEPT.text);
  });

  it('선을 누르면 관계를 고르고, 작은 창에서 지운다. 기본은 외래키 컬럼도 지우고, 끄면 컬럼은 남긴다', () => {
    const room = roomWith(MODEL);
    inRoom(room, <IePane />);
    press(document.querySelector('.ie-link[data-link-id="학생#fk1"] .ie-link-hit')!);
    expect(document.querySelector('.ie-link[data-link-id="학생#fk1"]')!.getAttribute('data-selected')).toBe('true');
    expect((screen.getByTestId('ie-link-drop-columns') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('ie-link-delete'));
    expect(textOf(room)).not.toContain('Foreign Key (학과코드) references 학과');
    expect(textOf(room)).toContain('학생 (학번, 이름)\n');
    expect(screen.queryByTestId('ie-link-pop')).toBeNull();

    press(document.querySelector('.ie-link[data-link-id="수강#fk2"] .ie-link-hit')!);
    fireEvent.click(screen.getByTestId('ie-link-drop-columns'));
    fireEvent.keyDown(stage(), { key: 'Backspace' });
    expect(textOf(room)).not.toContain('Foreign Key (과목코드) references 과목');
    expect(textOf(room)).toContain('수강 (학번, 과목코드, 성적)');
  });

  it('상자를 끌면 놓을 때 한 번만 자리를 적는다(다른 상자 자리도 함께 적어 튀지 않게)', () => {
    const room = roomWith(MODEL);
    inRoom(room, <IePane />);
    const before = { x: Number(boxOf('과목').getAttribute('x')), y: Number(boxOf('과목').getAttribute('y')) };
    const updates = vi.fn();
    room.doc.on('update', updates);
    fireEvent.pointerDown(boxOf('과목'), { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(boxOf('과목'), { pointerId: 1, button: 0, clientX: 60, clientY: 30 });
    fireEvent.pointerMove(boxOf('과목'), { pointerId: 1, button: 0, clientX: 110, clientY: 60 });
    // 끄는 동안은 화면만 움직인다
    expect(Number(boxOf('과목').getAttribute('x'))).toBe(before.x + 100);
    expect(updates).not.toHaveBeenCalled();
    fireEvent.pointerUp(boxOf('과목'), { pointerId: 1, button: 0, clientX: 110, clientY: 60 });
    expect(updates).toHaveBeenCalledTimes(1);
    const saved = readIePositions(room.doc);
    expect(saved.과목).toEqual({ x: before.x + 100, y: before.y + 50 });
    expect(Object.keys(saved).sort()).toEqual(['과목', '수강', '학과', '학생'].sort());
    // 끈 뒤에는 칸을 고치지 않는다
    expect(document.querySelector('[data-testid^="ie-type-input-"]')).toBeNull();
    // 팀원이 옮긴 자리도 바로 보인다
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(room.doc));
    const sv = Y.encodeStateVector(other);
    setIePosition(other, '학과', { x: 900, y: 700 });
    act(() => Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(other, sv), 'remote'));
    expect(boxOf('학과').getAttribute('x')).toBe('900');
  });

  it('부모에 기본키가 없으면 관계를 맺지 않고 이유를 알린다', () => {
    const room = roomWith('부서 (부서번호)\n사원 (사번)');
    inRoom(room, <IePane />);
    dragTo(dot('부서'), boxOf('사원'), 80, 120);
    expect(textOf(room)).toBe('부서 (부서번호)\n사원 (사번)');
    expect(toasts()).toContain('부모 테이블에 기본키가 없어서');
  });

  it('글에 오류가 있어도 구조 도구를 막지 않는다(고칠 수 없는 오류는 그대로 둔다)', () => {
    const src = rich`학생 (${'학번'}, 학과코드)\nForeign Key (학과코드) references 학과\n`;
    const room = roomWith(src);
    inRoom(room, <IePane />);
    for (const id of ['ie-tool-add-table', 'ie-add-column-학생', 'ie-delete-table-학생', 'ie-delete-column-학생.학과코드']) {
      expect(screen.getByTestId(id).getAttribute('aria-disabled')).toBeNull();
    }
    expect(screen.getByTestId('ie-connect-학생-right')).not.toBeNull();
    // 없는 테이블을 가리키는 외래키는 자동으로 맞출 수 없다
    expect(screen.queryByTestId('ie-repair-keys')).toBeNull();
    fireEvent.click(screen.getByTestId('ie-add-column-학생'));
    expect(textOf(room)).toBe('학생 (학번, 학과코드, column1)\nForeign Key (학과코드) references 학과\n');
    expect(toasts()).not.toContain('먼저 고쳐');
  });

  it('사용자의 깨진 방: 컬럼 더하기, 관계 잇기, 식별로 바꾸기가 모두 되고 자동으로 맞추기가 오류를 고친다', () => {
    const broken = rich`Table1 (${'id'}, dwqdwq)
Table2 (${'id'}, Table1_id)
Foreign Key (Table1_id) references Table1 (id)
Table3 (${'id'}, Table2_id, Table1_id)
Foreign Key (Table2_id, Table1_id) references Table2 (id, Table1_id)
Table4 (${'id'})`;
    const room = roomWith(broken);
    const { container } = inRoom(room, <IePane />);
    expect(screen.getByTestId('ie-repair-keys')).not.toBeNull();
    fireEvent.click(screen.getByTestId('ie-add-column-Table4'));
    dragTo(dot('Table1'), boxOf('Table4'), 80, 120);
    expect(textOf(room).split('\n').slice(-2)).toEqual(['Table4 (id, column1, Table1_id)', 'Foreign Key (Table1_id) references Table1 (id)']);
    press(document.querySelector('.ie-link[data-link-id="Table2#fk1"] .ie-link-hit')!);
    fireEvent.click(screen.getByTestId('ie-link-mode-identifying'));
    expect(container.querySelector('.ie-link[data-link-id="Table2#fk1"]')!.getAttribute('data-identifying')).toBe('true');
    expect(toasts()).not.toContain('오류');
    // Table2를 건드려서 어긋났던 Table3의 외래키도 함께 맞았다
    expect(screen.queryByTestId('ie-problem-badge')).toBeNull();
    expect(screen.queryByTestId('ie-repair-keys')).toBeNull();
    // 처음 글에서 자동으로 맞추기만 누르면 Table3의 어긋난 짝이 빠진다
    const room2 = roomWith(broken);
    cleanup();
    inRoom(room2, <IePane />);
    fireEvent.click(screen.getByTestId('ie-repair-keys'));
    expect(textOf(room2).split('\n').slice(3, 5)).toEqual(['Table3 (id, Table2_id)', 'Foreign Key (Table2_id) references Table2 (id)']);
    expect(screen.queryByTestId('ie-problem-badge')).toBeNull();
  });

  it('상자의 모든 선은 테두리와 같은 종류이고 상자 가장자리에서 끝난다. 테두리는 맨 위에 그린다', () => {
    inRoom(roomWith(MODEL), <IePane />);
    const g = document.querySelector('g.ie-table[data-table="학생"]')!;
    const box = g.querySelector('.ie-box')!;
    const x0 = Number(box.getAttribute('x'));
    const x1 = x0 + Number(box.getAttribute('width'));
    for (const line of g.querySelectorAll('.ie-head-line, .ie-colhead-line, .ie-row-line, .ie-divider')) {
      expect([Number(line.getAttribute('x1')), Number(line.getAttribute('x2'))]).toEqual([x0, x1]);
    }
    // 테두리는 칸 바탕보다 뒤(위)에 그려진다
    const outline = g.querySelector('.ie-box-line')!;
    const cells = [...g.querySelectorAll('.ie-cell-hit')];
    expect(cells.every((c) => c.compareDocumentPosition(outline) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(outline.getAttribute('height')).toBe(box.getAttribute('height'));
    // 컬럼 추가는 상자 바로 아래 왼쪽의 버튼이고, 아래 가운데 연결 점은 상자 바로 아래에 있어 겹치지 않는다
    const bottom = Number(box.getAttribute('y')) + Number(box.getAttribute('height'));
    const add = g.querySelector('foreignObject.ie-add-col')!;
    expect(Number(add.getAttribute('x'))).toBe(x0);
    expect(Number(add.getAttribute('y'))).toBeGreaterThan(bottom);
    const addRight = x0 + Number(add.getAttribute('width'));
    const dotMark = g.querySelector('[data-side="bottom"] .ie-connect-dot-mark')!;
    expect(Number(dotMark.getAttribute('cx')) - Number(dotMark.getAttribute('r'))).toBeGreaterThan(addRight);
    expect(g.querySelector('.ie-box-open, .ie-add-row')).toBeNull();
    // 선 끝 기호에도 넓은 투명 선이 있다
    expect(document.querySelectorAll('.ie-link[data-link-id="학생#fk1"] .ie-link-hit').length).toBeGreaterThan(1);
    // 관계 선에는 올려 둘 때의 후광이 있다
    expect(document.querySelectorAll('.ie-link .ie-link-glow').length).toBe(document.querySelectorAll('.ie-link').length);
  });

  it('보기 전용(편집기 없음)에서는 도구 줄과 상자 버튼이 없다', () => {
    const model: IeModel = { tables: [], links: [] };
    render(<IeDiagram model={model} layout={layoutIe(model)} />);
    expect(screen.queryByTestId('ie-tools')).toBeNull();
    expect(screen.getByTestId('ie-empty').textContent).toBe('관계 모델을 적거나 IE 다이어그램에서 테이블을 추가하면 여기에 나타납니다.');
  });
});

describe('컬럼 설정 표', () => {
  const tables: SettingsTable[] = [
    {
      name: '학생',
      columns: [
        { name: '학번', primaryKey: true, setting: {}, inheritedType: null, missingType: true },
        { name: '이름', primaryKey: false, setting: { type: 'VARCHAR(20)', notNull: true }, inheritedType: null, missingType: false },
        { name: '학과코드', primaryKey: false, setting: { notNull: false, unique: true }, inheritedType: 'CHAR(4)', missingType: false },
      ],
    },
  ];

  it('NULL은 미지정, NOT NULL, NULL 허용 셋이고 기본키는 NOT NULL로 잠근다', () => {
    const onChange = vi.fn();
    render(<ColumnSettingsTable tables={tables} onChange={onChange} />);
    const sel = (c: string) => screen.getByTestId(`null-select-학생.${c}`) as HTMLSelectElement;
    expect([...sel('이름').options].map((o) => o.textContent)).toEqual(['미지정', 'NOT NULL', 'NULL 허용']);
    expect(sel('학번').value).toBe('not-null');
    expect(sel('학번').disabled).toBe(true);
    expect(sel('이름').value).toBe('not-null');
    expect(sel('학과코드').value).toBe('null');

    fireEvent.change(sel('이름'), { target: { value: 'unset' } });
    expect(onChange).toHaveBeenLastCalledWith('학생', '이름', { notNull: undefined });
    fireEvent.change(sel('이름'), { target: { value: 'null' } });
    expect(onChange).toHaveBeenLastCalledWith('학생', '이름', { notNull: false });
    fireEvent.change(sel('학과코드'), { target: { value: 'not-null' } });
    expect(onChange).toHaveBeenLastCalledWith('학생', '학과코드', { notNull: true });
  });

  it('타입은 기본값 없이 비어 있고, Enter나 칸을 떠날 때 쓰며 Esc는 버린다. 비우면 지운다', () => {
    const onChange = vi.fn();
    render(<ColumnSettingsTable tables={tables} onChange={onChange} />);
    const input = (c: string) => screen.getByTestId(`type-input-학생.${c}`) as HTMLInputElement;
    expect(input('학번').value).toBe('');
    // 빈 칸은 옅은 '타입' 자리 표시만 보인다
    expect(input('학번').placeholder).toBe('타입');
    expect(input('학번').dataset.missing).toBe('true');
    expect(input('이름').value).toBe('VARCHAR(20)');
    expect(input('학과코드').placeholder).toBe('CHAR(4)');

    fireEvent.focus(input('학번'));
    fireEvent.change(input('학번'), { target: { value: ' INT ' } });
    fireEvent.keyDown(input('학번'), { key: 'Enter' });
    fireEvent.blur(input('학번'));
    expect(onChange).toHaveBeenLastCalledWith('학생', '학번', { type: 'INT' });

    onChange.mockClear();
    fireEvent.focus(input('이름'));
    fireEvent.change(input('이름'), { target: { value: 'TEXT' } });
    fireEvent.keyDown(input('이름'), { key: 'Escape' });
    fireEvent.blur(input('이름'));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.focus(input('이름'));
    fireEvent.change(input('이름'), { target: { value: '' } });
    fireEvent.blur(input('이름'));
    expect(onChange).toHaveBeenLastCalledWith('학생', '이름', { type: undefined });
  });

  it('UNIQUE를 켜고 끈다', () => {
    const onChange = vi.fn();
    render(<ColumnSettingsTable tables={tables} onChange={onChange} />);
    const box = (c: string) => screen.getByTestId(`unique-학생.${c}`) as HTMLInputElement;
    expect(box('학과코드').checked).toBe(true);
    expect(box('이름').checked).toBe(false);
    fireEvent.click(box('이름'));
    expect(onChange).toHaveBeenLastCalledWith('학생', '이름', { unique: true });
    fireEvent.click(box('학과코드'));
    expect(onChange).toHaveBeenLastCalledWith('학생', '학과코드', { unique: undefined });
  });
});

describe('SQL pane', () => {
  it('글이 없으면 한 줄만 보이고 복사와 내려받기를 막는다', () => {
    inRoom(roomWith(''), <SqlPane />);
    expect(screen.getByTestId('sql-empty').textContent).toBe('관계 모델을 적거나 IE 다이어그램에서 테이블을 추가하면 여기에 나타납니다.');
    expect((screen.getByTestId('sql-copy') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('sql-download') as HTMLButtonElement).disabled).toBe(true);
  });

  it('타입을 정하지 않은 컬럼 수를 한 줄로 보이고, 누르면 표의 첫 칸으로 간다', () => {
    inRoom(roomWith(MODEL), <SqlPane />);
    const line = screen.getByTestId('sql-missing-types');
    // 아무 타입도 정하지 않았으니 열 컬럼 모두(외래키도 물려받을 타입이 없다)
    expect(line.textContent).toBe('타입을 정하지 않은 컬럼 10개');
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    fireEvent.click(line);
    expect(document.activeElement).toBe(screen.getByTestId('type-input-학과.학과코드'));
    expect(scroll).toHaveBeenCalled();
    // 설명 글은 없다
    expect(screen.getByTestId('sql-settings').querySelector('p')).toBeNull();
  });

  it('설정을 방 문서에 쓰고, SQL과 IE가 바로 따라간다', () => {
    const room = roomWith(MODEL);
    const { container } = inRoom(
      room,
      <>
        <SqlPane />
        <IePane />
      </>,
    );
    const input = screen.getByTestId('type-input-학생.이름') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'VARCHAR(20)' } });
    fireEvent.blur(input);
    const settings = readColumnSettings(room.doc);
    expect(Object.values(settings)).toContainEqual({ type: 'VARCHAR(20)' });
    expect(screen.getByTestId('sql-code').textContent).toMatch(/`이름` VARCHAR\(20\)/);
    expect(screen.getByTestId('sql-missing-types').textContent).toBe('타입을 정하지 않은 컬럼 9개');
    // 가리키는 기본키에 타입을 정하면 외래키 컬럼은 그 타입을 물려받는다(칸에는 흐리게 보인다)
    const pk = screen.getByTestId('type-input-학과.학과코드') as HTMLInputElement;
    fireEvent.focus(pk);
    fireEvent.change(pk, { target: { value: 'CHAR(4)' } });
    fireEvent.blur(pk);
    expect(screen.getByTestId('sql-missing-types').textContent).toBe('타입을 정하지 않은 컬럼 7개');
    expect((screen.getByTestId('type-input-학생.학과코드') as HTMLInputElement).placeholder).toBe('CHAR(4)');
    expect(container.querySelector('[data-table="학생"] [data-column="이름"]')!.getAttribute('data-type')).toBe('VARCHAR(20)');

    // NULL 허용으로 정하면 그 외래키가 가리키는 쪽의 선 끝이 '없거나 하나'가 된다
    fireEvent.change(screen.getByTestId('null-select-학생.학과코드'), { target: { value: 'null' } });
    const link = [...container.querySelectorAll<SVGGElement>('.ie-link')].find((g) => g.dataset.child === '학생')!;
    expect(link.dataset.parentEnd).toBe('zero-or-one');
    fireEvent.change(screen.getByTestId('null-select-학생.학과코드'), { target: { value: 'not-null' } });
    expect(link.dataset.parentEnd).toBe('exactly-one');
    expect(screen.getByTestId('sql-code').textContent).toMatch(/`학과코드` \S+ NOT NULL/);
  });

  it('방언을 바꾸고 기억한다', () => {
    inRoom(
      roomWith(MODEL),
      <SqlPane />,
    );
    const button = screen.getByTestId('dialect-select');
    // 펼친 목록은 지금 값에 체크가 있고, Esc로 닫힌다
    fireEvent.click(button);
    const menu = screen.getByTestId('dialect-select-menu');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(screen.getByTestId('dialect-select-menu-mysql').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByTestId('dialect-select-menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // 키보드로: 아래 방향키로 열고, 아래로 옮겨 Enter
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('dialect-select-menu-mysql'));
    fireEvent.keyDown(screen.getByTestId('dialect-select-menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('dialect-select-menu-postgresql'));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(screen.getByTestId('pane-sql').dataset.dialect).toBe('postgresql');
    expect(document.activeElement).toBe(button);
    expect(screen.getByTestId('sql-code').textContent).toContain('"학생"');
    expect(localStorage.getItem('chen-erd.sql.dialect')).toBe('postgresql');
  });
});

function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}
