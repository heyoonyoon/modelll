// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { RoomContext } from '../collab/hooks';
import { LOCAL_ORIGIN, addEdges, addNodes, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode } from '../collab/docOps';
import { ElementStore, type Room } from '../collab/room';
import { useUi } from '../state/ui';

// 다른 담당의 모듈은 계약(시그니처)만 흉내 낸다
const mocks = vi.hoisted(() => ({
  fitNodeSize: vi.fn((..._a: unknown[]) => ({ w: 200, h: 80 })),
  growToFit: vi.fn((..._a: unknown[]): { x: number; y: number; w: number; h: number } | null => null),
}));
vi.mock('../text/measure', () => ({ fitNodeSize: mocks.fitNodeSize, growToFit: mocks.growToFit }));
vi.mock('../canvas/PresetIcon', () => ({ PresetIcon: ({ presetId }: { presetId: string }) => <svg data-preset={presetId} /> }));
vi.mock('../../shared/rules', () => {
  const pair = (a: ErdNode, b: ErdNode, x: string, y: string) => (a.kind === x && b.kind === y) || (a.kind === y && b.kind === x);
  return {
    edgeHasCardinality: (a: ErdNode, b: ErdNode) => pair(a, b, 'entity', 'relationship'),
    edgeCanBeDouble: (a: ErdNode, b: ErdNode) => pair(a, b, 'entity', 'relationship') || pair(a, b, 'entity', 'spec'),
  };
});

import { Inspector } from './Inspector';

function makeRoom(): Room {
  const doc = new Y.Doc();
  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  return {
    id: 'testroom',
    doc,
    undo: new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 }),
    nodes: new ElementStore<ErdNode>(nodesMap, readNode),
    edges: new ElementStore<ErdEdge>(edgesMap, readEdge),
  } as unknown as Room;
}

function n(id: string, kind: ErdNode['kind'], extra: Partial<ErdNode> = {}): ErdNode {
  return { id, kind, x: 0, y: 0, w: 100, h: 50, text: id, ...extra };
}
function e(id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge {
  return { id, source, target, double: false, label: '', role: '', ...extra };
}

let room: Room;

function setup(nodes: ErdNode[], edges: ErdEdge[], selection: string[]) {
  addNodes(room.doc, nodes);
  addEdges(room.doc, edges);
  room.undo.clear();
  useUi.getState().setSelection(selection);
  return render(
    <RoomContext.Provider value={room}>
      <Inspector />
    </RoomContext.Provider>,
  );
}
/** 다른 접속자가 고친 것처럼 문서를 바꾼다 */
function remote(fn: () => void) {
  act(() => room.doc.transact(fn, 'remote'));
}
const yNode = (id: string) => getNodesMap(room.doc).get(id)!;
const yEdge = (id: string) => getEdgesMap(room.doc).get(id)!;
const field = (testId: string) => screen.getByTestId(testId) as HTMLInputElement | HTMLTextAreaElement;
function type(testId: string, value: string) {
  const el = field(testId);
  act(() => el.focus());
  fireEvent.change(el, { target: { value } });
  return el;
}

beforeEach(() => {
  useUi.getState().reset();
  room = makeRoom();
  mocks.fitNodeSize.mockClear();
  mocks.growToFit.mockReset();
  mocks.growToFit.mockReturnValue(null);
});
afterEach(() => cleanup());

describe('노드 하나', () => {
  it('종류 격자에 11개가 있고 현재 종류를 강조한다', () => {
    setup([n('학생', 'entity', { weak: true })], [], ['학생']);
    expect(screen.getByTestId('inspector')).toBeTruthy();
    expect(screen.getAllByTestId(/^inspector-preset-/)).toHaveLength(11);
    // 종류 이름만 쓰고 영어 이름이나 설명은 없다
    expect(screen.getByTestId('inspector').querySelector('.inspector-preset-name')!.textContent).toBe('약한 엔티티');
    expect(screen.queryByTestId('inspector-preset-derived-attribute')).toBeNull();
    expect(screen.getByTestId('inspector-preset-weak-entity').className).toContain('is-active');
    expect(screen.getByTestId('inspector-preset-entity').className).not.toContain('is-active');
  });

  it('종류를 바꾸면 옛 플래그를 지우고 글자와 중심을 유지한다', () => {
    setup([n('a', 'attribute', { keyType: 'key', multivalued: true, text: '학번', x: 100, y: 100, w: 120, h: 50 })], [e('e1', 'a', 'b')], ['a']);
    fireEvent.click(screen.getByTestId('inspector-preset-identifying-relationship'));
    const m = yNode('a');
    expect(m.toJSON()).toEqual({ id: 'a', kind: 'relationship', identifying: true, text: '학번', x: 60, y: 85, w: 200, h: 80 });
    expect(mocks.fitNodeSize).toHaveBeenCalledWith({ kind: 'relationship', identifying: true }, '학번');
    expect(getEdgesMap(room.doc).has('e1')).toBe(true);
    // 실행 취소 한 번으로 되돌아간다
    act(() => room.undo.undo());
    expect(yNode('a').toJSON()).toMatchObject({ kind: 'attribute', keyType: 'key', multivalued: true, w: 120 });
  });

  it('종류 아이콘과 겹치는 칸(약한 엔티티, 식별 관계, 식별자 표시, 다중값, 특수화 d와 o, 크기)은 없다. 종류 아이콘으로 바꾼다', () => {
    const view = setup([n('e', 'entity'), n('r', 'relationship'), n('a', 'attribute'), n('s', 'spec', { specType: 'd', text: '' })], [], ['e']);
    const gone = ['inspector-weak', 'inspector-identifying', 'inspector-key-none', 'inspector-multivalued', 'inspector-spec-d', 'inspector-width', 'inspector-height'];
    for (const sel of ['e', 'r', 'a', 's']) {
      act(() => useUi.getState().setSelection([sel]));
      for (const id of gone) expect(screen.queryByTestId(id)).toBeNull();
    }
    // 종류 아이콘으로 고친다
    act(() => useUi.getState().setSelection(['r']));
    fireEvent.click(screen.getByTestId('inspector-preset-identifying-relationship'));
    expect(yNode('r').get('identifying')).toBe(true);
    act(() => useUi.getState().setSelection(['s']));
    expect(screen.queryByTestId('inspector-text')).toBeNull();
    expect(screen.queryByTestId('inspector-fit')).toBeNull();
    fireEvent.click(screen.getByTestId('inspector-preset-spec-o'));
    expect(yNode('s').get('specType')).toBe('o');
    // 묶음 제목은 종류, 글자, 색뿐이다(빈 옵션, 크기 제목이 없다)
    act(() => useUi.getState().setSelection(['a']));
    expect(Array.from(screen.getByTestId('inspector').querySelectorAll('.inspector-section-title'), (el) => el.textContent)).toEqual(['종류', '글자', '색']);
    view.unmount();
  });

  it('예전에 만든 유도 속성은 그대로 두고, 종류를 바꾸면 derived를 지운다', () => {
    setup([n('a', 'attribute', { derived: true, text: '평점', x: 100, y: 100, w: 120, h: 50 })], [], ['a']);
    // 고를 수 있는 종류로는 보통 속성으로 보인다
    expect(screen.getByTestId('inspector-preset-attribute').className).toContain('is-active');
    expect(screen.queryByTestId('inspector-derived')).toBeNull();
    fireEvent.click(screen.getByTestId('inspector-preset-multivalued-attribute'));
    expect(yNode('a').has('derived')).toBe(false);
    expect(yNode('a').get('multivalued')).toBe(true);
  });

  it('글자는 blur에서 확정하고 growToFit 결과를 한 번에 적용한다', () => {
    setup([n('a', 'entity', { text: '학생' })], [], ['a']);
    mocks.growToFit.mockReturnValue({ x: -20, y: 0, w: 140, h: 50 });
    const el = type('inspector-text', '학생\n(재학생)\n');
    expect(yNode('a').get('text')).toBe('학생');
    act(() => el.blur());
    expect(yNode('a').toJSON()).toMatchObject({ text: '학생\n(재학생)', x: -20, w: 140 });
    expect(room.undo.undoStack).toHaveLength(1);
    expect(field('inspector-text').value).toBe('학생\n(재학생)');
  });

  it('Cmd/Ctrl+Enter로 확정하고 그냥 Enter와 조합 중 Enter는 확정하지 않는다', () => {
    setup([n('a', 'entity', { text: '학생' })], [], ['a']);
    const el = type('inspector-text', '교수');
    fireEvent.keyDown(el, { key: 'Enter', code: 'Enter' });
    expect(yNode('a').get('text')).toBe('학생');
    fireEvent.keyDown(el, { key: 'Enter', code: 'Enter', ctrlKey: true, isComposing: true });
    expect(yNode('a').get('text')).toBe('학생');
    fireEvent.keyDown(el, { key: 'Enter', code: 'Enter', metaKey: true });
    expect(yNode('a').get('text')).toBe('교수');
    expect(document.activeElement).not.toBe(el);
  });

  it('Esc는 입력을 취소하고 포커스를 뺀다', () => {
    setup([n('a', 'entity', { text: '학생' })], [], ['a']);
    const el = type('inspector-text', '지울 글자');
    fireEvent.keyDown(el, { key: 'Escape', code: 'Escape' });
    expect(document.activeElement).not.toBe(el);
    expect(yNode('a').get('text')).toBe('학생');
    expect(field('inspector-text').value).toBe('학생');
  });

  it('입력 칸의 키 입력은 전역 단축키로 새지 않는다', () => {
    setup([n('a', 'entity')], [], ['a']);
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);
    try {
      const el = field('inspector-text');
      act(() => el.focus());
      fireEvent.keyDown(el, { key: 'Backspace', code: 'Backspace' });
      fireEvent.keyDown(el, { key: 'v', code: 'KeyV' });
      fireEvent.keyDown(el, { key: 'Escape', code: 'Escape' });
      expect(onKey).not.toHaveBeenCalled();
      expect(useUi.getState().selection).toEqual(['a']);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });

  it('다른 사람이 바꾼 값은 내가 입력 중이 아닐 때만 화면에 반영한다', () => {
    setup([n('a', 'entity', { text: '학생' })], [], ['a']);
    remote(() => yNode('a').set('text', '교수'));
    expect(field('inspector-text').value).toBe('교수');

    const el = type('inspector-text', '교수님');
    remote(() => yNode('a').set('text', '직원'));
    expect(field('inspector-text').value).toBe('교수님');
    act(() => el.blur());
    expect(yNode('a').get('text')).toBe('교수님');
  });

  it('포커스만 두고 고치지 않았으면 다른 사람의 값을 덮어쓰지 않는다', () => {
    setup([n('a', 'entity', { text: '학생' })], [], ['a']);
    const el = field('inspector-text');
    act(() => el.focus());
    remote(() => yNode('a').set('text', '직원'));
    act(() => el.blur());
    expect(yNode('a').get('text')).toBe('직원');
    expect(field('inspector-text').value).toBe('직원');
  });

  it('입력 중에 선택이 바뀌면 원래 도형에 확정한다', () => {
    setup([n('a', 'entity', { text: '학생' }), n('b', 'entity', { text: '과목' })], [], ['a']);
    type('inspector-text', '학생2');
    act(() => useUi.getState().setSelection(['b']));
    expect(yNode('a').get('text')).toBe('학생2');
    expect(yNode('b').get('text')).toBe('과목');
    expect(field('inspector-text').value).toBe('과목');
  });

  it('글자에 맞추기(글자 칸 바로 아래)', () => {
    setup([n('a', 'entity', { x: 100, y: 100, w: 100, h: 50 })], [], ['a']);
    fireEvent.click(screen.getByTestId('inspector-fit'));
    expect(screen.getByTestId('inspector-fit').closest('section')).toBe(screen.getByTestId('inspector-text').closest('section'));
    expect(yNode('a').toJSON()).toMatchObject({ x: 50, y: 85, w: 200, h: 80 });
  });

  it('삭제하면 붙은 선도 지워지고 선택이 비워진다', () => {
    setup([n('a', 'entity'), n('b', 'relationship')], [e('e1', 'a', 'b')], ['a']);
    fireEvent.click(screen.getByTestId('inspector-delete'));
    expect(getNodesMap(room.doc).has('a')).toBe(false);
    expect(getEdgesMap(room.doc).has('e1')).toBe(false);
    expect(useUi.getState().selection).toEqual([]);
    expect(screen.queryByTestId('inspector')).toBeNull();
  });
});

describe('엣지 하나', () => {
  const er = () => [n('학생', 'entity'), n('r', 'relationship', { text: '' }), n('나이', 'attribute'), n('s', 'spec', { specType: 'd', text: '' })];

  it('양 끝 이름을 보여 주고 글자가 비면 종류 이름을 쓴다', () => {
    setup(er(), [e('e1', '학생', 'r')], ['e1']);
    expect(screen.getByTestId('inspector-edge-name').textContent).toBe('학생 — 관계');
  });

  it('카디널리티: 선택 칸과 직접 입력', () => {
    setup(er(), [e('e1', '학생', 'r')], ['e1']);
    expect(screen.getByTestId('inspector-cardinality-none').className).toContain('is-active');
    fireEvent.click(screen.getByTestId('inspector-cardinality-N'));
    expect(yEdge('e1').get('label')).toBe('N');
    expect(screen.getByTestId('inspector-cardinality-N').className).toContain('is-active');
    expect(field('inspector-cardinality-input').value).toBe('N');

    const input = type('inspector-cardinality-input', ' 0..1 ');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(yEdge('e1').get('label')).toBe('0..1');
    expect(screen.getByTestId('inspector').querySelectorAll('[data-testid^="inspector-cardinality-"].is-active')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('inspector-cardinality-none'));
    expect(yEdge('e1').get('label')).toBe('');
  });

  it('선 종류와 역할 이름(설명 문장은 없다)', () => {
    setup(er(), [e('e1', '학생', 'r')], ['e1']);
    expect(screen.getByTestId('inspector').textContent).not.toContain('이중선은');
    expect(screen.getByTestId('inspector').querySelector('.inspector-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('inspector-line-double'));
    expect(yEdge('e1').get('double')).toBe(true);
    fireEvent.click(screen.getByTestId('inspector-line-single'));
    expect(yEdge('e1').get('double')).toBe(false);

    const role = type('inspector-role', '수강생');
    act(() => role.blur());
    expect(yEdge('e1').get('role')).toBe('수강생');
  });

  it('엔티티와 특수화 원 사이: 카디널리티와 역할은 쓰지 않는다(안내 문장 없이 막아 둔다)', () => {
    setup(er(), [e('e1', '학생', 's')], ['e1']);
    const text = screen.getByTestId('inspector').textContent ?? '';
    expect(text).not.toContain('이중선은');
    expect(text).not.toContain('엔티티와 관계 사이의 선에만');
    expect((screen.getByTestId('inspector-cardinality-1') as HTMLButtonElement).disabled).toBe(true);
    expect(field('inspector-cardinality-input').disabled).toBe(true);
    expect(screen.queryByTestId('inspector-role')).toBeNull();
    expect((screen.getByTestId('inspector-line-double') as HTMLButtonElement).disabled).toBe(false);
  });

  it('속성에 붙은 선은 이중선을 고를 수 없지만, 이미 들어 있는 값은 지울 수 있다', () => {
    setup(er(), [e('e1', '학생', '나이', { double: true, label: 'N' })], ['e1']);
    expect((screen.getByTestId('inspector-line-double') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('inspector-cardinality-M') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('inspector-line-single'));
    fireEvent.click(screen.getByTestId('inspector-cardinality-none'));
    expect(yEdge('e1').toJSON()).toMatchObject({ double: false, label: '' });
    expect((screen.getByTestId('inspector-line-single') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('inspector-cardinality-none') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('여러 개 선택', () => {
  it('요약과 정렬, 3개부터 간격 균등', () => {
    setup([n('a', 'entity', { x: 0 }), n('b', 'relationship', { x: 30, y: 80 }), n('c', 'entity', { x: 400, y: 160 })], [e('e1', 'a', 'b')], ['a', 'b', 'e1']);
    expect(screen.getByTestId('inspector-summary').textContent).toBe('도형 2개, 선 1개');
    expect(screen.getAllByTestId(/^inspector-align-/)).toHaveLength(6);
    expect(screen.getByTestId('inspector-align-left').getAttribute('title')).toBe('왼쪽 맞춤');
    expect(screen.queryByTestId('inspector-distribute-h')).toBeNull();

    fireEvent.click(screen.getByTestId('inspector-align-left'));
    expect(yNode('b').get('x')).toBe(0);
    expect(room.undo.undoStack).toHaveLength(1);

    act(() => useUi.getState().setSelection(['a', 'b', 'c']));
    expect(screen.getByTestId('inspector-summary').textContent).toBe('도형 3개, 선 0개');
    fireEvent.click(screen.getByTestId('inspector-distribute-h'));
    expect(yNode('b').get('x')).toBe(200);
    fireEvent.click(screen.getByTestId('inspector-distribute-v'));
    expect(yNode('b').get('y')).toBe(80);
  });

  it('같은 성격의 선은 한꺼번에 바꾼다', () => {
    setup(
      [n('a', 'entity'), n('r', 'relationship'), n('b', 'entity'), n('x', 'attribute')],
      [e('e1', 'a', 'r', { label: '1' }), e('e2', 'r', 'b', { label: 'N' }), e('e3', 'a', 'x')],
      ['e1', 'e2'],
    );
    // 값이 섞여 있으면 아무것도 강조하지 않는다
    expect(screen.getByTestId('inspector').querySelectorAll('[data-testid^="inspector-cardinality-"].is-active')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('inspector-cardinality-M'));
    fireEvent.click(screen.getByTestId('inspector-line-double'));
    expect(yEdge('e1').toJSON()).toMatchObject({ label: 'M', double: true });
    expect(yEdge('e2').toJSON()).toMatchObject({ label: 'M', double: true });
    expect(screen.queryByTestId('inspector-role')).toBeNull();

    // 성격이 다른 선이 섞이면 일괄 변경을 보여 주지 않는다
    act(() => useUi.getState().setSelection(['e1', 'e2', 'e3']));
    expect(screen.getByTestId('inspector-summary').textContent).toBe('도형 0개, 선 3개');
    expect(screen.queryByTestId('inspector-line-double')).toBeNull();
  });

  it('모두 속성이면 한꺼번에 켜고 끈다', () => {
    setup([n('a', 'attribute', { multivalued: true }), n('b', 'attribute'), n('c', 'entity')], [], ['a', 'b']);
    const toggle = screen.getByTestId('inspector-multivalued');
    expect(toggle.getAttribute('aria-checked')).toBe('mixed');
    fireEvent.click(toggle);
    expect([yNode('a').get('multivalued'), yNode('b').get('multivalued')]).toEqual([true, true]);
    fireEvent.click(toggle);
    expect([yNode('a').has('multivalued'), yNode('b').has('multivalued')]).toEqual([false, false]);
    fireEvent.click(screen.getByTestId('inspector-key-key'));
    expect([yNode('a').get('keyType'), yNode('b').get('keyType')]).toEqual(['key', 'key']);

    act(() => useUi.getState().setSelection(['a', 'b', 'c']));
    expect(screen.queryByTestId('inspector-multivalued')).toBeNull();
  });

  it('삭제', () => {
    setup([n('a', 'entity'), n('b', 'entity'), n('c', 'entity')], [], ['a', 'b']);
    fireEvent.click(screen.getByTestId('inspector-delete'));
    expect(Array.from(getNodesMap(room.doc).keys())).toEqual(['c']);
  });
});

describe('선 모양(붙는 위치는 캔버스의 끝점 손잡이로 고른다)', () => {
  const nodes = () => [n('학생', 'entity'), n('수강', 'relationship'), n('나이', 'attribute'), n('과목', 'entity')];
  const sectionTitles = () => Array.from(screen.getByTestId('inspector').querySelectorAll('.inspector-section-title'), (el) => el.textContent);

  it('구역 순서: 카디널리티, 선 종류, 역할 이름, 선 모양, 색(붙는 위치 구역은 없다)', () => {
    setup(nodes(), [e('e1', '학생', '수강')], ['e1']);
    expect(sectionTitles()).toEqual(['카디널리티', '선 종류', '역할 이름', '선 모양', '색']);
    expect(screen.queryByTestId('inspector-source-side-auto')).toBeNull();
    expect(screen.queryByTestId('inspector-anchor-reset')).toBeNull();
    expect(screen.getByTestId('inspector').textContent).not.toContain('마름모는');
  });

  it('선 모양: 기본은 직선이고 꺾은선은 직접 고른다', () => {
    setup(nodes(), [e('e1', '학생', '수강'), e('e2', '학생', '나이')], ['e1']);
    expect(screen.queryByTestId('inspector-shape-auto')).toBeNull();
    expect(screen.getByTestId('inspector-shape-straight').className).toContain('is-active');

    fireEvent.click(screen.getByTestId('inspector-shape-elbow'));
    expect(yEdge('e1').get('shape')).toBe('elbow');
    expect(screen.getByTestId('inspector-shape-elbow').className).toContain('is-active');
    // 직선으로 되돌리면 문서에서 모양을 지운다
    fireEvent.click(screen.getByTestId('inspector-shape-straight'));
    expect(yEdge('e1').has('shape')).toBe(false);

    // 붙는 면을 정해도 직선이다
    remote(() => yEdge('e2').set('sourceSide', 'bottom'));
    act(() => useUi.getState().setSelection(['e2']));
    expect(yEdge('e2').has('shape')).toBe(false);
    expect(screen.getByTestId('inspector-shape-straight').className).toContain('is-active');
  });

  it('선 모양: 재귀 관계의 선은 기본이 꺾은선이고 직선은 직접 고른다', () => {
    setup(nodes(), [e('e1', '학생', '수강', { sourceSide: 'bottom', targetSide: 'top' }), e('e2', '학생', '수강')], ['e2']);
    expect(screen.getByTestId('inspector-shape-elbow').className).toContain('is-active');

    fireEvent.click(screen.getByTestId('inspector-shape-straight'));
    expect(yEdge('e2').get('shape')).toBe('straight');
    expect(screen.getByTestId('inspector-shape-straight').className).toContain('is-active');
    // 기본 모양으로 되돌리면 문서에서 모양을 지운다
    fireEvent.click(screen.getByTestId('inspector-shape-elbow'));
    expect(yEdge('e2').has('shape')).toBe(false);

    // 면을 정한 쪽 선도 같은 기본을 따른다
    act(() => useUi.getState().setSelection(['e1']));
    expect(screen.getByTestId('inspector-shape-elbow').className).toContain('is-active');
  });

  it('여러 선: 선 모양만 한꺼번에 바꾸고 붙는 위치는 보여 주지 않는다', () => {
    setup(nodes(), [e('e1', '학생', '수강'), e('e2', '수강', '과목', { shape: 'elbow' }), e('e3', '학생', '나이')], ['e1', 'e2']);
    expect(screen.queryByTestId('inspector-source-side-auto')).toBeNull();
    expect(screen.queryByTestId('inspector-anchor-reset')).toBeNull();
    // 값이 섞여 있으면 아무것도 강조하지 않는다
    expect(screen.getByTestId('inspector').querySelectorAll('[data-testid^="inspector-shape-"].is-active')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('inspector-shape-elbow'));
    expect([yEdge('e1').get('shape'), yEdge('e2').get('shape')]).toEqual(['elbow', 'elbow']);
    expect(yEdge('e3').has('shape')).toBe(false);
    expect(room.undo.undoStack).toHaveLength(1);
    fireEvent.click(screen.getByTestId('inspector-shape-straight'));
    expect([yEdge('e1').has('shape'), yEdge('e2').has('shape')]).toEqual([false, false]);
    expect(screen.getByTestId('inspector-shape-straight').className).toContain('is-active');

    // 성격이 다른 선이 섞여도 선 모양은 바꿀 수 있다
    act(() => useUi.getState().setSelection(['e1', 'e2', 'e3', '학생']));
    expect(screen.queryByTestId('inspector-line-double')).toBeNull();
    fireEvent.click(screen.getByTestId('inspector-shape-elbow'));
    expect(['e1', 'e2', 'e3'].map((id) => yEdge(id).get('shape'))).toEqual(['elbow', 'elbow', 'elbow']);
  });
});
