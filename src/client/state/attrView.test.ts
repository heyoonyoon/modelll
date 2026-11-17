import { describe, expect, it } from 'vitest';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { attachedAttributes, visibleGraph } from './attrView';

const node = (id: string, kind: ErdNode['kind']): ErdNode => ({ id, kind, x: 0, y: 0, w: 10, h: 10, text: id });
const edge = (id: string, source: string, target: string): ErdEdge => ({ id, source, target, double: false, cardinality: '', label: '', role: '' }) as unknown as ErdEdge;

// 학생(E) - 이름(A, 복합: 성 A1, 이름 A2) - 학번(K), 수강(R) - 성적(G), 과목(E2) - 과목명(T)
const nodes = [
  node('E', 'entity'), node('A', 'attribute'), node('A1', 'attribute'), node('A2', 'attribute'), node('K', 'attribute'),
  node('R', 'relationship'), node('G', 'attribute'), node('E2', 'entity'), node('T', 'attribute'),
];
const edges = [
  edge('e1', 'E', 'A'), edge('e2', 'A', 'A1'), edge('e3', 'A2', 'A'), edge('e4', 'K', 'E'),
  edge('e5', 'E', 'R'), edge('e6', 'R', 'G'), edge('e7', 'R', 'E2'), edge('e8', 'E2', 'T'),
];

describe('속성 따라 옮기기', () => {
  it('엔티티를 고르면 그 속성과 복합 속성의 하위 속성까지 따라온다. 관계나 다른 엔티티의 속성은 오지 않는다', () => {
    expect(attachedAttributes(['E'], nodes, edges).sort()).toEqual(['A', 'A1', 'A2', 'K']);
  });
  it('관계를 고르면 관계의 속성이 따라온다', () => {
    expect(attachedAttributes(['R'], nodes, edges)).toEqual(['G']);
  });
  it('하위 속성을 고르면 아무것도 따라오지 않고, 이미 고른 속성은 다시 넣지 않는다', () => {
    expect(attachedAttributes(['A1'], nodes, edges)).toEqual([]);
    expect(attachedAttributes(['E', 'K'], nodes, edges).sort()).toEqual(['A', 'A1', 'A2']);
  });
  it('복합 속성을 고르면 그 하위 속성만 따라오고 소유자와 형제 속성은 오지 않는다', () => {
    expect(attachedAttributes(['A'], nodes, edges).sort()).toEqual(['A1', 'A2']);
  });
});

describe('특수화 원 따라 옮기기', () => {
  // 사람(P, 위) - 원(S) - 학생(St), 직원(Em). 학생 아래 또 원(S2) - 대학원생(G). 직원 - 근무(W 관계) - 회사(C)
  const at = (id: string, kind: ErdNode['kind'], y: number): ErdNode => ({ ...node(id, kind), y });
  const ns = [
    at('P', 'entity', 0), at('PN', 'attribute', -40), at('S', 'spec', 100), at('St', 'entity', 200), at('SN', 'attribute', 240),
    at('Em', 'entity', 200), at('S2', 'spec', 300), at('G', 'entity', 400), at('W', 'relationship', 200), at('C', 'entity', 200),
  ];
  const es = [
    edge('f1', 'P', 'PN'), edge('f2', 'P', 'S'), edge('f3', 'S', 'St'), edge('f4', 'S', 'Em'), edge('f5', 'St', 'SN'),
    edge('f6', 'St', 'S2'), edge('f7', 'S2', 'G'), edge('f8', 'Em', 'W'), edge('f9', 'W', 'C'),
  ];
  it('원을 고르면 서브타입과 그 속성, 그 아래 원과 서브타입까지 따라오고 슈퍼타입과 관계는 오지 않는다', () => {
    expect(attachedAttributes(['S'], ns, es).sort()).toEqual(['Em', 'G', 'S2', 'SN', 'St']);
  });
  it('슈퍼타입 엔티티를 고르면 속성만 따라오고 원은 오지 않는다', () => {
    expect(attachedAttributes(['P'], ns, es)).toEqual(['PN']);
  });
});

describe('속성 숨기기', () => {
  it('속성과 속성에 이어진 선을 뺀다', () => {
    const v = visibleGraph(nodes, edges, true);
    expect(v.nodes.map((n) => n.id)).toEqual(['E', 'R', 'E2']);
    expect(v.edges.map((e) => e.id)).toEqual(['e5', 'e7']);
    expect(visibleGraph(nodes, edges, false).nodes).toHaveLength(nodes.length);
  });
});
