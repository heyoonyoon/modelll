/**
 * 첫 화면의 제품 화면 예시. 방 화면을 반으로 나눠 왼쪽에 ERD(Chen 표기), 오른쪽에 IE(까마귀발) 다이어그램을 같은 크기로 그리고,
 * 두 팀원이 한 방에서 동시에 그리는 장면을 되풀이한다. 지민은 ERD를, 서연은 IE를 직접 그린다(어느 쪽도 다른 쪽에서 나오지 않는다).
 * 장면은 heroScript.ts의 각본(사람별 이동과 누르기, 끌기, 놓기)에서 나온다. 화면 상태는 오직 그 행동의 결과로만 바뀌고,
 * 포인터는 시간에 대한 연속 함수라서 끊기지 않는다. 화면 밖에 있거나 탭을 숨기면 시계가 멈춘다.
 * 장식용이라 조작은 받지 않는다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { computeEdgeGeometry, diagramBounds } from '../../shared/geometry';
import type { ErdEdge, ErdNode, PresetId } from '../../shared/types';
import { EdgeShape } from '../canvas/EdgeShape';
import { NodeShape } from '../canvas/NodeShape';
import { PresetIcon } from '../canvas/PresetIcon';
import { APP_NAME, useT, type MessageKey, type TFunction } from '../i18n';
import { endMarks, type Mark } from '../relational/ieGeometry';
import { TYPE_OPTIONS } from '../relational/pickers';
import { LogoMark } from '../ui/LogoMark';
import {
  DEPT,
  IE,
  MENU,
  STU,
  TYPE_ITEMS,
  buildScript,
  cellKey,
  cursorAt,
  ieGeometry,
  stateAt,
  type Anchor,
  type HeroState,
  type IeGeom,
  type Pt,
  type Script,
} from './heroScript';
import { canAnimate, useMosaic } from './motion';

// ───────────────────────── 예시: 학생은 한 학과에 소속된다 ─────────────────────────

/** 예시 다이어그램의 도형. 세로로 놓아 ERD 칸의 비율에 맞춘다. 글자는 SAMPLE_TEXT의 사전 키로 넣는다 */
export const NODES: ErdNode[] = [
  { id: 'stu', kind: 'entity', x: 104, y: 44, w: 112, h: 48, text: '' },
  { id: 'sid', kind: 'attribute', x: 0, y: 0, w: 96, h: 40, text: '', keyType: 'key' },
  { id: 'snm', kind: 'attribute', x: 232, y: 0, w: 88, h: 40, text: '' },
  { id: 'bel', kind: 'relationship', x: 104, y: 150, w: 112, h: 72, text: '' },
  { id: 'dep', kind: 'entity', x: 104, y: 280, w: 112, h: 48, text: '' },
  { id: 'dcd', kind: 'attribute', x: 0, y: 344, w: 104, h: 40, text: '', keyType: 'key' },
  { id: 'dnm', kind: 'attribute', x: 214, y: 344, w: 106, h: 40, text: '' },
];

/** 도형 id별 글자의 사전 키. 도형 크기가 고정이라 모든 언어에서 도형 안에 들어가는 짧은 낱말을 쓴다(Home.test.tsx가 확인한다) */
export const SAMPLE_TEXT: Record<string, MessageKey> = {
  stu: 'home.sample.student',
  sid: 'home.sample.studentId',
  snm: 'home.sample.name',
  bel: 'home.sample.belong',
  dep: 'home.sample.dept',
  dcd: 'home.sample.deptCode',
  dnm: 'home.sample.deptName',
};

const edge = (id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge => ({
  id,
  source,
  target,
  double: false,
  label: '',
  role: '',
  ...extra,
});

/** 학생은 반드시 한 학과에 소속되고(전체 참여, 이중선) 학과에는 학생이 여럿이다 */
const EDGES: ErdEdge[] = [
  edge('a1', 'stu', 'sid'),
  edge('a2', 'stu', 'snm'),
  edge('a3', 'dep', 'dcd'),
  edge('a4', 'dep', 'dnm'),
  edge('r1', 'stu', 'bel', { label: 'N', double: true }),
  edge('r2', 'bel', 'dep', { label: '1' }),
];

/** 예시 화면에 함께 들어와 있는 팀원. 이름은 언어마다 그 언어권에서 흔한 이름으로 바꿔 보여 준다 */
const MATES: Array<{ name: MessageKey; color: string }> = [
  { name: 'home.sample.mate1', color: '#E5484D' },
  { name: 'home.sample.mate2', color: '#12A594' },
  { name: 'home.sample.mate3', color: '#8E4EC6' },
];

const TOOLS: PresetId[] = ['entity', 'weak-entity', 'relationship', 'identifying-relationship', 'attribute', 'key-attribute'];

function names(t: TFunction) {
  return {
    student: t('home.sample.student'),
    sid: t('home.sample.studentId'),
    name: t('home.sample.name'),
    dept: t('home.sample.dept'),
    dcode: t('home.sample.deptCode'),
    dname: t('home.sample.deptName'),
  };
}

interface IeCol {
  name: string;
  pk?: boolean;
  /** 관계선을 이으면 더해지는 외래키 */
  fk?: boolean;
}

/** IE 표: 위는 학생(학번 PK, 이름, 관계를 이으면 학과코드 FK), 아래는 학과(학과코드 PK, 학과명). ERD와 같은 자리다 */
export function ieTables(t: TFunction): Array<{ id: string; name: string; cols: IeCol[] }> {
  const s = names(t);
  const tables = [];
  tables[STU] = { id: 't0', name: s.student, cols: [{ name: s.sid, pk: true }, { name: s.name }, { name: s.dcode, fk: true }] };
  tables[DEPT] = { id: 't1', name: s.dept, cols: [{ name: s.dcode, pk: true }, { name: s.dname }] };
  return tables;
}

function ieLabels(t: TFunction) {
  return { key: t('relView.ie.colKey'), name: t('relView.ie.colName'), type: t('sqlView.settings.type') };
}

/** 지금 언어의 IE 그림 짜임 */
export function ieLayout(t: TFunction): IeGeom {
  return ieGeometry(ieTables(t), ieLabels(t));
}

/** 타입 메뉴 항목: MySQL 타입 목록 앞부분 */
const menuItems = () => TYPE_OPTIONS.mysql.slice(0, TYPE_ITEMS);

/** IE 자리 이름을 IE 그림 좌표로. IE 그림 밖의 자리(도구 버튼)면 null */
function iePoint(g: IeGeom, a: Anchor): Pt | null {
  const cx = Math.round(g.w / 2);
  switch (a.k) {
    case 'spot':
      return { x: cx, y: g.ys[a.table] + IE.head / 2 };
    case 'dot':
      // 관계를 잇기 전의 아래 가장자리(외래키 행이 아직 없다)
      return { x: cx, y: g.ys[a.table] + g.height(a.table, 2) + IE.dot };
    case 'drop':
      return { x: cx - 18, y: g.ys[a.table] + IE.head / 2 + 2 };
    case 'cell': {
      const c = g.cell(a.cell);
      return { x: c.x + c.w * 0.45, y: c.y + c.h * 0.6 };
    }
    case 'item': {
      const m = g.menu(a.cell, menuItems());
      return { x: m.x + 28, y: m.y + MENU.pad + a.index * MENU.item + MENU.item * 0.6 };
    }
    case 'ieRest':
      // 표 사이 틈의 오른쪽(이름표가 칸 밖으로 잘리지 않는 자리)
      return { x: g.w - 56, y: g.ys[DEPT] - IE.gap / 2 };
    default:
      return null;
  }
}

// ───────────────────────── ERD ─────────────────────────

const ERD_BOUNDS = diagramBounds(NODES, 20) ?? { x: 0, y: 0, w: 340, h: 400 };

function ErdCanvas({ state, animated }: { state: HeroState; animated: boolean }) {
  const t = useT();
  const nodes = NODES.filter((n) => state.shown.has(n.id)).map((n) => ({ ...n, text: t(SAMPLE_TEXT[n.id]) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // 카디널리티 글자는 따로 적힌다
  const edges = EDGES.filter((e) => state.shown.has(e.id)).map((e) => (e.label && !state.shown.has(`${e.id}L`) ? { ...e, label: '' } : e));
  const b = ERD_BOUNDS;
  return (
    <svg className="home-pv-art home-pv-erd" viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('home.preview.diagramLabel')}>
      {edges.map((e) => {
        const s = byId.get(e.source);
        const g = byId.get(e.target);
        if (!s || !g) return null;
        return (
          <g key={e.id} className={animated ? 'home-pv-edge is-new' : 'home-pv-edge'}>
            <EdgeShape edge={e} geometry={computeEdgeGeometry(e, s, g, 0, 1, 1)} />
          </g>
        );
      })}
      {nodes.map((n) => (
        <g key={n.id} className={animated ? 'home-pv-node is-new' : 'home-pv-node'}>
          <NodeShape node={n} />
        </g>
      ))}
      {state.picks.map((id, who) => {
        const n = id ? byId.get(id) : undefined;
        if (!n) return null;
        return (
          <rect
            key={`${who}-${n.id}`}
            className="home-pv-pick"
            x={n.x - 5}
            y={n.y - 5}
            width={n.w + 10}
            height={n.h + 10}
            rx="3"
            fill="none"
            stroke={MATES[who].color}
            strokeWidth="1.6"
          />
        );
      })}
    </svg>
  );
}

// ───────────────────────── IE ─────────────────────────

function MarkEl({ m }: { m: Mark }) {
  if (m.type === 'bar') return <line className="home-ie-mark" x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} />;
  if (m.type === 'circle') return <circle className="home-ie-mark is-circle" cx={m.cx} cy={m.cy} r={m.r} />;
  return <path className="home-ie-mark" d={m.d} />;
}

function IeCanvas({ state }: { state: HeroState }) {
  const t = useT();
  const tables = ieTables(t);
  const labels = ieLabels(t);
  const g = ieGeometry(tables, labels);
  const { w, ys, X } = g;
  const cx = Math.round(w / 2);
  const link = state.shown.has('link');
  const menu = state.menu;
  const items = menu ? menuItems() : [];
  const box = menu ? g.menu(menu, items) : null;
  /** 보이는 컬럼: 학생의 외래키 행은 관계를 이은 뒤에 생긴다 */
  const colsOf = (ti: number) => tables[ti].cols.filter((c) => !c.fk || link);
  const stuBottom = ys[STU] + g.height(STU, colsOf(STU).length);
  const deptTop = ys[DEPT];
  // 끌고 있는 고무줄 선: 연결 점에서 포인터까지(포인터와 같은 직선, 같은 쉬움 곡선)
  const draft = state.draft
    ? (() => {
        const a = iePoint(g, state.draft.from)!;
        const b = iePoint(g, state.draft.to)!;
        const e = state.draft.e;
        return { a, b: { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }, near: e > 0.82 };
      })()
    : null;
  return (
    <svg className="home-pv-art home-pv-ie" viewBox={`-26 -20 ${w + 52} ${g.total + 40}`} preserveAspectRatio="xMidYMid meet" data-testid="home-pv-ie">
      {link && (
        // 비식별 관계라 점선. 학생 쪽은 0개 이상(동그라미와 까마귀발), 학과 쪽은 반드시 하나(막대 둘)
        <g className="home-pv-fade" data-testid="home-pv-ie-link">
          <path className="home-ie-link" d={`M${cx} ${stuBottom}V${deptTop}`} />
          {endMarks({ min: 0, max: 'N' }, { x: cx, y: stuBottom }, { x: 0, y: 1 }).map((m, i) => (
            <MarkEl key={`s${i}`} m={m} />
          ))}
          {endMarks({ min: 1, max: '1' }, { x: cx, y: deptTop }, { x: 0, y: -1 }).map((m, i) => (
            <MarkEl key={`d${i}`} m={m} />
          ))}
        </g>
      )}
      {tables.map((tb, ti) => {
        if (!state.shown.has(tb.id)) return null;
        const y0 = ys[ti];
        const cols = colsOf(ti);
        const h = g.height(ti, cols.length);
        const pkCount = cols.filter((c) => c.pk).length;
        const top = y0 + IE.head + IE.colhead;
        const colMid = y0 + IE.head + IE.colhead / 2;
        return (
          <g key={tb.id} className="home-pv-fade" data-table={tb.name}>
            <rect className="home-ie-box" x={0} y={y0} width={w} height={h} rx={4} />
            <path className="home-ie-head" d={`M0 ${y0 + IE.head}V${y0 + 4}a4 4 0 0 1 4 -4H${w - 4}a4 4 0 0 1 4 4V${y0 + IE.head}Z`} />
            <text className="home-ie-name home-pv-ie-title" x={IE.pad + 2} y={y0 + IE.head / 2}>
              {tb.name}
            </text>
            <rect className="home-pv-ie-colhead" x={0.6} y={y0 + IE.head} width={w - 1.2} height={IE.colhead} />
            <g className="home-pv-ie-labels">
              <text className="home-pv-ie-label is-center" x={g.keyW / 2} y={colMid}>
                {labels.key}
              </text>
              <text className="home-pv-ie-label" x={X.name + IE.pad} y={colMid}>
                {labels.name}
              </text>
              <text className="home-pv-ie-label" x={X.type + IE.pad} y={colMid}>
                {labels.type}
              </text>
              <text className="home-pv-ie-label" x={X.null + IE.pad} y={colMid}>
                NULL
              </text>
            </g>
            {[X.name, X.type, X.null].map((x) => (
              <line key={x} className="home-ie-grid" x1={x} x2={x} y1={y0 + IE.head} y2={y0 + h} />
            ))}
            <line className="home-ie-line" x1={0} x2={w} y1={y0 + IE.head} y2={y0 + IE.head} />
            <line className="home-ie-line" x1={0} x2={w} y1={top} y2={top} />
            {cols.map((c, ci) => {
              const rowTop = top + ci * IE.row;
              const mid = rowTop + IE.row / 2;
              const type = state.fills[cellKey([ti, ci, 'type'])];
              const open = menu && menu[0] === ti && menu[1] === ci ? g.cell(menu) : null;
              return (
                <g key={c.name + ci} className={c.fk ? 'home-pv-fade' : undefined} data-column={c.name} data-type={type || undefined}>
                  {/* 기본키 묶음과 나머지 사이의 구분선(방 화면처럼 진하게) */}
                  {ci > 0 && <line className={ci === pkCount ? 'home-ie-line' : 'home-pv-ie-row'} x1={0} x2={w} y1={rowTop} y2={rowTop} />}
                  {(c.pk || c.fk) && (
                    <text className="home-ie-tag" x={g.keyW / 2} y={mid}>
                      {c.pk ? 'PK' : 'FK'}
                    </text>
                  )}
                  <text className={c.pk ? 'home-ie-col is-pk' : 'home-ie-col'} x={X.name + IE.pad} y={c.pk ? mid + 4.5 : mid}>
                    {c.name}
                  </text>
                  {open && <rect className="home-ie-edit" x={open.x + 2} y={open.y + 3} width={open.w - 4} height={open.h - 6} rx={3} />}
                  {type && (
                    <text key={type} className="home-ie-type" x={X.type + IE.pad} y={mid}>
                      {type}
                    </text>
                  )}
                  {/* 기본키는 언제나 NOT NULL(방 화면처럼 잠긴 칸이라 옅게) */}
                  {c.pk && (
                    <text className="home-ie-null" x={X.null + IE.pad} y={mid}>
                      NOT NULL
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
      {/* 서연이 고른(방금 놓은) 표의 선택 테두리 */}
      {state.picks.map((id, who) => {
        const ti = tables.findIndex((tb) => tb.id === id);
        if (ti < 0) return null;
        return (
          <rect
            key={`${who}-${id}`}
            className="home-pv-pick"
            x={-5}
            y={ys[ti] - 5}
            width={w + 10}
            height={g.height(ti, colsOf(ti).length) + 10}
            rx="5"
            fill="none"
            stroke={MATES[who].color}
            strokeWidth="1.6"
          />
        );
      })}
      {/* 연결 점: 표에 올리면 네 변에 보이고, 끌기 시작한 점은 채워진다 */}
      {state.dots >= 0 &&
        (() => {
          const y0 = ys[state.dots];
          const h = g.height(state.dots, 2);
          const pts = [
            { x: cx, y: y0 - IE.dot, on: false },
            { x: w + IE.dot, y: y0 + h / 2, on: false },
            { x: cx, y: y0 + h + IE.dot, on: !!draft },
            { x: -IE.dot, y: y0 + h / 2, on: false },
          ];
          return (
            <g className="home-pv-dots">
              {pts.map((p, i) => (
                <circle key={i} className={p.on ? 'home-pv-dot is-on' : 'home-pv-dot'} cx={p.x} cy={p.y} r={4.5} />
              ))}
            </g>
          );
        })()}
      {draft && (
        <g className="home-pv-draft" data-testid="home-pv-draft">
          {draft.near && <rect className="home-pv-target" x={-4} y={deptTop - 4} width={w + 8} height={g.height(DEPT, tables[DEPT].cols.length) + 8} rx={5} />}
          <line className="home-pv-rubber" x1={draft.a.x} y1={draft.a.y} x2={draft.b.x} y2={draft.b.y} />
        </g>
      )}
      {menu && box && (
        <g className="home-pv-menu" data-testid="home-pv-menu">
          <rect className="home-pv-menu-box" x={box.x} y={box.y} width={box.w} height={box.h} rx={6} />
          {items.map((it, i) => {
            const y = box.y + MENU.pad + i * MENU.item;
            return (
              <g key={it}>
                {i === state.hover && <rect className="home-pv-menu-hover" x={box.x + MENU.pad} y={y} width={box.w - MENU.pad * 2} height={MENU.item} rx={4} />}
                <text className="home-pv-menu-text is-mono" x={box.x + MENU.pad + 6} y={y + MENU.item / 2}>
                  {it}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

// ───────────────────────── 화면 틀 ─────────────────────────

type TabIcon = 'erd' | 'ie';
const TAB_ICONS: Record<TabIcon, string> = {
  erd: 'M1.5 6h4v4h-4zM10.5 6h4v4h-4zM5.5 8h5',
  ie: 'M2 2.5h5v4H2zM9 9.5h5v4H9zM4.5 6.5V11.5H9',
};

function Tab({ label, icon }: { label: string; icon: TabIcon }) {
  return (
    <span className="home-pv-tab is-active" data-tab={icon}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
        <path d={TAB_ICONS[icon]} />
      </svg>
      {label}
      <i aria-hidden="true">×</i>
    </span>
  );
}

const POINTER_ICON = (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M5 3l4.6 12 1.9-5 5-1.9z" />
  </svg>
);

/**
 * 자리 이름(Anchor)을 분할 화면 기준 좌표로 바꾼다. ERD와 IE는 그림 좌표를 SVG 변환으로, 도구 버튼은 요소 위치를 잰다.
 * 아직 그려지지 않은 요소면 null이다(그리는 쪽이 직전 자리를 쓴다).
 */
function makeResolver(root: HTMLElement, t: TFunction): (a: Anchor) => Pt | null {
  const box = root.getBoundingClientRect();
  const viaSvg = (selector: string, x: number, y: number): Pt | null => {
    const svg = root.querySelector<SVGSVGElement>(selector);
    const m = svg?.getScreenCTM?.();
    if (!svg || !m) return null;
    const p = new DOMPoint(x, y).matrixTransform(m);
    return { x: p.x - box.left, y: p.y - box.top };
  };
  const g = ieLayout(t);
  return (a) => {
    if (a.k === 'erd') return viaSvg('.home-pv-erd', a.x, a.y);
    if (a.k === 'ieTool') {
      const el = root.querySelector('[data-ie-tool]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left + r.width * 0.55, y: r.top - box.top + r.height * 0.6 };
    }
    const p = iePoint(g, a);
    return p ? viaSvg('.home-pv-ie', p.x, p.y) : null;
  };
}

/**
 * 두 사람의 포인터. 각본(cursorAt)이 시간마다 정한 자리에 그린다. 자리 이름을 좌표로 바꿀 수 없는 순간(요소가 아직 없을 때)은
 * 그 자리의 마지막 좌표를 쓴다. 프레임마다 다시 그리지 않고 요소의 transform만 바꾼다.
 */
function Cursors({ script, ms, state }: { script: Script; ms: number; state: HeroState }) {
  const t = useT();
  const refs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const layerRef = useRef<HTMLDivElement>(null);
  const clickRef = useRef<HTMLDivElement>(null);
  const memo = useRef(new Map<string, Pt>());
  useLayoutEffect(() => {
    // 분할 화면 기준으로 잰다. 부모의 ref는 자식의 layout effect 뒤에 붙으므로(첫 그림에서 비어 있다) 자기 요소의 부모를 쓴다.
    // 움직임을 줄인 화면은 한 번만 그리므로 첫 그림에서 포인터 자리가 정해져야 한다
    const root = layerRef.current?.parentElement;
    if (!root) return;
    const raw = makeResolver(root, t);
    // 자리를 아직 한 번도 잴 수 없었던 순간이 있으면 그 프레임에는 포인터를 감춘다(왼쪽 위 구석에 그리지 않는다)
    let missing = false;
    const resolve = (a: Anchor): Pt => {
      const key = JSON.stringify(a);
      const p = raw(a);
      if (p) memo.current.set(key, p);
      const q = p ?? memo.current.get(key);
      if (!q) missing = true;
      return q ?? { x: 0, y: 0 };
    };
    ([0, 1] as const).forEach((who) => {
      const el = refs[who].current;
      if (!el) return;
      missing = false;
      const p = cursorAt(script, who, ms, resolve);
      el.style.visibility = missing ? 'hidden' : 'visible';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    });
    // 누른 자리에 퍼지는 고리
    const layer = clickRef.current;
    if (layer) {
      layer.replaceChildren(
        ...state.clicks.map((c) => {
          const p = resolve(c.anchor);
          const ring = document.createElement('i');
          ring.className = 'home-pv-ring';
          ring.style.cssText = `left:${p.x}px;top:${p.y}px;border-color:${MATES[c.who].color};opacity:${(1 - c.age).toFixed(2)};transform:scale(${(0.4 + c.age * 0.9).toFixed(2)})`;
          return ring;
        }),
      );
    }
  });
  return (
    <div ref={layerRef} className="home-pv-cursors" aria-hidden="true">
      <div ref={clickRef} />
      {([0, 1] as const).map((who) => (
        <span key={who} ref={refs[who]} className="home-pv-hcursor">
          <svg width="16" height="16" viewBox="0 0 20 20">
            <path d="M1 1l5.2 14.2 2.3-5.9 5.9-2.3z" fill={MATES[who].color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span style={{ background: MATES[who].color }}>{t(MATES[who].name)}</span>
        </span>
      ))}
    </div>
  );
}

function Stage({ ms, animated, script }: { ms: number; animated: boolean; script: Script }) {
  const t = useT();
  const state = stateAt(script, ms);
  const toolClass = ['home-pv-tool', state.tool ? 'is-active' : '', state.toolHover && !state.tool ? 'is-hover' : ''].filter(Boolean).join(' ');
  return (
    <div className={state.leaving ? 'home-pv-split is-leaving' : 'home-pv-split'} data-testid="home-pv-split">
      <section className="home-pv-pane is-erd">
        <div className="home-pv-tabs">
          <Tab label={t('relPane.title.erd')} icon="erd" />
        </div>
        <div className="home-pv-canvas">
          <div className="home-pv-tools" aria-hidden="true">
            <span className="home-pv-tool is-active">{POINTER_ICON}</span>
            {TOOLS.map((id) => (
              <span key={id} className="home-pv-tool">
                <PresetIcon presetId={id} size={14} />
              </span>
            ))}
          </div>
          <ErdCanvas state={state} animated={animated} />
        </div>
      </section>
      <section className="home-pv-pane is-ie">
        <div className="home-pv-tabs">
          <Tab label={t('relPane.title.ie')} icon="ie" />
        </div>
        <div className="home-pv-canvas">
          <div className="home-pv-tools" aria-hidden="true">
            <span className={state.tool ? 'home-pv-tool' : 'home-pv-tool is-active'}>{POINTER_ICON}</span>
            <span className={toolClass} data-ie-tool="">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.75" y="2.75" width="9.5" height="9.5" rx="1.25" />
                <path d="M1.75 6.25h9.5M13.25 9.5v5M10.75 12h5" />
              </svg>
            </span>
          </div>
          <IeCanvas state={state} />
        </div>
      </section>
      <Cursors script={script} ms={ms} state={state} />
    </div>
  );
}

/**
 * 장면 시계. 화면에 보이고 탭이 보일 때만 흐르고, 한 번에 크게 건너뛴 시간(탭을 숨겼다 돌아옴 등)은 버린다.
 * 한 바퀴가 끝나면 0으로 돌아간다(그때는 화면 전체가 흐려져 있다).
 */
function useSceneClock(enabled: boolean, host: RefObject<HTMLElement | null>, loopMs: number): number {
  const [ms, setMs] = useState(0);
  const loopRef = useRef(loopMs);
  loopRef.current = loopMs;
  useEffect(() => {
    const el = host.current;
    if (!enabled || !el) return;
    let visible = false;
    let frame = 0;
    let last = 0;
    let elapsed = 0;
    const tick = (now: number) => {
      const dt = last ? now - last : 0;
      last = now;
      elapsed += dt > 250 ? 16 : dt;
      if (elapsed >= loopRef.current) elapsed = 0;
      const q = Math.floor(elapsed / 33) * 33;
      setMs((prev) => (prev === q ? prev : q));
      frame = requestAnimationFrame(tick);
    };
    const run = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (visible && document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      run();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', run);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', run);
      cancelAnimationFrame(frame);
    };
  }, [enabled, host]);
  return ms;
}

export function HomePreview() {
  // 움직임을 쓸 수 있는지는 브라우저에서만 알 수 있으므로 처음 한 번만 정한다
  const [animated] = useState(canAnimate);
  const t = useT();
  // 처음 열릴 때 카드가 올라오는 동안 모자이크가 풀린다
  const mosaic = useMosaic<HTMLElement>({ delay: 60, duration: 1400 });
  const script = useMemo(() => buildScript(), []);
  // 작업 장면은 모자이크가 다 풀린 뒤에 시작한다. 그 전에는 첫 장면(빈 화면)에 멈춰 있다
  const ms = useSceneClock(animated && mosaic.done, mosaic.ref, script.loop);
  // 움직임을 쓰지 않으면 두 사람이 다 그린 장면에 멈춘다
  const at = animated ? ms : script.still;
  return (
    <figure ref={mosaic.ref} className="home-pv" aria-label={t('home.preview.label')}>
      <div className="home-pv-top" aria-hidden="true">
        <span className="home-pv-brand">
          <LogoMark size={16} />
          {APP_NAME}
        </span>
        <span className="home-pv-title">{t('home.preview.title')}</span>
        <span className="home-pv-saved">{t('status.connected.label')}</span>
        <span className="home-pv-mates">
          {MATES.map((m) => (
            <b key={m.name} style={{ background: m.color }}>
              {Array.from(t(m.name))[0]}
            </b>
          ))}
        </span>
        <span className="home-pv-share">{t('topbar.share')}</span>
      </div>
      <Stage ms={at} animated={animated} script={script} />
      {mosaic.overlay}
    </figure>
  );
}
