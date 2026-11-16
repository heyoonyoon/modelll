import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StatsCollector, closeKind, dayLabel, hourOf, dayNumber, isAbnormalClose, isBot, normalizeDomain } from './stats';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const id = (n: number) => n.toString(16).padStart(32, '0');
/** 서울 시각으로 그날 정오(UTC 03:00) */
const noon = (label: string) => Date.parse(`${label}T03:00:00Z`);

describe('서비스 지표 모으기', () => {
  let dir: string;
  let clock = 0;
  const make = () => new StatsCollector({ dir, salt: 'x'.repeat(64), now: () => clock, flushIntervalMs: 60_000 });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-stats-'));
    clock = noon('2026-11-13');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('날짜 경계는 Asia/Seoul 자정이다', () => {
    expect(dayLabel(dayNumber(Date.parse('2026-11-13T14:59:59Z')))).toBe('2026-11-13');
    expect(dayLabel(dayNumber(Date.parse('2026-11-13T15:00:00Z')))).toBe('2026-11-14');
    expect(dayLabel(dayNumber(Date.parse('2026-11-12T15:00:00Z')))).toBe('2026-11-13');
  });

  it('자정을 넘기면 어제 집계를 확정하고 새 날을 센다', async () => {
    const s = make();
    await s.init();
    clock = Date.parse('2026-11-13T14:59:00Z'); // 23:59 KST
    s.clientEvent({ a: id(1), e: 'home_view' }, UA);
    clock = Date.parse('2026-11-13T15:01:00Z'); // 다음 날 00:01 KST
    s.clientEvent({ a: id(2), e: 'home_view' }, UA);
    const rows = s.daily(2);
    expect(rows.map((r) => r.day)).toEqual(['2026-11-13', '2026-11-14']);
    expect(rows[0].u.home).toBe(1);
    expect(rows[1].u.home).toBe(1);
    await s.stop();
    const file = await fs.readFile(path.join(dir, 'daily.jsonl'), 'utf8');
    expect(file.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(file).day).toBe('2026-11-13');
  });

  it('같은 브라우저는 하루에 한 번만 센다(고유 집계)', async () => {
    const s = make();
    await s.init();
    for (let i = 0; i < 5; i++) s.clientEvent({ a: id(1), e: 'home_view' }, UA);
    s.clientEvent({ a: id(2), e: 'home_view' }, UA);
    s.clientEvent({ a: id(2), e: 'create_click' }, UA);
    expect(s.clientEvent({ a: id(2), e: 'migrate_open' }, UA)).toBe(true);
    const t = s.today();
    expect(t.u.visitors).toBe(2);
    expect(t.u.home).toBe(2);
    expect(t.u['f:create']).toBe(1);
    expect(t.u['u:migrate']).toBe(1);
    expect(t.u.new).toBe(2);
    expect(t.u.returning).toBe(0);
  });

  it('봇과 User-Agent가 없는 요청은 세지 않는다', async () => {
    const s = make();
    await s.init();
    expect(isBot('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36')).toBe(true);
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBot(undefined)).toBe(true);
    expect(isBot(UA)).toBe(false);
    expect(s.clientEvent({ a: id(1), e: 'home_view' }, 'Googlebot/2.1')).toBe(false);
    s.wsOpen({}, 'room1', id(3), 'Mozilla/5.0 (compatible; bingbot/2.0)');
    expect(s.today().u.visitors ?? 0).toBe(0);
    expect(s.liveCounts().users).toBe(0);
  });

  it('모르는 이벤트와 틀린 값은 버리고, 밖에서 온 글자는 좁혀서 받는다', async () => {
    const s = make();
    await s.init();
    expect(s.clientEvent({ a: id(1), e: 'drop_table' }, UA)).toBe(false);
    expect(s.clientEvent({ a: 'not-an-id', e: 'home_view' }, UA)).toBe(false);
    expect(s.clientEvent({ a: 'ABCDEF0123456789ABCDEF0123456789', e: 'home_view' }, UA)).toBe(false);
    expect(s.clientEvent({ a: id(1), e: 'export', kind: 'pdf' }, UA)).toBe(false);
    expect(s.clientEvent({ a: id(1), e: 'dbms', v: 'sqlserver' }, UA)).toBe(false);
    expect(s.clientEvent(['home_view'], UA)).toBe(false);
    s.clientEvent({ a: id(1), e: 'home_view', land: 1, ref: '<script>alert(1)</script>', utm: '"><img src=x>', lang: 'ko<b>' }, UA);
    s.clientEvent({ a: id(2), e: 'home_view', land: 1, ref: 'WWW.Google.COM', utm: 'Newsletter_1' }, UA);
    const c = s.today().c;
    expect(Object.keys(c).filter((k) => k.startsWith('ref:')).sort()).toEqual(['ref:direct', 'ref:google.com']);
    expect(Object.keys(c).filter((k) => k.startsWith('utm:'))).toEqual(['utm:newsletter_1']);
    expect(Object.keys(s.today().u).some((k) => k.includes('<'))).toBe(false);
    expect(normalizeDomain('javascript:alert(1)')).toBeNull();
    expect(normalizeDomain('xn--9n2bp8q.com')).toBe('xn--9n2bp8q.com');
    expect(normalizeDomain(`${'a'.repeat(62)}.com`)).toBeNull();
  });

  it('도메인 종류가 많아지면 50개 뒤로는 기타로 묶는다', async () => {
    const s = make();
    await s.init();
    for (let i = 0; i < 80; i++) s.clientEvent({ a: id(i + 1), e: 'home_view', land: 1, ref: `site${i}.example` }, UA);
    const refs = Object.keys(s.today().c).filter((k) => k.startsWith('ref:'));
    expect(refs).toHaveLength(51);
    expect(s.today().c['ref:(기타)']).toBe(30);
  });

  it('리텐션: 첫 방문 뒤 1, 7, 30일 안에 다시 온 사람', async () => {
    const s = make();
    await s.init();
    s.clientEvent({ a: id(1), e: 'home_view' }, UA);
    s.clientEvent({ a: id(2), e: 'home_view' }, UA);
    s.clientEvent({ a: id(3), e: 'home_view' }, UA);
    clock = noon('2026-11-14');
    s.clientEvent({ a: id(1), e: 'home_view' }, UA);
    clock = noon('2026-11-18');
    s.clientEvent({ a: id(2), e: 'home_view' }, UA);
    clock = noon('2026-11-20');
    expect(s.activeUsers()).toEqual({ wau: 2, mau: 3 });
    clock = noon('2026-12-20');
    const cohort = s.retention(60).find((r) => r.day === '2026-11-13');
    expect(cohort).toMatchObject({ n: 3, d1: 1, d7: 2, d30: 2, ready: [true, true, true] });
    expect(s.activeUsers()).toEqual({ wau: 0, mau: 0 });
  });

  it('다시 켜도 오늘 집계와 누적이 이어진다', async () => {
    const a = make();
    await a.init();
    a.clientEvent({ a: id(1), e: 'home_view' }, UA);
    a.clientEvent({ a: id(1), e: 'sql_view', r: 'room1' }, UA);
    a.cliCall('push');
    a.roomCreated('room1');
    await a.stop();

    const b = make();
    await b.init();
    b.clientEvent({ a: id(1), e: 'home_view' }, UA);
    expect(b.today().u.visitors).toBe(1);
    expect(b.today().u.new).toBe(1);
    expect(b.totalsNow()).toMatchObject({ visitors: 1, appUsers: 1, cli: 1, sql: 1, rooms: 1 });
    await b.stop();

    // 꺼져 있는 사이에 날이 바뀌면 켤 때 확정한다
    clock = noon('2026-11-15');
    const c = make();
    await c.init();
    const rows = c.daily(3);
    expect(rows[0]).toMatchObject({ day: '2026-11-13', u: { visitors: 1 } });
    expect(rows[1].u).toEqual({});
    expect(c.today().u.visitors ?? 0).toBe(0);
    await c.stop();
  });

  it('실시간 목록: 나라, 기기, 언어, 접속 시간, 방 해시 앞 6자, 신규 여부. 같은 브라우저의 같은 방 탭은 한 줄', async () => {
    const s = make();
    await s.init();
    const a1 = {};
    const a2 = {};
    const b = {};
    s.wsOpen(a1, 'room1', id(1), 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', 'KR', 'ko');
    clock += 60_000;
    s.wsOpen(a2, 'room1', id(1), 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', 'KR', 'ko');
    s.wsOpen(b, 'room2', id(2), UA, 'US', 'en');
    const list = s.liveList();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ country: 'KR', device: 'm', lang: 'ko', isNew: true, tabs: 2 });
    expect(list[0].room).toMatch(/^[A-Za-z0-9_-]{6}$/);
    expect(list[0].room).not.toContain('room1');
    expect(list[1]).toMatchObject({ country: 'US', device: 'd', lang: 'en', tabs: 1 });
    expect(list[0].since).toBeLessThan(list[1].since);
    expect(list[0].who).toMatch(/^[0-9a-zA-Z_-]{4}$/);
    expect(list[0].who).not.toBe(list[1].who);
    expect(list[0].name).toBeNull();
    // 이름은 방에 알린 awareness에서 읽는다. 첫 탭에 이름이 없으면 같은 줄의 다른 탭에서 찾는다
    const named = s.liveList((key, roomId) => {
      if (roomId !== 'room1') return null;
      return key === a2 ? { name: '희윤', lastEdit: 0, lastMove: 500 } : { name: null, lastEdit: 300, lastMove: 100 };
    });
    // 같은 줄의 탭들 가운데 가장 최근 시각을 쓴다
    expect(named[0]).toMatchObject({ name: '희윤', lastEdit: 300, lastMove: 500 });
    expect(named[1]).toMatchObject({ name: null, lastEdit: 0, lastMove: 0 });
    s.wsClose(a1, 1000);
    s.wsClose(a2, 1000);
    expect(s.liveList()).toHaveLength(1);
    await s.stop();
  });

  it('자정을 넘어 연결을 이어 가는 사람과 방은 새 날의 방문자와 열린 방으로 센다(신규나 재방문 표시는 붙이지 않는다)', async () => {
    clock = Date.parse('2026-11-13T14:50:00Z'); // 서울 23:50
    const s = make();
    await s.init();
    s.wsOpen({}, 'room1', id(1), UA, 'KR');
    clock = Date.parse('2026-11-13T15:10:00Z'); // 서울 다음 날 00:10
    const t = s.today();
    expect(t.day).toBe('2026-11-14');
    expect(t.u.visitors).toBe(1);
    expect(t.u.app).toBe(1);
    expect(t.u['cc:KR']).toBe(1);
    expect(t.u['r:open']).toBe(1);
    expect(t.u.new).toBeUndefined();
    expect(t.peak).toBe(1);
    await s.stop();
  });

  it('시간대별: Asia/Seoul 시각으로 접속, 고유 접속자, 최대 동시 접속, 편집을 센다', async () => {
    expect(hourOf(Date.parse('2026-11-13T03:00:00Z'))).toBe(12);
    expect(hourOf(Date.parse('2026-11-13T15:30:00Z'))).toBe(0);
    const s = make();
    await s.init();
    const a = {};
    const b = {};
    s.wsOpen(a, 'room1', id(1), UA); // 12시
    s.wsOpen(b, 'room1', id(2), UA);
    s.edit('room1');
    clock += 60 * 60_000; // 13시: 연결을 이어 가는 사람도 13시 접속자로 센다
    s.tickHour();
    s.wsClose(b, 1000);
    s.edit('room1');
    s.edit('room1');
    const t = s.today();
    expect(t.c['h:conns:12']).toBe(2);
    expect(t.u['h:users:12']).toBe(2);
    expect(t.c['h:peak:12']).toBe(2);
    expect(t.c['h:edits:12']).toBe(1);
    expect(t.u['h:users:13']).toBe(2);
    expect(t.c['h:edits:13']).toBe(2);
    expect(t.c['h:conns:13']).toBeUndefined();
    await s.stop();
  });

  it('웹소켓: 고유 접속자, 최대 동시 접속, 협업 방, 체류 시간, 비정상 종료', async () => {
    const s = make();
    await s.init();
    const w1 = {};
    const w2 = {};
    const w3 = {};
    s.wsOpen(w1, 'room1', id(1), UA);
    s.wsOpen(w2, 'room1', id(1), UA); // 같은 사람의 두 번째 탭
    expect(s.liveCounts()).toMatchObject({ users: 1, collabRooms: 0 });
    s.wsOpen(w3, 'room1', id(2), UA);
    expect(s.liveCounts()).toMatchObject({ users: 2, collabRooms: 1, rooms: 1 });
    s.edit('room1');
    s.edit('room1');
    clock += 90_000;
    s.wsClose(w1, 1001);
    s.wsClose(w2, 1006);
    s.wsClose(w3, 4429);
    const w4 = {};
    s.wsOpen(w4, 'room2', id(3), UA);
    s.wsClose(w4, 1011);
    const t = s.today();
    expect(t.peak).toBe(2);
    expect(t.u['r:collab']).toBe(1);
    expect(t.u['r:active']).toBe(1);
    expect(t.c.edits).toBe(2);
    expect(t.c.wsDrop).toBe(1);
    expect(t.c.wsServer).toBe(1);
    expect(closeKind(1006)).toBe('drop');
    expect(closeKind(1011)).toBe('server');
    expect(closeKind(1001)).toBeNull();
    expect(t.sess).toMatchObject({ n: 4 });
    expect(s.liveCounts()).toMatchObject({ users: 0, rooms: 0 });
    expect(isAbnormalClose(1000)).toBe(false);
    expect(isAbnormalClose(1011)).toBe(true);
  });

  it('새 방이 다음 날 다시 열렸는지 센다', async () => {
    const s = make();
    await s.init();
    s.roomCreated('room1');
    s.roomCreated('room2');
    clock = noon('2026-11-14');
    const w = {};
    s.wsOpen(w, 'room1', id(1), UA);
    s.wsClose(w, 1000);
    clock = noon('2026-11-16');
    const row = s.roomNextDay(7).find((r) => r.day === '2026-11-13');
    expect(row).toMatchObject({ created: 2, reopened: 1, ready: true });
  });

  it('파일에는 익명 ID와 방 id 원문이 남지 않고, 솔트 파일은 0600이다', async () => {
    const s = new StatsCollector({ dir, now: () => clock });
    await s.init();
    const anon = 'abcdef0123456789abcdef0123456789';
    s.clientEvent({ a: anon, e: 'rel_write', r: 'secret-room-id' }, UA);
    s.wsOpen({}, 'secret-room-id', anon, UA);
    await s.stop();
    const names = await fs.readdir(dir);
    expect(names.sort()).toEqual(['rooms.json', 'salt', 'today.json', 'users.json']);
    for (const name of names) {
      const text = await fs.readFile(path.join(dir, name), 'utf8');
      expect(text).not.toContain(anon);
      expect(text).not.toContain('secret-room-id');
      expect(text).not.toContain('Mozilla');
    }
    expect((await fs.stat(path.join(dir, 'salt'))).mode & 0o777).toBe(0o600);
  });

  it('AI 호출과 AI가 만든 방, 관계 모델이 있는 방을 센다', async () => {
    const s = make();
    await s.init();
    s.cliCall('new');
    s.aiRoom('r1', 'create');
    s.mcpCall('update_diagram');
    s.mcpCall('diagram_to_sql');
    s.mcpCall('rm_rf'); // 모르는 도구는 세지 않는다
    s.aiRoom('r1', 'modify');
    s.relationalWritten('r1');
    s.relationalWritten('r1');
    const t = s.today();
    expect(t.c).toMatchObject({ 'cli:new': 1, 'mcp:update_diagram': 1, 'mcp:diagram_to_sql': 1, sql: 1 });
    expect(t.c['mcp:rm_rf']).toBeUndefined();
    expect(t.u).toMatchObject({ 'r:ainew': 1, 'r:aimod': 1, 'r:rel': 1 });
    expect(s.totalsNow()).toMatchObject({ cli: 1, mcp: 2, aiRooms: 1, relRooms: 1, sql: 1 });
  });
});
