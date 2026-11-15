/**
 * 첫 화면 제품 화면 예시(HomePreview)의 각본. 화면에 닿지 않는 순수 계산만 둔다.
 *
 * 화면은 반으로 나뉜다. 왼쪽은 ERD(Chen 표기), 오른쪽은 IE(까마귀발) 다이어그램이다.
 * 두 사람이 같은 방에서 동시에 일한다. 지민은 ERD를 그리고, 서연은 IE를 직접 그린다(테이블을 놓고, 끌어서 관계를 잇고, 타입을 고른다).
 * 어느 쪽도 다른 쪽에서 나오지 않는다. 같은 모델을 두 표기로 그리는 동료일 뿐이다.
 *
 * 각본은 사람별 행동 목록이다. 행동은 둘뿐이다.
 *   - 이동(Move): 직전 자리에서 다음 자리(Anchor)로 휘는 길을 따라 간다. 끄는 중(drag)일 수도 있다
 *   - 사건(Event): 지금 자리에서 누르기(click), 끌기 시작(drag), 놓기(drop). 화면 상태는 오직 사건의 결과로만 바뀐다
 * 자리(Anchor)는 화면 요소를 가리키는 이름이고, 실제 좌표는 그리는 쪽이 재서 준다(resolve).
 * 포인터 자리는 시간에 대한 연속 함수(cursorAt)라서 단계가 바뀌거나 처음으로 돌아가도 순간이동하지 않는다.
 */
import { approximateLineWidth } from '../text/measure';

export interface Pt {
  x: number;
  y: number;
}
export type Who = 0 | 1;

/** IE 칸: [표 번호, 컬럼 번호, 칸 종류] */
export type CellKind = 'type' | 'null';
export type CellRef = readonly [number, number, CellKind];
export const cellKey = ([ti, ci, kind]: CellRef) => `${ti}.${ci}.${kind}`;

/** IE 표 번호: 위는 학생(ERD와 같은 자리), 아래는 학과 */
export const STU = 0;
export const DEPT = 1;

export type Anchor =
  /** ERD 그림 좌표 */
  | { k: 'erd'; x: number; y: number }
  /** IE 도구 막대의 테이블 추가 버튼 */
  | { k: 'ieTool' }
  /** IE 표를 놓을 자리(머리 가운데) */
  | { k: 'spot'; table: number }
  /** IE 표 아래 가장자리의 연결 점 */
  | { k: 'dot'; table: number }
  /** 끌어 온 선을 놓는 자리(대상 표의 머리) */
  | { k: 'drop'; table: number }
  /** IE 칸 */
  | { k: 'cell'; cell: CellRef }
  /** IE 칸 메뉴의 항목 */
  | { k: 'item'; cell: CellRef; index: number }
  /** IE 칸에서 그림을 가리지 않는 빈자리 */
  | { k: 'ieRest' };

export type Effect =
  | { e: 'place'; ids: string[] }
  | { e: 'label'; edge: string }
  | { e: 'tool' }
  | { e: 'linkStart' }
  | { e: 'link' }
  | { e: 'menu'; cell: CellRef }
  | { e: 'fill'; cell: CellRef; value: string };

export interface Move {
  who: Who;
  at: number;
  dur: number;
  from: Anchor;
  to: Anchor;
  /** 길이 휘는 정도(거리에 대한 비율, 부호가 방향) */
  bend: number;
  /** 끝에서 조금 지나쳤다 돌아오는 정도 */
  over: number;
  /** 버튼을 누른 채로 끄는 중이면 true(관계선 잇기) */
  drag?: boolean;
}

export interface ScriptEvent {
  who: Who;
  at: number;
  kind: 'click' | 'drag' | 'drop';
  /** 누르거나 끌기 시작하거나 놓은 자리 */
  anchor: Anchor;
  effect: Effect;
}

export interface Script {
  moves: Move[];
  events: ScriptEvent[];
  /** 두 사람이 처음 있는 자리(마지막에 이리로 돌아온다) */
  start: [Anchor, Anchor];
  /** 정지 장면으로 보여 줄 시각(두 사람 모두 다 그린 때) */
  still: number;
  /** 이 시각부터 화면 전체가 흐려지고 loop에서 처음으로 돌아간다 */
  leaveAt: number;
  loop: number;
}

// ───────────────────────── 예시 그림 좌표 ─────────────────────────

/** ERD 도형의 가운데와 카디널리티 글자 자리(그림 좌표). HomePreview의 NODES와 같은 자리다 */
const AT = {
  stu: { x: 160, y: 68 },
  dep: { x: 160, y: 304 },
  bel: { x: 160, y: 186 },
  sid: { x: 48, y: 20 },
  snm: { x: 276, y: 20 },
  dcd: { x: 52, y: 364 },
  dnm: { x: 267, y: 364 },
  r1: { x: 176, y: 122 },
  r2: { x: 178, y: 252 },
};
const erd = (p: Pt): Anchor => ({ k: 'erd', x: p.x, y: p.y });

/** 타입 메뉴 항목 수(MySQL 타입 목록 앞부분) */
export const TYPE_ITEMS = 7;
/** IE에서 고르는 타입: [칸, 메뉴 항목 번호, 값]. 값은 MySQL 타입 목록의 그 번호 항목이다 */
export const PICKS: Array<[CellRef, number, string]> = [
  [[STU, 0, 'type'], 6, 'CHAR(10)'],
  [[DEPT, 1, 'type'], 5, 'VARCHAR(255)'],
];

/** 각본을 만든다. 사람마다 시계를 따로 두고 행동을 차례로 쌓는다 */
export function buildScript(): Script {
  const moves: Move[] = [];
  const events: ScriptEvent[] = [];
  const start: [Anchor, Anchor] = [erd({ x: 300, y: 196 }), { k: 'ieRest' }];
  const clock = [0, 0];
  const here: [Anchor, Anchor] = [start[0], start[1]];
  const move = (who: Who, to: Anchor, dur: number, bend = 0.12, over = 0.9, drag?: boolean) => {
    moves.push({ who, at: clock[who], dur, from: here[who], to, bend, over, drag });
    clock[who] += dur;
    here[who] = to;
  };
  const wait = (who: Who, ms: number) => {
    clock[who] += ms;
  };
  const until = (who: Who, t: number) => {
    clock[who] = Math.max(clock[who], t);
  };
  /** 누르기 전에 잠깐 멈칫한다 */
  const click = (who: Who, effect: Effect, pause = 110) => {
    clock[who] += pause;
    events.push({ who, at: clock[who], kind: 'click', anchor: here[who], effect });
    clock[who] += 70;
  };

  // ── 왼쪽 ERD: 지민이 엔티티, 관계, 카디널리티, 속성을 차례로 놓는다
  wait(0, 150);
  move(0, erd(AT.stu), 440, 0.18, 1.1);
  click(0, { e: 'place', ids: ['stu'] }, 120);
  move(0, erd(AT.dep), 400, -0.22, 0.9);
  click(0, { e: 'place', ids: ['dep'] }, 100);
  move(0, erd(AT.bel), 320, 0.12, 1.2);
  click(0, { e: 'place', ids: ['bel', 'r1', 'r2'] }, 120);
  move(0, erd(AT.r1), 280, -0.16, 0.8);
  click(0, { e: 'label', edge: 'r1' }, 90);
  move(0, erd(AT.r2), 280, 0.2, 1);
  click(0, { e: 'label', edge: 'r2' }, 90);
  move(0, erd(AT.sid), 520, -0.2, 0.8);
  click(0, { e: 'place', ids: ['sid', 'a1'] }, 100);
  move(0, erd(AT.snm), 380, 0.14, 1.2);
  click(0, { e: 'place', ids: ['snm', 'a2'] }, 90);
  move(0, erd(AT.dcd), 600, -0.1, 0.7);
  click(0, { e: 'place', ids: ['dcd', 'a3'] }, 100);
  move(0, erd(AT.dnm), 360, 0.16, 1);
  click(0, { e: 'place', ids: ['dnm', 'a4'] }, 100);
  move(0, erd({ x: 300, y: 250 }), 460, 0.1, 0.4);

  // ── 오른쪽 IE: 서연이 테이블 추가 도구로 학과와 학생을 놓고, 학생에서 학과로 끌어 관계를 잇고, 타입을 고른다
  wait(1, 300);
  const place = (table: number, id: string, first: boolean) => {
    move(1, { k: 'ieTool' }, first ? 560 : 480, first ? -0.14 : 0.16, 0.8);
    click(1, { e: 'tool' }, 110);
    move(1, { k: 'spot', table }, 520, table === STU ? -0.12 : 0.14, 0.9);
    click(1, { e: 'place', ids: [id] }, 130);
  };
  place(DEPT, 't1', true);
  place(STU, 't0', false);
  move(1, { k: 'dot', table: STU }, 420, 0.2, 0.6);
  clock[1] += 140;
  events.push({ who: 1, at: clock[1], kind: 'drag', anchor: here[1], effect: { e: 'linkStart' } });
  move(1, { k: 'drop', table: DEPT }, 620, 0, 0, true);
  clock[1] += 60;
  events.push({ who: 1, at: clock[1], kind: 'drop', anchor: here[1], effect: { e: 'link' } });
  clock[1] += 120;
  PICKS.forEach(([cell, index, value], i) => {
    move(1, { k: 'cell', cell }, i === 0 ? 560 : 420, i === 0 ? -0.14 : 0.16, i === 0 ? 0.5 : 0.9);
    click(1, { e: 'menu', cell }, 120);
    wait(1, 200);
    move(1, { k: 'item', cell, index }, 300 + index * 12, 0.1, 0.6);
    wait(1, 200);
    click(1, { e: 'fill', cell, value }, 60);
  });
  move(1, { k: 'ieRest' }, 520, 0.12, 0.4);

  // 둘 다 끝난 장면을 잠깐 보여 준 뒤 처음 자리로 돌아가고 화면 전체가 흐려진다
  const done = Math.max(clock[0], clock[1]);
  const still = done + 300;
  const back = done + 2600;
  until(0, back);
  until(1, back + 120);
  move(0, start[0], 700, 0.16, 0.2);
  move(1, start[1], 700, -0.12, 0.2);
  const leaveAt = Math.max(clock[0], clock[1]) + 100;
  // 두 사람의 사건을 시간순으로 섞는다(stateAt은 시간순으로 쌓는다)
  events.sort((a, b) => a.at - b.at);
  moves.sort((a, b) => a.at - b.at);
  return { moves, events, start, still, leaveAt, loop: leaveAt + 500 };
}

// ───────────────────────── 포인터 자리 ─────────────────────────

const easeOutBack = (t: number, c: number) => 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);

/** 이동 진행도(0~1)를 경로 위치 비율로. 부드럽게 출발해 목표 근처에서 느려지고 조금 지나쳤다 돌아온다 */
export function moveEase(t: number, over: number): number {
  const u = t * t * (3 - 2 * t) * 0.45 + t * 0.55;
  return over > 0 ? easeOutBack(u, over) : 1 - Math.pow(1 - u, 3);
}

/** a에서 b로 가는 휘는 길(2차 베지어)의 e 지점 */
export function bendPoint(a: Pt, b: Pt, bend: number, e: number): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const c = { x: (a.x + b.x) / 2 - dy * bend, y: (a.y + b.y) / 2 + dx * bend };
  const u = 1 - e;
  return { x: u * u * a.x + 2 * u * e * c.x + e * e * b.x, y: u * u * a.y + 2 * u * e * c.y + e * e * b.y };
}

/** ms 시각에 who의 포인터가 있는 자리. 쉬는 동안에도 아주 조금 흔들린다 */
export function cursorAt(script: Script, who: Who, ms: number, resolve: (a: Anchor) => Pt): Pt {
  let anchor = script.start[who];
  let p: Pt | null = null;
  for (const m of script.moves) {
    if (m.who !== who) continue;
    if (ms < m.at) break;
    if (ms >= m.at + m.dur) {
      anchor = m.to;
      continue;
    }
    const t = (ms - m.at) / m.dur;
    p = bendPoint(resolve(m.from), resolve(m.to), m.bend, moveEase(t, m.over));
    break;
  }
  const base = p ?? resolve(anchor);
  // 끄는 동안에는 흔들지 않는다(고무줄 선 끝과 포인터가 딱 붙어 있다)
  if (script.moves.some((m) => m.who === who && m.drag && ms >= m.at && ms < m.at + m.dur)) return base;
  const phase = who === 0 ? 0.7 : 2.3;
  const wobble = Math.sin(ms / 230 + phase) * Math.sin(ms / 710 + phase * 2);
  return { x: base.x + wobble * 1.2, y: base.y + Math.cos(ms / 310 + phase) * wobble };
}

/** ms 시각에 who가 마지막으로 간(또는 가고 있는) 자리와 도착했는지 */
export function targetAt(script: Script, who: Who, ms: number): { anchor: Anchor; arrived: boolean } {
  let anchor = script.start[who];
  let arrived = true;
  for (const m of script.moves) {
    if (m.who !== who || ms <= m.at) continue;
    anchor = m.to;
    arrived = ms >= m.at + m.dur;
  }
  return { anchor, arrived };
}

// ───────────────────────── 화면 상태 ─────────────────────────

export interface HeroState {
  shown: ReadonlySet<string>;
  /** 사람별로 마지막에 놓은 도형이나 표(선택 테두리) */
  picks: readonly [string | null, string | null];
  /** IE 테이블 추가 도구가 눌려 있는지 */
  tool: boolean;
  /** 포인터가 테이블 추가 버튼에 올라가 있는지 */
  toolHover: boolean;
  /** 연결 점을 보여 줄 표 번호. 없으면 -1 */
  dots: number;
  /** 끌고 있는 관계선: 시작 자리, 놓을 자리, 끈 비율(포인터와 같은 쉬움 곡선) */
  draft: { from: Anchor; to: Anchor; e: number } | null;
  fills: Readonly<Record<string, string>>;
  /** 열린 메뉴와 포인터가 올라간 항목 */
  menu: CellRef | null;
  hover: number;
  /** 누른 자리를 잠깐 보여 주는 표시(사람, 지난 비율) */
  clicks: Array<{ who: Who; anchor: Anchor; age: number }>;
  leaving: boolean;
}

const sameCell = (a: CellRef | null, b: CellRef) => !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** 사건을 시간순으로 쌓아 ms 시각의 화면 상태를 만든다. 사건이 아닌 것으로는 상태가 바뀌지 않는다 */
export function stateAt(script: Script, ms: number): HeroState {
  const shown = new Set<string>();
  const picks: [string | null, string | null] = [null, null];
  const fills: Record<string, string> = {};
  let menu: CellRef | null = null;
  let tool = false;
  let dragging = false;
  const clicks: HeroState['clicks'] = [];
  for (const ev of script.events) {
    if (ev.at > ms) break;
    const f = ev.effect;
    if (ms - ev.at < 360) clicks.push({ who: ev.who, anchor: ev.anchor, age: (ms - ev.at) / 360 });
    if (f.e === 'place') {
      f.ids.forEach((id) => shown.add(id));
      picks[ev.who] = f.ids[0];
      // 테이블 추가 도구는 표를 하나 놓으면 풀린다(도구는 IE를 그리는 서연의 것)
      if (ev.who === 1) tool = false;
    } else if (f.e === 'label') {
      shown.add(`${f.edge}L`);
      picks[ev.who] = null;
    } else if (f.e === 'tool') tool = true;
    else if (f.e === 'linkStart') {
      dragging = true;
      picks[ev.who] = null;
    } else if (f.e === 'link') {
      dragging = false;
      shown.add('link');
    } else if (f.e === 'menu') menu = f.cell;
    else if (f.e === 'fill') {
      fills[cellKey(f.cell)] = f.value;
      if (sameCell(menu, f.cell)) menu = null;
    }
  }
  // 끄는 만큼 선이 늘어난다(끌기의 결과)
  let draft: HeroState['draft'] = null;
  if (dragging) {
    const m = script.moves.find((mv) => mv.drag && ms >= mv.at && ms <= mv.at + mv.dur + 200);
    if (m) draft = { from: m.from, to: m.to, e: moveEase(Math.min(1, Math.max(0, (ms - m.at) / m.dur)), m.over) };
  }
  // 포인터가 올라간 것(도착한 자리)
  const s = targetAt(script, 1, ms);
  const hover = menu && s.arrived && s.anchor.k === 'item' && sameCell(menu, s.anchor.cell) ? s.anchor.index : -1;
  const dots = draft ? (draft.from.k === 'dot' ? draft.from.table : -1) : s.arrived && s.anchor.k === 'dot' ? s.anchor.table : -1;
  return {
    shown,
    picks,
    tool,
    toolHover: s.arrived && s.anchor.k === 'ieTool',
    dots,
    draft,
    fills,
    menu,
    hover,
    clicks,
    leaving: ms >= script.leaveAt,
  };
}

// ───────────────────────── IE 그림의 짜임 ─────────────────────────

/** 방 화면의 IE와 같은 짜임: 머리, 칸 이름 줄(키, 이름, 타입, NULL), 기본키 묶음, 구분선, 나머지 컬럼 */
export const IE = { head: 32, colhead: 20, row: 25, font: 12, pad: 8, gap: 64, dot: 14 };
/** 칸 메뉴(방 화면의 PaneMenu 모양): 항목 높이, 안쪽 여백 */
export const MENU = { item: 21, pad: 4 };

export interface IeTableSpec {
  name: string;
  /** 컬럼 이름. pk는 기본키 묶음에 놓인다 */
  cols: Array<{ name: string; pk?: boolean }>;
}

export interface IeGeom {
  w: number;
  /** 표마다 위 끝 */
  ys: number[];
  /** 표마다 다 채운 높이 */
  heights: number[];
  total: number;
  X: { name: number; type: number; null: number };
  keyW: number;
  /** 표 ti의 앞 n개 컬럼만 있을 때 높이 */
  height: (ti: number, n: number) => number;
  /** 컬럼 ci 행의 위 끝 */
  rowTop: (ti: number, ci: number) => number;
  cell: (c: CellRef) => { x: number; y: number; w: number; h: number };
  menu: (c: CellRef, items: string[]) => { x: number; y: number; w: number; h: number };
}

/**
 * 표 이름과 컬럼 이름, 칸 이름 줄의 글자(언어마다 다르다)로 IE 그림의 칸 자리를 정한다.
 * 글자 폭을 재서 칸 폭을 정하므로 어느 언어에서도 글자가 칸 안에 들어간다.
 */
export function ieGeometry(tables: IeTableSpec[], labels: { key: string; name: string; type: string }): IeGeom {
  const bold = 1.08;
  const keyW = Math.ceil(Math.max(30, approximateLineWidth(labels.key, 10) * bold + 12));
  const nameW = Math.ceil(Math.max(...tables.flatMap((tb) => tb.cols.map((c) => approximateLineWidth(c.name, IE.font) * bold)), approximateLineWidth(labels.name, 10) * bold) + IE.pad * 2);
  const typeW = Math.ceil(Math.max(approximateLineWidth('VARCHAR(255)', IE.font - 1), approximateLineWidth(labels.type, 10) * bold) + IE.pad * 2);
  const nullW = 70;
  const titleW = Math.max(...tables.map((tb) => approximateLineWidth(tb.name, 13) * bold)) + IE.pad * 2 + 4;
  const w = Math.ceil(Math.max(keyW + nameW + typeW + nullW, titleW));
  const X = { name: keyW, type: keyW + nameW, null: w - nullW };
  const height = (_ti: number, n: number) => IE.head + IE.colhead + n * IE.row;
  const heights = tables.map((tb, ti) => height(ti, tb.cols.length));
  const ys = [0];
  for (let i = 1; i < tables.length; i++) ys.push(ys[i - 1] + heights[i - 1] + IE.gap);
  const rowTop = (ti: number, ci: number) => ys[ti] + IE.head + IE.colhead + ci * IE.row;
  const cell = ([ti, ci, kind]: CellRef) => ({ x: kind === 'type' ? X.type : X.null, y: rowTop(ti, ci), w: kind === 'type' ? typeW : nullW, h: IE.row });
  const menu = (c: CellRef, items: string[]) => {
    const box = cell(c);
    const mw = Math.ceil(Math.max(...items.map((it) => approximateLineWidth(it, 11))) + 20);
    const mh = items.length * MENU.item + MENU.pad * 2;
    // 아래 표에서는 칸 위로 연다(방 화면도 아래 공간이 모자라면 위로 연다)
    return { x: Math.min(box.x, w + 12 - mw), y: c[0] === tables.length - 1 ? box.y - mh - 3 : box.y + box.h + 3, w: mw, h: mh };
  };
  const last = tables.length - 1;
  return { w, ys, heights, total: ys[last] + heights[last], X, keyW, height, rowTop, cell, menu };
}
