import { describe, expect, it } from 'vitest';
import { DEPT, PICKS, STU, buildScript, cursorAt, ieGeometry, stateAt, targetAt, type Anchor, type Pt, type Who } from './heroScript';

/** 분할 화면(약 800×432)의 실제 배치를 어림한 좌표. 왼쪽 반은 ERD, 오른쪽 반은 IE다 */
function fakeResolve(a: Anchor): Pt {
  switch (a.k) {
    case 'erd':
      return { x: 60 + a.x * 0.9, y: 40 + a.y * 0.9 };
    case 'ieTool':
      return { x: 420, y: 70 };
    case 'spot':
      return { x: 620, y: 60 + a.table * 200 };
    case 'dot':
      return { x: 620, y: 150 + a.table * 200 };
    case 'drop':
      return { x: 600, y: 62 + a.table * 200 };
    case 'cell':
      return { x: a.cell[2] === 'type' ? 650 : 720, y: 100 + a.cell[0] * 200 + a.cell[1] * 25 };
    case 'item':
      return { x: 660, y: 120 + a.index * 21 };
    case 'ieRest':
      return { x: 770, y: 200 };
  }
}

const script = buildScript();
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

describe('히어로 각본', () => {
  it('포인터는 순간이동하지 않는다: 16ms마다 40px 이하로만 움직이고, 처음으로 돌아갈 때도 이어진다', () => {
    for (const who of [0, 1] as Who[]) {
      let prev = cursorAt(script, who, 0, fakeResolve);
      for (let ms = 16; ms < script.loop + 16; ms += 16) {
        // 마지막 한 걸음은 처음(0)과 이어지는지 본다
        const at = ms >= script.loop ? 0 : ms;
        const p = cursorAt(script, who, at, fakeResolve);
        expect(dist(prev, p), `who ${who} at ${ms}ms`).toBeLessThanOrEqual(40);
        prev = p;
      }
    }
  });

  it('사람마다 이동은 직전 자리에서 시작하고 겹치지 않는다', () => {
    for (const who of [0, 1] as Who[]) {
      const moves = script.moves.filter((m) => m.who === who);
      let here = script.start[who];
      let free = 0;
      for (const m of moves) {
        expect(m.from).toEqual(here);
        expect(m.at).toBeGreaterThanOrEqual(free);
        here = m.to;
        free = m.at + m.dur;
      }
      // 마지막에는 처음 자리로 돌아온다
      expect(here).toEqual(script.start[who]);
      expect(free).toBeLessThanOrEqual(script.leaveAt);
    }
  });

  it('한 사람은 한 칸에서만 일한다: 지민은 ERD, 서연은 IE', () => {
    const erd = (a: Anchor) => a.k === 'erd';
    for (const m of script.moves) expect(erd(m.from) && erd(m.to), `${m.who} ${JSON.stringify(m.to)}`).toBe(m.who === 0);
    for (const ev of script.events) expect(erd(ev.anchor)).toBe(ev.who === 0);
  });

  it('두 사람은 동시에 일한다: 각자의 작업 시간이 절반 넘게 겹친다', () => {
    const span = (who: Who) => {
      const evs = script.events.filter((e) => e.who === who);
      return [evs[0].at, evs[evs.length - 1].at];
    };
    const [a0, a1] = span(0);
    const [b0, b1] = span(1);
    const overlap = Math.min(a1, b1) - Math.max(a0, b0);
    expect(overlap).toBeGreaterThan(0.5 * Math.min(a1 - a0, b1 - b0));
  });

  it('누르기와 끌기, 놓기는 포인터가 그 자리에 도착한 뒤에 일어난다', () => {
    for (const ev of script.events) {
      const target = targetAt(script, ev.who, ev.at);
      expect(target.arrived, `${ev.effect.e} at ${ev.at}`).toBe(true);
      expect(target.anchor).toEqual(ev.anchor);
      expect(dist(cursorAt(script, ev.who, ev.at, fakeResolve), fakeResolve(ev.anchor))).toBeLessThan(3);
    }
  });

  it('사건은 시간순이고, 사람마다 각본에 적힌 결과가 그 시각에 화면에 나타난다', () => {
    script.events.forEach((e, i) => i > 0 && expect(e.at).toBeGreaterThanOrEqual(script.events[i - 1].at));
    for (const ev of script.events.filter((e) => e.effect.e === 'place')) {
      const ids = (ev.effect as { ids: string[] }).ids;
      expect([...stateAt(script, ev.at - 1).shown].some((id) => ids.includes(id))).toBe(false);
      expect(ids.every((id) => stateAt(script, ev.at).shown.has(id))).toBe(true);
    }
  });

  it('IE: 테이블 추가 도구를 누른 뒤에 표를 놓고, 학생에서 학과로 끌어 놓아야 관계선이 생긴다', () => {
    const order = script.events.filter((e) => e.who === 1).map((e) => e.effect.e);
    expect(order.slice(0, 6)).toEqual(['tool', 'place', 'tool', 'place', 'linkStart', 'link']);
    const placed = script.events.filter((e) => e.effect.e === 'place' && e.who === 1);
    expect(placed.map((e) => e.anchor)).toEqual([
      { k: 'spot', table: DEPT },
      { k: 'spot', table: STU },
    ]);
    for (const p of placed) expect(stateAt(script, p.at - 1).tool).toBe(true);
    const start = script.events.find((e) => e.effect.e === 'linkStart')!;
    const end = script.events.find((e) => e.effect.e === 'link')!;
    expect(start.anchor).toEqual({ k: 'dot', table: STU });
    expect(end.anchor).toEqual({ k: 'drop', table: DEPT });
    // 끄는 동안 고무줄 선이 늘어나고, 놓기 전에는 관계선이 없다
    const mid = stateAt(script, (start.at + end.at) / 2);
    expect(mid.draft).not.toBeNull();
    expect(mid.draft!.e).toBeGreaterThan(0);
    expect(mid.draft!.e).toBeLessThan(1);
    expect(mid.shown.has('link')).toBe(false);
    const after = stateAt(script, end.at);
    expect(after.shown.has('link')).toBe(true);
    expect(after.draft).toBeNull();
  });

  it('화면 상태는 사건(누르기, 끌기, 놓기)이 있는 순간에만 바뀐다', () => {
    const shape = (ms: number) => {
      const s = stateAt(script, ms);
      return JSON.stringify({ shown: [...s.shown].sort(), picks: s.picks, tool: s.tool, fills: s.fills, menu: s.menu, drafting: s.draft !== null });
    };
    let prev = shape(0);
    for (let ms = 8; ms < script.loop; ms += 8) {
      const now = shape(ms);
      if (now !== prev) {
        const cause = script.events.some((e) => e.at > ms - 8 && e.at <= ms);
        expect(cause, `state changed at ${ms}ms without an action`).toBe(true);
      }
      prev = now;
    }
    // 처음에는 아무것도 없다
    expect(stateAt(script, 0).shown.size).toBe(0);
  });

  it('정지 장면은 두 사람이 다 그린 뒤다: ERD 전부, IE 표 둘과 관계선, 고른 타입', () => {
    const still = stateAt(script, script.still);
    for (const id of ['stu', 'dep', 'bel', 'sid', 'snm', 'dcd', 'dnm', 'r1L', 'r2L', 't0', 't1', 'link']) expect(still.shown.has(id), id).toBe(true);
    expect(still.fills).toEqual(Object.fromEntries(PICKS.map(([c, , v]) => [`${c[0]}.${c[1]}.${c[2]}`, v])));
    expect(still.menu).toBeNull();
    expect(still.draft).toBeNull();
    expect(still.tool).toBe(false);
    expect(script.still).toBeLessThan(script.leaveAt);
  });

  it('IE 칸 폭은 글자 폭에 맞춰 늘어난다', () => {
    const tables = [
      { name: 'Student', cols: [{ name: 'Student ID', pk: true }, { name: 'Name' }, { name: 'Dept code' }] },
      { name: 'Department', cols: [{ name: 'Dept code', pk: true }, { name: 'Dept name' }] },
    ];
    const short = ieGeometry(tables, { key: 'Key', name: 'Name', type: 'Type' });
    const long = ieGeometry(tables, { key: 'Schlüsselwort', name: 'Name', type: 'Type' });
    expect(long.keyW).toBeGreaterThan(short.keyW);
    expect(long.w).toBeGreaterThan(short.w);
    expect(short.ys[1]).toBeGreaterThan(short.heights[0]);
  });
});
