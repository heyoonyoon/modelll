/**
 * 선의 끝점 손잡이를 끌어 그 끝이 붙는 자리를 바꾼다. [담당: canvas 에이전트]
 *   같은 도형의 붙는 자리(네 면과 그 사이 넷) 근처에 놓으면 그 자리에 붙이고, 몸통에 놓으면 자동으로 되돌린다.
 *   (추가) 다른 도형 위나 그 붙는 자리 근처에 놓으면, 규칙상 이을 수 있을 때 그 도형으로 옮겨 붙인다.
 *   이을 수 없는 도형이나 빈 곳에 놓으면 아무것도 바꾸지 않는다. 바꾸면 실행 취소 한 단계다.
 */
import { canConnect, edgeCanBeDouble, edgeHasCardinality } from '../../../shared/rules';
import type { Anchor, ErdNode, Point } from '../../../shared/types';
import { updateEdge, type EdgePatch } from '../../collab/docOps';
import type { Room } from '../../collab/room';
import { ui } from '../../state/ui';
import { worldOf, type Gesture, type GestureCtx, type PointerSnap } from './gesture';
import { ANCHOR_SNAP_DISTANCE, exceedsThreshold, pickConnectTarget, resolveEndDrop, shouldStoreSides } from './logic';
import { setCanvasLocal } from './store';

export type EdgeEnd = 'source' | 'target';

/** 놓을 자리: 붙일 도형, 붙는 자리, 옮겨 붙일 수 있는지 */
interface Drop {
  node: ErdNode;
  side: Anchor | null;
  valid: boolean;
}

export function startEdgeEnd(ctx: GestureCtx, down: PointerSnap, edgeId: string, end: EdgeEnd): Gesture | null {
  const { room } = ctx;
  const edge = room.edges.get(edgeId);
  if (!edge) return null;
  const nodeId = end === 'source' ? edge.source : edge.target;
  if (!room.nodes.has(nodeId)) return null;
  const key = end === 'source' ? 'sourceSide' : 'targetSide';
  let started = false;

  const snapDist = (): number => ANCHOR_SNAP_DISTANCE / ui().viewport.zoom;
  const clear = (): void => setCanvasLocal({ edgeEndDrag: null });

  /** 포인터 자리의 놓을 곳. 원래 도형의 붙는 자리가 가장 먼저이고, 다음은 다른 도형이다 */
  const dropAt = (to: Point): Drop | null => {
    const own = room.nodes.get(nodeId);
    const current = room.edges.get(edgeId);
    if (!own || !current) return null;
    const otherId = end === 'source' ? current.target : current.source;
    const nodes = room.nodes.getSnapshot();
    const picked = pickConnectTarget(nodes, to, otherId, snapDist());
    if (!picked || picked.node.id === own.id) {
      const d = resolveEndDrop(own, to, snapDist());
      return { node: own, side: d.kind === 'side' ? d.side : null, valid: d.kind !== 'none' };
    }
    return { node: picked.node, side: picked.side, valid: canRetarget(room, edgeId, end, picked.node) };
  };

  return {
    move(p) {
      if (!started) {
        if (!exceedsThreshold(down.clientX, down.clientY, p.clientX, p.clientY)) return;
        started = true;
        setCanvasLocal({ mode: 'edge-end', hostId: null });
      }
      const to = worldOf(ctx, p);
      const drop = dropAt(to);
      if (!drop) return;
      setCanvasLocal({
        edgeEndDrag: { edgeId, end, nodeId: drop.valid ? drop.node.id : nodeId, to, side: drop.valid ? drop.side : null },
      });
    },
    end(p) {
      if (!started) return;
      clear();
      const current = room.edges.get(edgeId);
      const to = worldOf(ctx, p);
      const drop = dropAt(to);
      if (!current || !drop || !drop.valid) return;
      let patch: EdgePatch;
      if (drop.node.id === nodeId) {
        const own = room.nodes.get(nodeId)!;
        const d = resolveEndDrop(own, to, snapDist());
        if (d.kind === 'none') return;
        const next = d.kind === 'side' ? d.side : undefined;
        if (current[key] === next) return;
        patch = { [key]: next };
      } else {
        patch = retargetPatch(room, current, end, drop.node, drop.side);
      }
      // 앞뒤 작업과 섞이지 않게 실행 취소 한 단계로 끊는다
      room.undo.stopCapturing();
      updateEdge(room.doc, edgeId, patch);
      room.undo.stopCapturing();
    },
    cancel() {
      // 놓기 전에는 문서를 건드리지 않으므로 표시만 지우면 된다
      clear();
    },
  };
}

/** 이 끝을 node로 옮겨 붙여도 되는지(선을 새로 이을 때와 같은 규칙. 이 선 자신은 빼고 본다) */
function canRetarget(room: Room, edgeId: string, end: EdgeEnd, node: ErdNode): boolean {
  const edge = room.edges.get(edgeId);
  if (!edge) return false;
  const other = room.nodes.get(end === 'source' ? edge.target : edge.source);
  if (!other || other.id === node.id) return false;
  const edges = room.edges.getSnapshot().filter((e) => e.id !== edgeId);
  const nodes = room.nodes.getSnapshot();
  const check = end === 'source' ? canConnect(node, other, edges, nodes) : canConnect(other, node, edges, nodes);
  return check.ok;
}

/** 다른 도형으로 옮겨 붙일 때의 고칠 값. 새 짝에 맞지 않는 붙는 자리, 이중선, 카디널리티는 지운다 */
function retargetPatch(room: Room, edge: { source: string; target: string; double: boolean; label: string; sourceSide?: Anchor; targetSide?: Anchor }, end: EdgeEnd, node: ErdNode, side: Anchor | null): EdgePatch {
  const other = room.nodes.get(end === 'source' ? edge.target : edge.source)!;
  const [s, t] = end === 'source' ? [node, other] : [other, node];
  const keep = shouldStoreSides(s, t);
  const patch: EdgePatch = end === 'source' ? { source: node.id } : { target: node.id };
  patch.sourceSide = keep ? (end === 'source' ? (side ?? undefined) : edge.sourceSide) : undefined;
  patch.targetSide = keep ? (end === 'target' ? (side ?? undefined) : edge.targetSide) : undefined;
  if (edge.double && !edgeCanBeDouble(s, t)) patch.double = false;
  if (edge.label !== '' && !edgeHasCardinality(s, t)) patch.label = '';
  return patch;
}
