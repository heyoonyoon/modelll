/**
 * IP로 나라(ISO 3166-1 alpha-2)를 알아낸다. 오프라인 DB(DB-IP Lite, CC BY 4.0, npm @ip-location-db/dbip-country-mmdb)를 쓴다.
 * 바깥 서비스에 묻지 않고, IP 원문은 어디에도 남기지 않는다. 나라 코드만 돌려준다.
 *
 * DB 파일(IPv4와 IPv6를 합친 약 8 MB)은 처음 물을 때 한 번만 읽어 메모리에 둔다. 읽지 못하면 언제나 '??'다.
 * 출처 표시(DB-IP 링크)는 관리자 페이지 아래에 있다(라이선스 조건).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import path from 'node:path';
import { Reader, type Response } from 'mmdb-lib';
import { isPrivateAddress } from './limits';

export const UNKNOWN_COUNTRY = '??';
const CODE = /^[A-Z]{2}$/;

export type CountryOf = (ip: string) => string;

/** 패키지에 들어 있는 DB 파일의 경로. 패키지가 없으면 null */
export function defaultCountryDbPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return path.join(path.dirname(require.resolve('@ip-location-db/dbip-country-mmdb/package.json')), 'dbip-country.mmdb');
  } catch {
    return null;
  }
}

/** 사설망, 루프백, 링크 로컬처럼 나라가 없는 주소인지 */
function isLocal(ip: string): boolean {
  if (isPrivateAddress(ip)) return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^(0|169\.254|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./.test(v4)) return true;
  return /^(::|fe[89ab][0-9a-f]:)/i.test(ip);
}

/**
 * 나라를 찾는 함수를 만든다. file이 null이면 늘 '??'.
 */
export function createCountryLookup(opts: { file?: string | null; log?: (message: string) => void } = {}): CountryOf {
  const file = opts.file === undefined ? defaultCountryDbPath() : opts.file;
  const log = opts.log ?? (() => {});
  let reader: Reader<Response> | null = null;
  let tried = false;

  function open(): Reader<Response> | null {
    if (tried) return reader;
    tried = true;
    if (!file) {
      log('geo: country database not found, countries will be ??');
      return null;
    }
    try {
      reader = new Reader(readFileSync(file));
    } catch (err) {
      log(`geo: could not read the country database: ${(err as Error).message}`);
      reader = null;
    }
    return reader;
  }

  return (raw: string) => {
    if (typeof raw !== 'string') return UNKNOWN_COUNTRY;
    let ip = raw.trim().replace(/%.*$/, '');
    if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip)) ip = ip.slice(7);
    if (!isIP(ip) || isLocal(ip)) return UNKNOWN_COUNTRY;
    const r = open();
    if (!r) return UNKNOWN_COUNTRY;
    try {
      const code = (r.get(ip) as { country_code?: unknown } | null)?.country_code;
      return typeof code === 'string' && CODE.test(code) ? code : UNKNOWN_COUNTRY;
    } catch {
      return UNKNOWN_COUNTRY;
    }
  };
}

/** 밖에서 받은 나라 코드를 다듬는다. 두 글자 대문자가 아니면 '??' */
export function normalizeCountry(code: unknown): string {
  return typeof code === 'string' && CODE.test(code) ? code : UNKNOWN_COUNTRY;
}
