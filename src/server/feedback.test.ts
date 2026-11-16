import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminPageHtml } from './adminPage';
import {
  FeedbackRateLimiter,
  FeedbackStore,
  normalizeMessage,
  sanitizeLang,
  sanitizePage,
  uaSummary,
  validateFeedback,
} from './feedback';
import { createCountryLookup, defaultCountryDbPath } from './geo';
import { createErdServer, type ErdServer } from './server';
import { StatsCollector } from './stats';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

describe('의견 입력 다듬기', () => {
  it('제어 문자와 글 방향 문자를 지우고 줄바꿈과 탭은 남긴다', () => {
    expect(normalizeMessage('  안녕\r\n하세요\t!\u0000\u0007\u202E\u200B  ')).toBe('안녕\n하세요\t!');
    expect(normalizeMessage('a\n\n\n\n\n\nb')).toBe('a\n\n\nb');
    expect(normalizeMessage('é')).toBe('é');
    // 짝 없는 서로게이트
    expect(normalizeMessage('x\uD800y')).toBe('x�y');
    // 이모지 ZWJ는 남긴다
    expect(normalizeMessage('👩‍💻')).toBe('👩‍💻');
  });

  it('비었거나 문자열이 아니거나 2000자를 넘으면 틀린 글이다', () => {
    expect(normalizeMessage('   \n\t ')).toBeNull();
    expect(normalizeMessage('\u0000\u0001')).toBeNull();
    expect(normalizeMessage(42)).toBeNull();
    expect(normalizeMessage({ toString: () => 'x' })).toBeNull();
    expect(normalizeMessage('가'.repeat(2000))).toHaveLength(2000);
    expect(normalizeMessage('가'.repeat(2001))).toBeNull();
    expect(validateFeedback(null)).toBeNull();
    expect(validateFeedback(['hi'])).toBeNull();
    expect(validateFeedback({ message: '' })).toBeNull();
  });

  it('page와 lang은 틀리면 버리고, 방 id는 가린다', () => {
    expect(sanitizePage('/')).toBe('/');
    expect(sanitizePage('/r/AbC_123-x?x=1#y')).toBe('/r/:id');
    expect(sanitizePage('/docs/guide')).toBe('/docs/guide');
    expect(sanitizePage('//evil.example/x')).toBeNull();
    expect(sanitizePage('https://evil.example/')).toBeNull();
    expect(sanitizePage('/\\evil')).toBeNull();
    expect(sanitizePage('javascript:alert(1)')).toBeNull();
    expect(sanitizePage('/' + 'a'.repeat(200))).toBeNull();
    expect(sanitizePage('/a"><img src=x>')).toBeNull();
    expect(sanitizeLang('ko')).toBe('ko');
    expect(sanitizeLang('zh-TW')).toBe('zh-TW');
    expect(sanitizeLang('ko<b>')).toBeNull();
    expect(sanitizeLang('abcdefghijk')).toBeNull();
    expect(validateFeedback({ message: 'hi', page: '//x', lang: 1, extra: 'ignored' })).toEqual({ message: 'hi', page: null, lang: null });
  });

  it('User-Agent는 브라우저와 OS 이름만 남긴다', () => {
    expect(uaSummary(UA)).toBe('Chrome / macOS');
    expect(uaSummary('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari / iOS');
    expect(uaSummary('curl/8.4.0')).toBe('bot');
    expect(uaSummary(undefined)).toBe('unknown');
  });
});

describe('의견 요청 제한', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T03:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1초에 1건', () => {
    const l = new FeedbackRateLimiter();
    expect(l.take('a', Date.now())).toBe(0);
    expect(l.take('a', Date.now())).toBe(1);
    vi.advanceTimersByTime(999);
    expect(l.take('a', Date.now())).toBe(1);
    // 다른 IP는 따로 센다
    expect(l.take('b', Date.now())).toBe(0);
    vi.advanceTimersByTime(1);
    expect(l.take('a', Date.now())).toBe(0);
  });

  it('최근 10분 동안 100건(미끄러지는 구간)', () => {
    const l = new FeedbackRateLimiter();
    for (let i = 0; i < 100; i++) {
      expect(l.take('a', Date.now()), `#${i}`).toBe(0);
      vi.advanceTimersByTime(1000);
    }
    // 첫 요청에서 100초가 지났다. 그 요청이 10분 밖으로 나갈 때까지 500초 남았다
    expect(l.take('a', Date.now())).toBe(500);
    vi.advanceTimersByTime(499_000);
    expect(l.take('a', Date.now())).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(l.take('a', Date.now())).toBe(0);
    expect(l.take('a', Date.now())).toBeGreaterThan(0);
    expect(l.lastHour('a', Date.now())).toBe(101);
  });

  it('모든 사람을 합친 한도와 메모리 한도', () => {
    const l = new FeedbackRateLimiter({ perSecond: 1, per10Min: 100, globalPer10Min: 3, maxSenders: 2 });
    expect(l.take('a', Date.now())).toBe(0);
    expect(l.take('b', Date.now())).toBe(0);
    expect(l.take('c', Date.now())).toBe(0);
    expect(l.take('d', Date.now())).toBe(600);
    expect(l.size).toBe(2);
  });
});

describe('의견함 저장과 이상 발송', () => {
  let dir: string;
  let clock = 0;
  const make = (extra: Partial<ConstructorParameters<typeof FeedbackStore>[0]> = {}) =>
    new FeedbackStore({ dir: path.join(dir, 'feedback'), saltDir: path.join(dir, 'stats'), salt: 's'.repeat(64), now: () => clock, ...extra });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-feedback-'));
    clock = Date.parse('2026-11-16T03:00:00Z');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('IP 원문 없이 JSON 한 줄로 쌓고, 다시 켜도 글과 이상 기록이 남는다', async () => {
    const a = make();
    await a.init();
    const ip = '203.0.113.7';
    const h = a.hashIp(ip);
    expect(h).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(a.checkRate(h, 'KR')).toBeNull();
    expect(a.submit(h, 'KR', { message: '<script>alert(1)</script>', page: '/r/room1', lang: 'ko' }, UA)).toEqual({ status: 201, body: { ok: true } });
    clock += 2000;
    expect(a.checkRate(h, 'KR')).toBeNull();
    expect(a.submit(h, 'KR', { message: 'x'.repeat(1600) }, UA).status).toBe(201);
    clock += 100;
    expect(a.checkRate(h, 'KR')).toMatchObject({ status: 429, body: { error: 'rate_limited', retryAfter: 1 } });
    expect(a.submit(h, 'KR', { message: 42 }, UA)).toEqual({ status: 400, body: { error: 'invalid' } });
    a.rejectCrossOrigin(h, 'KR');
    await a.stop();

    const file = await fs.readFile(path.join(dir, 'feedback', 'feedback.jsonl'), 'utf8');
    expect(file.trim().split('\n')).toHaveLength(2);
    expect(file).not.toContain(ip);
    const first = JSON.parse(file.split('\n')[0]);
    expect(first).toMatchObject({ message: '<script>alert(1)</script>', page: '/r/:id', lang: 'ko', country: 'KR', ipHash: h, ua: 'Chrome / macOS' });
    expect(Number.isNaN(Date.parse(first.at))).toBe(false);

    const b = make();
    await b.init();
    expect(b.list().items.map((e) => e.message.slice(0, 3))).toEqual(['xxx', '<sc']);
    expect(b.list().items[0].flags).toEqual(['long']);
    const [row] = b.anomalies();
    expect(row).toMatchObject({ ipHash: h, country: 'KR', sent: 2, rejected: 1, invalid: 1, long: 1, crossOrigin: 1, level: 'high' });
    const raw = await fs.readFile(path.join(dir, 'feedback', 'anomalies.json'), 'utf8');
    expect(raw).not.toContain(ip);
  });

  it('같은 글 반복과 1분 폭주, 1시간 20건 넘김을 센다', async () => {
    const s = make();
    await s.init();
    const h = s.hashIp('198.51.100.1');
    for (let i = 0; i < 25; i++) {
      expect(s.checkRate(h, 'US')).toBeNull();
      s.submit(h, 'US', { message: 'spam' }, UA);
      clock += 2000;
    }
    const [row] = s.anomalies();
    expect(row.duplicate).toBe(24);
    expect(row.burst).toBeGreaterThanOrEqual(20);
    expect(row.hourly).toBe(5);
    expect(row.lastHour).toBe(25);
    expect(s.list(0, 1).items[0].flags).toEqual(['burst', 'dup']);
    await s.stop();
  });

  it('한 파일이 차면 옮기고, 두 파일까지만 남긴다', async () => {
    const s = make({ maxPerFile: 3, limits: { perSecond: 1000 } });
    await s.init();
    for (let i = 0; i < 8; i++) {
      s.add('h'.repeat(16), '??', { message: `m${i}`, page: null, lang: null }, UA);
      await s.settled();
    }
    const cur = (await fs.readFile(path.join(dir, 'feedback', 'feedback.jsonl'), 'utf8')).trim().split('\n');
    const prev = (await fs.readFile(path.join(dir, 'feedback', 'feedback.1.jsonl'), 'utf8')).trim().split('\n');
    expect(cur.map((l) => JSON.parse(l).message)).toEqual(['m6', 'm7']);
    expect(prev.map((l) => JSON.parse(l).message)).toEqual(['m3', 'm4', 'm5']);
    expect(s.list().total).toBe(5);
    await s.stop();
  });

  it('솔트가 없으면 지표의 솔트 파일을 함께 쓴다', async () => {
    const stats = new StatsCollector({ dir: path.join(dir, 'stats') });
    await stats.init();
    const s = make({ salt: undefined });
    await s.init();
    const again = make({ salt: undefined });
    await again.init();
    expect(s.hashIp('1.2.3.4')).toBe(again.hashIp('1.2.3.4'));
    await stats.stop();
  });
});

describe('나라 찾기', () => {
  it('사설망, 틀린 주소, DB가 없을 때는 ??', () => {
    const lookup = createCountryLookup();
    expect(defaultCountryDbPath()).toMatch(/dbip-country\.mmdb$/);
    expect(lookup('8.8.8.8')).toBe('US');
    expect(lookup('::ffff:211.234.10.1')).toBe('KR');
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '::1', 'fe80::1', 'unknown', '', 'not-an-ip', '999.1.1.1']) expect(lookup(ip), ip).toBe('??');
    expect(createCountryLookup({ file: null })('8.8.8.8')).toBe('??');
    const logs: string[] = [];
    const broken = createCountryLookup({ file: '/nonexistent/x.mmdb', log: (m) => logs.push(m) });
    expect(broken('8.8.8.8')).toBe('??');
    expect(broken('1.1.1.1')).toBe('??');
    expect(logs).toHaveLength(1);
  });
});

describe('나라별 집계와 리텐션', () => {
  let dir: string;
  let clock = 0;
  const id = (n: number) => n.toString(16).padStart(32, '0');
  const noon = (label: string) => Date.parse(`${label}T03:00:00Z`);
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-stats-cc-'));
    clock = noon('2026-11-10');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('날마다 나라별 고유 브라우저를 세고 기간으로 더한다', async () => {
    const s = new StatsCollector({ dir, salt: 'x'.repeat(64), now: () => clock });
    await s.init();
    s.clientEvent({ a: id(1), e: 'home_view' }, UA, 'KR');
    s.clientEvent({ a: id(1), e: 'home_view' }, UA, 'KR');
    s.clientEvent({ a: id(2), e: 'home_view' }, UA, 'US');
    s.clientEvent({ a: id(3), e: 'home_view' }, UA, '<b>');
    s.clientEvent({ a: id(4), e: 'home_view' }, UA, '??');
    expect(s.today().u).toMatchObject({ 'cc:KR': 1, 'cc:US': 1, 'cc:??': 1 });
    expect(Object.keys(s.today().u).filter((k) => k.startsWith('cc:'))).toHaveLength(3);
    clock = noon('2026-11-12');
    s.clientEvent({ a: id(1), e: 'home_view' }, UA, 'KR');
    s.wsOpen({}, 'room1', id(5), UA, 'JP');
    expect(s.countries(1)).toEqual([['JP', 1], ['KR', 1]]);
    expect(s.countries(7)).toEqual([['KR', 2], ['??', 1], ['JP', 1], ['US', 1]]);
    await s.stop();
  });

  it('D1, D3, D7, D14, D30 코호트', async () => {
    const s = new StatsCollector({ dir, salt: 'x'.repeat(64), now: () => clock });
    await s.init();
    for (let i = 1; i <= 4; i++) s.clientEvent({ a: id(i), e: 'home_view' }, UA);
    clock = noon('2026-11-11');
    s.clientEvent({ a: id(1), e: 'home_view' }, UA);
    clock = noon('2026-11-13');
    s.clientEvent({ a: id(2), e: 'home_view' }, UA);
    clock = noon('2026-11-20');
    s.clientEvent({ a: id(3), e: 'home_view' }, UA);
    clock = noon('2026-11-22');
    const row = s.retention(30).find((r) => r.day === '2026-11-10');
    expect(row).toMatchObject({ n: 4, d1: 1, d3: 2, d7: 2, d14: 3, d30: 3, tracked: true, ready: [true, true, false], readyMore: [true, false] });
    await s.stop();
  });

  it('이전 판에서 넘어온 사용자 기록이면 그 전 코호트의 D3, D14는 모른다고 표시한다', async () => {
    await fs.writeFile(path.join(dir, 'users.json'), JSON.stringify({ v: 1, totals: {}, users: { abc: [labelDay('2026-11-01'), labelDay('2026-11-01'), 1, 0] } }));
    const s = new StatsCollector({ dir, salt: 'x'.repeat(64), now: () => clock });
    await s.init();
    const rows = s.retention(30);
    expect(rows.find((r) => r.day === '2026-11-01')?.tracked).toBe(false);
    expect(rows.find((r) => r.day === '2026-11-10')?.tracked).toBe(true);
    await s.stop();
  });
});

function labelDay(label: string): number {
  return Math.floor(Date.parse(`${label}T00:00:00Z`) / 86_400_000);
}

describe('POST /api/feedback', () => {
  let dataDir: string;
  let server: ErdServer | null = null;
  let port = 0;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-feedback-int-'));
    server = createErdServer({ port: 0, host: '127.0.0.1', dataDir, log: () => {}, stats: { salt: 'z'.repeat(64) }, feedback: true });
    port = (await server.start()).port;
  });
  afterEach(async () => {
    await server?.stop();
    server = null;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function post(body: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: 'POST', path: '/api/feedback', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'user-agent': UA, ...headers } },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }
  /** 프록시(127.0.0.1)가 넘겨준 것처럼 IP를 바꿔 보낸다 */
  const from = (ip: string, extra: Record<string, string> = {}) => ({ 'x-forwarded-for': ip, origin: `http://127.0.0.1:${port}`, ...extra });

  it('계약대로 답한다', async () => {
    const ok = await post(JSON.stringify({ message: '좋아요\n고마워요', page: '/', lang: 'ko' }), from('8.8.8.8'));
    expect(ok.status).toBe(201);
    expect(JSON.parse(ok.body)).toEqual({ ok: true });

    const limited = await post(JSON.stringify({ message: 'again' }), from('8.8.8.8'));
    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.body)).toEqual({ error: 'rate_limited', retryAfter: 1 });
    expect(limited.headers['retry-after']).toBe('1');

    expect((await post('{not json', from('1.0.0.1'))).status).toBe(400);
    expect(JSON.parse((await post(JSON.stringify({ message: '   ' }), from('1.0.0.2'))).body)).toEqual({ error: 'invalid' });
    expect((await post(JSON.stringify({ message: 'x'.repeat(2001) }), from('1.0.0.3'))).status).toBe(400);
    const big = await post(JSON.stringify({ message: 'x', pad: 'y'.repeat(9000) }), from('1.0.0.4'));
    expect(big.status).toBe(400);
    expect(JSON.parse(big.body)).toEqual({ error: 'invalid' });

    // 다른 사이트에서 보낸 요청
    const evil = await post(JSON.stringify({ message: 'hi' }), from('1.0.0.5', { origin: 'https://evil.example' }));
    expect(evil.status).toBe(403);
    expect(JSON.parse(evil.body)).toEqual({ error: 'forbidden' });
    expect((await post(JSON.stringify({ message: 'hi' }), from('1.0.0.6', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    // Origin이 없는 프로그램은 받되 제한한다
    expect((await post(JSON.stringify({ message: 'from curl' }), { 'x-forwarded-for': '1.0.0.7' })).status).toBe(201);
    // text/plain(sendBeacon)으로 보내도 받는다
    expect((await post(JSON.stringify({ message: 'beacon' }), from('1.0.0.8', { 'content-type': 'text/plain' }))).status).toBe(201);

    await server?.stop();
    server = null;
    const lines = (await fs.readFile(path.join(dataDir, 'feedback', 'feedback.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.message)).toEqual(['좋아요\n고마워요', 'from curl', 'beacon']);
    expect(lines[0]).toMatchObject({ country: 'US', lang: 'ko', page: '/' });
    const disk = await fs.readFile(path.join(dataDir, 'feedback', 'feedback.jsonl'), 'utf8');
    expect(disk).not.toContain('8.8.8.8');
    const anomalies = JSON.parse(await fs.readFile(path.join(dataDir, 'feedback', 'anomalies.json'), 'utf8')).records;
    const counts = Object.values(anomalies) as Array<Record<string, number>>;
    expect(counts.reduce((a, r) => a + r.invalid, 0)).toBe(4);
    expect(counts.reduce((a, r) => a + r.crossOrigin, 0)).toBe(2);
    expect(counts.reduce((a, r) => a + r.rejected, 0)).toBe(1);
  });

  it('의견함이 꺼져 있으면 404', async () => {
    const off = createErdServer({ port: 0, host: '127.0.0.1', dataDir, log: () => {} });
    const p = (await off.start()).port;
    const res = await fetch(`http://127.0.0.1:${p}/api/feedback`, { method: 'POST', body: JSON.stringify({ message: 'x' }) });
    expect(res.status).toBe(404);
    await off.stop();
  });
});

describe('관리자 화면의 의견함 이스케이프', () => {
  it('의견 글, 페이지, 언어, 나라에 든 HTML을 글자로만 보인다', async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    const day = new Date().toISOString().slice(0, 10);
    const row = { day, u: { visitors: 3, new: 1, 'cc:KR': 2 }, c: {}, peak: 1, sess: { n: 0, avg: 0, med: 0 }, wau: 3, mau: 3 };
    const responses: Record<string, unknown> = {
      '/api/summary': {
        now: new Date().toISOString(),
        live: { users: 1, connections: 1, openRooms: 1, collabRooms: 0, trackedConnections: 1, rooms: 1 },
        today: row,
        yesterday: null,
        active: { wau: 3, mau: 3 },
        totals: { rooms: 0, cli: 0, mcp: 0, sql: 0, aiRooms: 0, relRooms: 0, visitors: 3, appUsers: 0 },
        retention: [{ day, n: 1, d1: 0, d3: 0, d7: 0, d14: 0, d30: 0, ready: [false, false, false], readyMore: [false, false], tracked: true }],
        roomNextDay: [],
        countries: { today: [['KR', 2], [evil, 1]], d7: [['KR', 2]], d30: [['KR', 2]] },
        feedbackTotal: 1,
      },
      '/api/daily': { rows: [row] },
      '/api/anomalies': { rows: [{ ipHash: evil, country: evil, sent: 1, rejected: 1, invalid: 0, burst: 0, hourly: 0, duplicate: 0, long: 0, crossOrigin: 0, first: 0, last: Date.now(), lastHour: 1, level: 'high' }] },
      '/api/feedback': { total: 1, kept: 1, items: [{ id: '1', at: new Date().toISOString(), message: `${evil}\n둘째 줄`, page: evil, lang: evil, country: evil, ipHash: evil, ua: evil, flags: [evil, 'dup'] }] },
    };
    // jsdom에는 타입 선언이 없어 이름만 빌려 쓴다
    const jsdomName = 'jsdom';
    const { JSDOM } = (await import(jsdomName)) as { JSDOM: new (html: string, opts: Record<string, unknown>) => { window: Window & { close(): void } } };
    const dom = new JSDOM(adminPageHtml({ nonce: 'n', csrf: 'c' }), {
      runScripts: 'dangerously',
      url: 'http://localhost:9000/',
      beforeParse(window: Window) {
        (window as unknown as { fetch: unknown }).fetch = (url: string) => {
          const key = url.split('?')[0];
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(responses[key]) });
        };
      },
    });
    const w = dom.window as unknown as { __pwned?: number; document: Document };
    for (let i = 0; i < 50 && !w.document.querySelector('.fb .msg'); i++) await new Promise((r) => setTimeout(r, 10));
    const msg = w.document.querySelector('.fb .msg');
    expect(msg?.textContent).toBe(`${evil}\n둘째 줄`);
    expect(w.document.querySelectorAll('main img, main script')).toHaveLength(0);
    expect(w.__pwned).toBeUndefined();
    expect(w.document.querySelector('#anomalies tr.high')).not.toBeNull();
    expect(w.document.querySelector('#kpis')?.textContent).toContain('DAU');
    expect(w.document.body.innerHTML).not.toContain('·');
    dom.window.close();
  });
});
