/**
 * 의견함. 화면의 의견 보내기(POST /api/feedback)로 온 글을 받아 파일에 쌓고, 관리자 페이지가 읽는다.
 *
 * 받는 값은 모두 믿지 않는다.
 * - 형식과 길이를 본다(message 1~2000자, page 200자 이하의 같은 사이트 경로, lang 10자 이하의 [A-Za-z-]).
 * - 줄바꿈과 탭을 뺀 제어 문자, 글 방향을 뒤집는 문자, 폭 없는 공백을 지우고 NFC로 맞춘다.
 * - 평범한 JSON 한 줄로 저장한다(eval도 템플릿도 쓰지 않는다). 관리자 화면은 넣기 전에 모두 이스케이프한다.
 * - 방 주소는 비밀 링크라 page의 방 id는 '/r/:id'로 바꾸고, 쿼리와 # 뒤는 버린다.
 * - IP는 디스크에 남기지 않는다. 지표와 같은 비밀 솔트로 HMAC한 값(ipHash)만 쓴다. 로그에도 글 내용을 쓰지 않는다.
 *
 * 요청 제한(IP 해시마다, 받은 요청 기준): 1초에 1건, 최근 10분 동안 100건. 모든 사람을 합쳐 10분에 1000건.
 * 이상 발송 기록(IP 해시마다, anomalies.json에 남는다): 제한에 걸림, 잘못된 형식, 1분에 5건 이상(폭주),
 * 1시간에 20건 넘김, 최근 글과 똑같은 글, 1500자 이상의 긴 글, 다른 사이트에서 보낸 요청.
 *
 * 파일(DATA_DIR/feedback/)
 *   feedback.jsonl    지금 쓰는 파일. 한 줄에 글 하나. 5000줄이 차면 feedback.1.jsonl로 옮기고 새로 시작한다(합쳐서 1만 건까지)
 *   feedback.1.jsonl  바로 전 파일
 *   anomalies.json    IP 해시별 이상 발송 집계. 30초마다, 그리고 끌 때 쓴다
 */
import { createHmac, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ROOM_ID_PATTERN } from '../shared/types';
import { isBot, loadOrCreateSalt } from './stats';

export const FEEDBACK_PATH = '/api/feedback';
/** 본문 최대 크기(바이트) */
export const MAX_FEEDBACK_BYTES = 8 * 1024;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_PAGE_LENGTH = 200;
export const MAX_LANG_LENGTH = 10;
/** 이 길이 이상이면 긴 글로 센다 */
export const LONG_MESSAGE_LENGTH = 1500;

const MINUTE = 60_000;
const TEN_MINUTES = 10 * MINUTE;
const HOUR = 60 * MINUTE;

export interface FeedbackInput {
  message: string;
  page: string | null;
  lang: string | null;
}

export interface FeedbackEntry {
  id: string;
  /** ISO 시각 */
  at: string;
  message: string;
  page: string | null;
  lang: string | null;
  country: string;
  /** 솔트를 넣은 IP 해시(16자) */
  ipHash: string;
  /** 브라우저와 OS 이름만(예: 'Chrome / macOS') */
  ua: string;
  /** 받을 때 붙인 표시: dup(최근 글과 같음), long(긴 글), burst(1분에 5건 이상) */
  flags?: string[];
}

export interface AnomalyCounts {
  /** 받은 글 */
  sent: number;
  /** 요청 제한에 걸림 */
  rejected: number;
  /** 형식이 틀림 */
  invalid: number;
  /** 1분 안에 5건째 이상 */
  burst: number;
  /** 1시간 안에 20건을 넘김 */
  hourly: number;
  /** 최근 글과 똑같은 글 */
  duplicate: number;
  /** 긴 글 */
  long: number;
  /** 다른 사이트에서 보낸 요청 */
  crossOrigin: number;
}

export interface AnomalyRecord extends AnomalyCounts {
  country: string;
  /** 처음, 마지막으로 본 시각(ms) */
  first: number;
  last: number;
}

export interface AnomalyRow extends AnomalyRecord {
  ipHash: string;
  /** 최근 1시간 동안 받은 글(메모리 기준, 다시 켜면 0부터) */
  lastHour: number;
  /** high: 제한, 다른 사이트, 1시간 20건 넘김 / medium: 그 밖의 이상 */
  level: 'high' | 'medium';
}

const ZERO_COUNTS: AnomalyCounts = { sent: 0, rejected: 0, invalid: 0, burst: 0, hourly: 0, duplicate: 0, long: 0, crossOrigin: 0 };

// ───────────────────────── 입력 다듬기 ─────────────────────────

/**
 * 지우는 글자: 줄바꿈(\n)과 탭을 뺀 C0, C1 제어 문자, 폭 없는 공백(ZWJ, ZWNJ는 이모지와 몇몇 문자에 필요해 남긴다),
 * 글 방향 표시와 덮어쓰기(관리자 화면을 속이는 데 쓰인다), BOM, 대체 문자 표시
 */
// eslint-disable-next-line no-control-regex
const STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB]/g;

/** 글을 다듬는다. 문자열이 아니거나 다듬은 뒤 비었거나 2000자를 넘으면 null */
export function normalizeMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // 본문이 8 KB를 넘지 못하므로 길이는 이미 작다. 짝이 없는 서로게이트는 U+FFFD로
  let s = raw.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD').normalize('NFC');
  s = s.replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n').replace(STRIP, '');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (s.length === 0 || s.length > MAX_MESSAGE_LENGTH) return null;
  return s;
}

/** 같은 사이트의 경로만 받는다. 방 id는 가리고 쿼리와 # 뒤는 버린다. 아니면 null */
export function sanitizePage(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PAGE_LENGTH) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\s\u0000-\u001F\u007F]/.test(raw)) return null;
  let pathname: string;
  try {
    const url = new URL(raw, 'https://same.invalid');
    if (url.origin !== 'https://same.invalid') return null;
    pathname = url.pathname;
  } catch {
    return null;
  }
  const room = /^\/r\/([^/]+)\/?$/.exec(pathname);
  if (room) return ROOM_ID_PATTERN.test(room[1]) ? '/r/:id' : null;
  return /^[A-Za-z0-9/_.\-~%]{1,200}$/.test(pathname) ? pathname : null;
}

export function sanitizeLang(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LANG_LENGTH) return null;
  return /^[A-Za-z]{1,8}(-[A-Za-z]{1,8})*$/.test(raw) ? raw : null;
}

/** 본문(이미 JSON으로 읽은 값)을 확인한다. message가 틀리면 null, page와 lang은 틀리면 버린다 */
export function validateFeedback(body: unknown): FeedbackInput | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const message = normalizeMessage(b.message);
  if (message === null) return null;
  return { message, page: sanitizePage(b.page), lang: sanitizeLang(b.lang) };
}

/** User-Agent에서 브라우저와 OS 이름만 뽑는다(버전과 기기 이름은 남기지 않는다) */
export function uaSummary(ua: string | undefined): string {
  if (!ua) return 'unknown';
  if (isBot(ua)) return 'bot';
  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /Whale\//.test(ua) ? 'Whale'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Other';
  const os =
    /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Other';
  return `${browser} / ${os}`;
}

// ───────────────────────── 요청 제한 ─────────────────────────

interface Sender {
  /** 최근 10분 동안 받은 요청 시각(오래된 것부터) */
  times: number[];
  /** 10분 단위 칸 번호 → 받은 글 수(최근 1시간 집계용, 6칸까지) */
  buckets: Map<number, number>;
}

export interface FeedbackLimits {
  perSecond: number;
  per10Min: number;
  /** 모든 사람을 합친 10분 한도 */
  globalPer10Min: number;
  /** 메모리에 둘 IP 수. 넘으면 가장 오래 안 온 IP부터 잊는다 */
  maxSenders: number;
}

export const DEFAULT_FEEDBACK_LIMITS: FeedbackLimits = { perSecond: 1, per10Min: 100, globalPer10Min: 1000, maxSenders: 5000 };

/** 1초 1건, 10분 100건(구간이 미끄러진다). 키는 IP 해시 */
export class FeedbackRateLimiter {
  private readonly senders = new Map<string, Sender>();
  private global: number[] = [];

  constructor(private readonly limits: FeedbackLimits = DEFAULT_FEEDBACK_LIMITS) {}

  /** 요청 하나를 센다. 받아도 되면 0, 아니면 다시 보낼 수 있을 때까지 남은 초(1 이상). 걸린 요청은 세지 않는다 */
  take(key: string, now: number): number {
    const s = this.sender(key, now);
    const last = s.times[s.times.length - 1];
    if (last !== undefined && now - last < 1000 / this.limits.perSecond) return Math.max(1, Math.ceil((last + 1000 / this.limits.perSecond - now) / 1000));
    if (s.times.length >= this.limits.per10Min) return Math.max(1, Math.ceil((s.times[s.times.length - this.limits.per10Min] + TEN_MINUTES - now) / 1000));
    while (this.global.length > 0 && this.global[0] <= now - TEN_MINUTES) this.global.shift();
    if (this.global.length >= this.limits.globalPer10Min) return Math.max(1, Math.ceil((this.global[0] + TEN_MINUTES - now) / 1000));
    this.global.push(now);
    s.times.push(now);
    const slot = Math.floor(now / TEN_MINUTES);
    s.buckets.set(slot, (s.buckets.get(slot) ?? 0) + 1);
    return 0;
  }

  /** 최근 1분 동안 받은 수 */
  lastMinute(key: string, now: number): number {
    const s = this.senders.get(key);
    if (!s) return 0;
    let n = 0;
    for (let i = s.times.length - 1; i >= 0 && s.times[i] > now - MINUTE; i--) n += 1;
    return n;
  }

  /** 최근 1시간(10분 칸 6개) 동안 받은 수 */
  lastHour(key: string, now: number): number {
    const s = this.senders.get(key);
    if (!s) return 0;
    const slot = Math.floor(now / TEN_MINUTES);
    let n = 0;
    for (const [k, v] of s.buckets) if (k > slot - 6) n += v;
    return n;
  }

  get size(): number {
    return this.senders.size;
  }

  private sender(key: string, now: number): Sender {
    let s = this.senders.get(key);
    if (s) {
      // 최근에 온 순서를 지키려고 맨 뒤로 옮긴다
      this.senders.delete(key);
    } else {
      s = { times: [], buckets: new Map() };
      while (this.senders.size >= this.limits.maxSenders) this.senders.delete(this.senders.keys().next().value as string);
    }
    this.senders.set(key, s);
    while (s.times.length > 0 && s.times[0] <= now - TEN_MINUTES) s.times.shift();
    const slot = Math.floor(now / TEN_MINUTES);
    for (const k of s.buckets.keys()) if (k <= slot - 6) s.buckets.delete(k);
    return s;
  }
}

// ───────────────────────── 저장 ─────────────────────────

export interface FeedbackStoreOptions {
  /** DATA_DIR/feedback */
  dir: string;
  /** 해시 솔트. 없으면 saltDir/salt 를 읽는다(지표와 같은 파일) */
  salt?: string;
  saltDir: string;
  now?: () => number;
  log?: (message: string) => void;
  limits?: Partial<FeedbackLimits>;
  /** 한 파일에 쓸 줄 수. 기본 5000(두 파일 합쳐 1만 건) */
  maxPerFile?: number;
  /** 메모리에 들고 있는 최근 글 수(관리자 화면). 기본 1000 */
  keepInMemory?: number;
  /** IP 해시별 이상 기록 수. 기본 5000 */
  maxAnomalies?: number;
  flushIntervalMs?: number;
}

export type SubmitResult =
  | { status: 201; body: { ok: true } }
  | { status: 400; body: { error: 'invalid' } }
  | { status: 403; body: { error: 'forbidden' } }
  | { status: 429; body: { error: 'rate_limited'; retryAfter: number } };

export class FeedbackStore {
  readonly dir: string;
  private readonly saltDir: string;
  private salt: string;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly limiter: FeedbackRateLimiter;
  private readonly maxPerFile: number;
  private readonly keep: number;
  private readonly maxAnomalies: number;
  private readonly flushIntervalMs: number;

  private recent: FeedbackEntry[] = [];
  private prevLines = 0;
  private currentLines = 0;
  /** 아직 파일에 쓰지 않은 글 수 */
  private pending = 0;
  private readonly records = new Map<string, AnomalyRecord>();
  private readonly hashes = new Map<string, string>();
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;

  constructor(opts: FeedbackStoreOptions) {
    this.dir = path.resolve(opts.dir);
    this.saltDir = path.resolve(opts.saltDir);
    this.salt = opts.salt ?? '';
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.limiter = new FeedbackRateLimiter({ ...DEFAULT_FEEDBACK_LIMITS, ...opts.limits });
    this.maxPerFile = opts.maxPerFile ?? 5000;
    this.keep = opts.keepInMemory ?? 1000;
    this.maxAnomalies = opts.maxAnomalies ?? 5000;
    this.flushIntervalMs = opts.flushIntervalMs ?? 30_000;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    if (!this.salt) this.salt = await loadOrCreateSalt(this.saltDir, this.log);
    const prev = await this.readLines('feedback.1.jsonl');
    const cur = await this.readLines('feedback.jsonl');
    this.currentLines = cur.length;
    this.prevLines = prev.length;
    const tail = [...prev, ...cur].slice(-this.keep);
    for (const line of tail) {
      try {
        const e = JSON.parse(line) as FeedbackEntry;
        if (e && typeof e.id === 'string' && typeof e.message === 'string') this.recent.push(e);
      } catch {
        // 깨진 줄은 건너뛴다
      }
    }
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.dir, 'anomalies.json'), 'utf8')) as { records?: Record<string, AnomalyRecord> };
      if (raw && typeof raw.records === 'object' && raw.records) {
        for (const [k, v] of Object.entries(raw.records)) {
          if (!/^[A-Za-z0-9_-]{16}$/.test(k) || !v || typeof v !== 'object') continue;
          const rec: AnomalyRecord = { ...ZERO_COUNTS, country: /^([A-Z]{2}|\?\?)$/.test(String(v.country)) ? v.country : '??', first: Number(v.first) || 0, last: Number(v.last) || 0 };
          for (const key of Object.keys(ZERO_COUNTS) as Array<keyof AnomalyCounts>) rec[key] = Number(v[key]) || 0;
          this.records.set(k, rec);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log('feedback: anomalies.json was unreadable, starting fresh');
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  hashIp(ip: string): string {
    let h = this.hashes.get(ip);
    if (!h) {
      if (this.hashes.size >= 20_000) this.hashes.clear();
      h = createHmac('sha256', this.salt).update(`ip:${ip}`).digest('base64url').slice(0, 16);
      this.hashes.set(ip, h);
    }
    return h;
  }

  // ───────────── 요청 처리 단계(http.ts가 차례로 부른다) ─────────────

  /** 다른 사이트에서 온 요청 */
  rejectCrossOrigin(ipHash: string, country: string): SubmitResult {
    this.bump(ipHash, country, 'crossOrigin');
    return { status: 403, body: { error: 'forbidden' } };
  }

  /** 요청 제한. 받아도 되면 null */
  checkRate(ipHash: string, country: string): SubmitResult | null {
    const wait = this.limiter.take(ipHash, this.now());
    if (wait === 0) return null;
    const first = this.bump(ipHash, country, 'rejected') === 1;
    if (first) this.log(`feedback rate limited ip=${ipHash.slice(0, 8)}`);
    return { status: 429, body: { error: 'rate_limited', retryAfter: wait } };
  }

  invalid(ipHash: string, country: string): SubmitResult {
    this.bump(ipHash, country, 'invalid');
    return { status: 400, body: { error: 'invalid' } };
  }

  /** 본문을 확인하고 저장한다 */
  submit(ipHash: string, country: string, body: unknown, ua: string | undefined): SubmitResult {
    const input = validateFeedback(body);
    if (!input) return this.invalid(ipHash, country);
    this.add(ipHash, country, input, ua);
    return { status: 201, body: { ok: true } };
  }

  add(ipHash: string, country: string, input: FeedbackInput, ua: string | undefined): FeedbackEntry {
    const now = this.now();
    const flags: string[] = [];
    this.bump(ipHash, country, 'sent');
    if (this.limiter.lastMinute(ipHash, now) >= 5) {
      flags.push('burst');
      this.bump(ipHash, country, 'burst');
    }
    if (this.limiter.lastHour(ipHash, now) > 20) this.bump(ipHash, country, 'hourly');
    const from = Math.max(0, this.recent.length - 200);
    for (let i = this.recent.length - 1; i >= from; i--) {
      if (this.recent[i].message === input.message) {
        flags.push('dup');
        this.bump(ipHash, country, 'duplicate');
        break;
      }
    }
    if (input.message.length >= LONG_MESSAGE_LENGTH) {
      flags.push('long');
      this.bump(ipHash, country, 'long');
    }
    const entry: FeedbackEntry = {
      id: `${now.toString(36)}${randomBytes(4).toString('hex')}`,
      at: new Date(now).toISOString(),
      message: input.message,
      page: input.page,
      lang: input.lang,
      country,
      ipHash,
      ua: uaSummary(ua),
      ...(flags.length ? { flags } : {}),
    };
    this.recent.push(entry);
    if (this.recent.length > this.keep) this.recent.splice(0, this.recent.length - this.keep);
    this.pending += 1;
    this.append(entry);
    return entry;
  }

  // ───────────── 읽기(관리자) ─────────────

  /** 최근 글(새것부터) */
  list(offset = 0, limit = 200): { total: number; kept: number; items: FeedbackEntry[] } {
    const items: FeedbackEntry[] = [];
    for (let i = this.recent.length - 1 - offset; i >= 0 && items.length < limit; i--) items.push(this.recent[i]);
    return { total: this.prevLines + this.currentLines + this.pending, kept: this.recent.length, items };
  }

  /** 이상한 점이 하나라도 있는 IP 해시(최근에 본 것부터) */
  anomalies(limit = 200): AnomalyRow[] {
    const now = this.now();
    const rows: AnomalyRow[] = [];
    for (const [ipHash, r] of this.records) {
      if (r.rejected + r.invalid + r.burst + r.hourly + r.duplicate + r.long + r.crossOrigin === 0) continue;
      const level = r.rejected > 0 || r.crossOrigin > 0 || r.hourly > 0 ? 'high' : 'medium';
      rows.push({ ipHash, ...r, lastHour: this.limiter.lastHour(ipHash, now), level });
    }
    rows.sort((a, b) => b.last - a.last);
    return rows.slice(0, limit);
  }

  // ───────────── 안쪽 ─────────────

  private bump(ipHash: string, country: string, key: keyof AnomalyCounts): number {
    const now = this.now();
    let r = this.records.get(ipHash);
    if (r) {
      this.records.delete(ipHash);
    } else {
      r = { ...ZERO_COUNTS, country, first: now, last: now };
      while (this.records.size >= this.maxAnomalies) this.records.delete(this.records.keys().next().value as string);
    }
    this.records.set(ipHash, r);
    r[key] += 1;
    r.last = now;
    if (country !== '??') r.country = country;
    this.dirty = true;
    return r[key];
  }

  private append(entry: FeedbackEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    this.writing = this.writing.then(async () => {
      try {
        const file = path.join(this.dir, 'feedback.jsonl');
        if (this.currentLines >= this.maxPerFile) {
          await fs.rename(file, path.join(this.dir, 'feedback.1.jsonl'));
          this.prevLines = this.currentLines;
          this.currentLines = 0;
        }
        await fs.appendFile(file, line, { mode: 0o600 });
        this.currentLines += 1;
      } catch (err) {
        this.log(`feedback: write failed: ${(err as Error).message}`);
      } finally {
        this.pending -= 1;
      }
    });
  }

  flush(): Promise<void> {
    this.writing = this.writing.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      const file = path.join(this.dir, 'anomalies.json');
      const tmp = `${file}.${process.pid}.${++this.seq}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify({ v: 1, records: Object.fromEntries(this.records) }), { mode: 0o600 });
        await fs.rename(tmp, file);
      } catch (err) {
        this.dirty = true;
        await fs.rm(tmp, { force: true }).catch(() => {});
        this.log(`feedback: write failed: ${(err as Error).message}`);
      }
    });
    return this.writing;
  }

  /** 끝까지 쓰기를 기다린다(테스트용) */
  settled(): Promise<void> {
    return this.writing;
  }

  private async readLines(name: string): Promise<string[]> {
    try {
      return (await fs.readFile(path.join(this.dir, name), 'utf8')).split('\n').filter((l) => l.trim());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
}
