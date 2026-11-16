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
  it('속성만 고르면 아무것도 따라오지 않고, 이미 고른 속성은 다시 넣지 않는다', () => {
    expect(attachedAttributes(['A1'], nodes, edges)).toEqual([]);
    expect(attachedAttributes(['E', 'K'], nodes, edges).sort()).toEqual(['A', 'A1', 'A2']);
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
