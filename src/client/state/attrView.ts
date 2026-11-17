/**
 * 속성 보기 설정(내 브라우저에만 있는 상태). 다이어그램이 커지면 속성 타원을 숨기고 엔티티와 관계만 볼 수 있고,
 * 엔티티나 관계를 옮길 때 거기 붙은 속성이 함께 따라오게 할 수 있다. 둘 다 이 브라우저에 기억한다.
 */
import { create } from 'zustand';
import { specRoles } from '../../shared/rules';
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
 * 고른 도형을 옮길 때 같이 따라오는 노드 id. 이미 고른 것은 빼고 돌려준다.
 *   엔티티와 관계: 붙은 속성(복합 속성의 하위 속성까지)
 *   속성: 그 속성의 하위 속성만(소유자 쪽으로 거슬러 올라가지 않으므로 형제 속성은 오지 않는다)
 *   특수화 원: 서브타입 엔티티와 그 속성, 서브타입 아래에 또 있는 특수화 원과 그 서브타입까지
 *   슈퍼타입 엔티티: 속성과 함께 그 아래 특수화 트리 전체(원, 서브타입, 그 속성). subtypes가 false면 속성만
 * 관계 선은 따라가지 않는다(관계 마름모와 상대 엔티티는 제자리에 있다).
 */
export function attachedAttributes(
  selected: readonly string[],
  nodes: readonly ErdNode[],
  edges: readonly ErdEdge[],
  opts: { subtypes?: boolean } = {},
): string[] {
  const withSubtypes = opts.subtypes ?? true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kind = (id: string) => byId.get(id)?.kind;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  // 속성마다 소유자(속성이 아닌 노드)에서 몇 단계 떨어져 있는지. 하위 속성은 한 단계 더 멀다
  const depth = new Map<string, number>();
  const level: string[] = [];
  for (const n of nodes) if (n.kind !== 'attribute') depth.set(n.id, 0), level.push(n.id);
  for (let i = 0; i < level.length; i++) {
    const id = level[i];
    for (const next of adj.get(id) ?? []) {
      if (kind(next) !== 'attribute' || depth.has(next)) continue;
      depth.set(next, depth.get(id)! + 1);
      level.push(next);
    }
  }
  const supertypeOf = new Map<string, string | null>();
  const supertype = (specId: string): string | null => {
    if (!supertypeOf.has(specId)) supertypeOf.set(specId, specRoles(byId.get(specId)!, byId, edges as ErdEdge[]).supertype?.id ?? null);
    return supertypeOf.get(specId)!;
  };

  const chosen = new Set(selected);
  const seen = new Set<string>(selected);
  const out: string[] = [];
  const add = (id: string, queue: string[]) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    queue.push(id);
  };
  const queue = selected.filter((id) => byId.has(id));
  while (queue.length > 0) {
    const id = queue.shift()!;
    const k = kind(id);
    for (const next of adj.get(id) ?? []) {
      const nk = kind(next);
      if (nk === 'attribute') {
        // 속성에서는 더 먼 쪽(하위 속성)으로만 간다
        if (k === 'attribute' && (depth.get(next) ?? 0) <= (depth.get(id) ?? 0)) continue;
        if (k === 'spec') continue;
        add(next, queue);
      } else if (k === 'spec' && nk === 'entity') {
        // 원에서는 서브타입으로만 간다
        if (next !== supertype(id)) add(next, queue);
      } else if (k === 'entity' && nk === 'spec' && supertype(next) === id && (withSubtypes || !chosen.has(id))) {
        // 슈퍼타입이면 그 아래 원도 따라온다(따라온 서브타입이 또 슈퍼타입인 경우도 같다)
        add(next, queue);
      }
    }
  }
  return out;
}
