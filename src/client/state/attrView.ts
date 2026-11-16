/**
 * 속성 보기 설정(내 브라우저에만 있는 상태). 다이어그램이 커지면 속성 타원을 숨기고 엔티티와 관계만 볼 수 있고,
 * 엔티티나 관계를 옮길 때 거기 붙은 속성이 함께 따라오게 할 수 있다. 둘 다 이 브라우저에 기억한다.
 */
import { create } from 'zustand';
import type { ErdEdge, ErdNode } from '../../shared/types';

const HIDE_KEY = 'modelll.attrs.hidden';
const FOLLOW_KEY = 'modelll.attrs.follow';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // 저장이 막혀 있어도 지금 화면에서는 바뀐다
  }
}

interface AttrViewState {
  /** 속성 타원과 거기 이어진 선을 그리지 않는다 */
  hidden: boolean;
  /** 엔티티나 관계를 옮기면 붙은 속성도 같이 옮긴다 */
  follow: boolean;
  setHidden(on: boolean): void;
  setFollow(on: boolean): void;
}

export const useAttrView = create<AttrViewState>((set) => ({
  hidden: readFlag(HIDE_KEY, false),
  follow: readFlag(FOLLOW_KEY, true),
  setHidden: (hidden) => {
    writeFlag(HIDE_KEY, hidden);
    set({ hidden });
  },
  setFollow: (follow) => {
    writeFlag(FOLLOW_KEY, follow);
    set({ follow });
  },
}));

export const attrView = (): AttrViewState => useAttrView.getState();

/** 속성을 숨긴 상태에서 그리지 않는 노드인지 */
export function isHiddenNode(n: ErdNode, hidden: boolean): boolean {
  return hidden && n.kind === 'attribute';
}

/** 지금 화면에 그려지는 노드와 선(속성을 숨겼으면 속성과 속성에 이어진 선을 뺀다) */
export function visibleGraph(nodes: ErdNode[], edges: ErdEdge[], hidden = attrView().hidden): { nodes: ErdNode[]; edges: ErdEdge[] } {
  if (!hidden) return { nodes, edges };
  const attrs = new Set(nodes.filter((n) => n.kind === 'attribute').map((n) => n.id));
  return {
    nodes: nodes.filter((n) => !attrs.has(n.id)),
    edges: edges.filter((e) => !attrs.has(e.source) && !attrs.has(e.target)),
  };
}

/**
 * 고른 엔티티와 관계에 붙은 속성 id(복합 속성의 하위 속성까지). 이미 고른 것은 빼고 돌려준다.
 * 속성에서 출발하지 않는다. 하위 속성 하나를 옮길 때 형제 속성까지 끌려오지 않게 하기 위해서다.
 */
export function attachedAttributes(selected: readonly string[], nodes: readonly ErdNode[], edges: readonly ErdEdge[]): string[] {
  const kind = new Map(nodes.map((n) => [n.id, n.kind]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  const chosen = new Set(selected);
  const seen = new Set<string>();
  const out: string[] = [];
  const queue = selected.filter((id) => {
    const k = kind.get(id);
    return k !== undefined && k !== 'attribute';
  });
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (seen.has(next) || kind.get(next) !== 'attribute') continue;
      seen.add(next);
      if (!chosen.has(next)) out.push(next);
      queue.push(next);
    }
  }
  return out;
}
