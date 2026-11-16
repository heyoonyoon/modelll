/**
 * 관리자 페이지의 HTML. 의존성 없이 서버가 그대로 내보내고, 화면은 /api/summary, /api/daily, /api/feedback, /api/anomalies 를 받아
 * 인라인 SVG와 표로 그린다(외부 라이브러리, CDN 없음).
 * 스크립트와 스타일은 응답마다 받은 nonce로만 실행된다(CSP). style 속성은 쓰지 않는다(CSP가 막는다). 색은 클래스와 SVG 속성으로만 준다.
 * 화면에 넣는 값은 모두 esc()를 거친다. 의견 글처럼 밖에서 온 값은 특히 그렇다(줄바꿈은 CSS white-space로 살린다).
 */

/** HTML 본문과 속성에 넣을 문자열을 이스케이프한다 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c] as string);
}

/** 계열 색(고정 순서). 같은 대상은 늘 같은 색이다 */
const SERIES = {
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
  yellow: '#eda100',
  magenta: '#e87ba4',
  green: '#008300',
  violet: '#6250d6',
  red: '#e34948',
  sky: '#86b6ef',
  lilac: '#a99ef0',
  mint: '#8fd9bd',
  gray: '#a3a3a3',
};

/** 히트맵 단계(파랑 한 색, 옅은 것부터) */
const HEAT = ['#f5f8fd', '#e1ecfb', '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#256abf'];

const STYLE = `
:root { --bg: #fafafa; --panel: #fff; --border: #eaeaea; --border-strong: #d4d4d4; --text: #171717; --dim: #666; --faint: #8f8f8f; --accent: #2a78d6; --soft: #eef4fd;
  --up: #16794a; --down: #c2342f; --warn-bg: #fff7e6; --warn-line: #f5d38a; --bad-bg: #fdf0ef; --bad-line: #f1b5b2;
  --font: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font); font-size: 13px; line-height: 1.5; color: var(--text); background: var(--bg); -webkit-font-smoothing: antialiased; word-break: keep-all; }
h1, h2, h3, p { margin: 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.top { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 24px; background: rgba(255,255,255,.9); backdrop-filter: saturate(180%) blur(8px); border-bottom: 1px solid var(--border); }
.top h1 { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; }
.top .badge { font-size: 11px; color: var(--dim); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; }
.top .grow { flex: 1; }
.top .updated { color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums; }
.top nav { display: flex; gap: 2px; margin-left: 8px; }
.top nav a { color: var(--dim); font-size: 12.5px; padding: 4px 8px; border-radius: 6px; }
.top nav a:hover { background: #f2f2f2; color: var(--text); text-decoration: none; }
.btn { height: 30px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 6px; background: #fff; cursor: pointer; font: inherit; color: var(--text); }
.btn:hover { background: #f5f5f5; }
.btn-primary { background: #171717; border-color: #171717; color: #fff; }
.btn-primary:hover { background: #333; }
main { max-width: 1280px; margin: 0 auto; padding: 20px 24px 64px; }
section { margin-top: 32px; scroll-margin-top: 64px; }
section:first-of-type { margin-top: 8px; }
.sec-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-bottom: 12px; }
.sec-head h2 { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; }
.sec-head p { color: var(--faint); font-size: 12px; }
.sec-head .grow { flex: 1; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: 10px; background: var(--panel); overflow: hidden; }
.kpi { padding: 16px 18px 14px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); min-width: 0; }
.kpi:nth-child(4n) { border-right: 0; }
.kpi:nth-last-child(-n+4) { border-bottom: 0; }
.kpi .label { font-size: 12px; color: var(--dim); font-weight: 500; display: flex; align-items: center; gap: 6px; }
.kpi .value { font-size: 28px; font-weight: 650; letter-spacing: -0.03em; margin-top: 4px; font-variant-numeric: tabular-nums; line-height: 1.15; }
.kpi .value small { font-size: 14px; font-weight: 500; color: var(--faint); margin-left: 2px; }
.kpi .delta { margin-top: 6px; font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kpi .delta b { font-weight: 600; }
.kpi .delta .up { color: var(--up); }
.kpi .delta .down { color: var(--down); }
.kpi .delta .flat { color: var(--dim); }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.card .label { font-size: 12px; color: var(--dim); font-weight: 500; }
.card .value { font-size: 22px; font-weight: 650; letter-spacing: -0.02em; margin-top: 2px; font-variant-numeric: tabular-nums; }
.card .value small { font-size: 12.5px; font-weight: 500; color: var(--faint); margin-left: 4px; }
.card .desc { font-size: 11.5px; color: var(--faint); margin-top: 4px; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #1baf7a; box-shadow: 0 0 0 3px rgba(27,175,122,.15); }
.segmented { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 7px; overflow: hidden; background: #fff; }
.segmented button { height: 28px; min-width: 44px; padding: 0 10px; border: 0; border-right: 1px solid var(--border); background: transparent; cursor: pointer; font: inherit; font-size: 12.5px; color: var(--dim); }
.segmented button:last-child { border-right: 0; }
.segmented button.on { background: #171717; color: #fff; }
.charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.charts.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.chart { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px 10px; min-width: 0; }
.chart.wide { grid-column: 1 / -1; }
.chart .head { display: flex; align-items: baseline; gap: 8px; }
.chart h3 { font-size: 13px; font-weight: 600; }
.chart .total { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; margin-left: auto; white-space: nowrap; }
.chart .desc { font-size: 12px; color: var(--faint); margin: 2px 0 8px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--dim); margin-bottom: 4px; }
.legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: 0; }
.legend i.dash { width: 12px; height: 0; border-radius: 0; border-top: 2px dashed #a3a3a3; vertical-align: 2px; }
.chart svg { display: block; width: 100%; height: auto; }
.hit { cursor: default; }
.hit:hover { fill: rgba(23, 23, 23, 0.04); }
#tip { position: fixed; z-index: 10; pointer-events: none; display: none; white-space: pre-line; background: #171717; color: #fff; font-size: 12px; line-height: 1.55; padding: 7px 10px; border-radius: 7px; box-shadow: 0 6px 20px rgba(0,0,0,0.18); font-variant-numeric: tabular-nums; max-width: 320px; }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.box { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.box h3 { font-size: 13px; font-weight: 600; }
.box .desc { font-size: 12px; color: var(--faint); margin: 2px 0 10px; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
th { font-size: 11.5px; color: var(--faint); font-weight: 500; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; white-space: nowrap; }
td.bar { width: 40%; min-width: 90px; }
td.bar svg { display: block; width: 100%; height: 8px; }
td .sub, .sub { color: var(--faint); font-size: 11.5px; }
tr.pending td { color: var(--faint); }
.empty { color: var(--faint); padding: 10px 0; }
.heat { border-collapse: separate; border-spacing: 3px; }
.heat th, .heat td { border: 0; padding: 0; }
.heat th { padding: 0 6px 4px; text-align: center; }
.heat th:first-child, .heat td.day { text-align: left; padding-right: 10px; white-space: nowrap; }
.heat td.n { text-align: right; padding-right: 10px; color: var(--dim); white-space: nowrap; }
.heat td.c { height: 30px; min-width: 64px; text-align: center; border-radius: 5px; font-size: 12px; color: var(--text); }
.heat td.c.dark { color: #fff; }
.heat td.c.na { background: repeating-linear-gradient(135deg, #fafafa 0 4px, #f1f1f1 4px 8px); color: var(--faint); }
.heat td.c.pend { outline: 1px dashed #b5b5b5; outline-offset: -2px; }
.heat tr.avg td { font-weight: 600; }
.heat tr.avg td.day { color: var(--text); }
.flag { font-size: 15px; line-height: 1; margin-right: 6px; vertical-align: -1px; }
.cc { font-family: var(--mono); font-size: 11px; color: var(--faint); margin-left: 6px; }
.inbox { display: flex; flex-direction: column; }
.fb { padding: 12px 2px; border-bottom: 1px solid #f0f0f0; }
.fb:last-child { border-bottom: 0; }
.fb .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 12px; color: var(--faint); margin-bottom: 6px; font-variant-numeric: tabular-nums; }
.fb .meta .time { color: var(--dim); font-weight: 500; }
.fb .meta code, .an code { font-family: var(--mono); font-size: 11.5px; color: var(--dim); background: #f5f5f5; border-radius: 4px; padding: 0 5px; }
.fb .msg { max-height: 14em; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; font-size: 13px; line-height: 1.6; color: var(--text); }
.tag { display: inline-block; font-size: 11px; line-height: 18px; padding: 0 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--dim); }
.tag.new { background: #e8efff; border-color: #c7d6ff; color: #2f6bff; }
.live-list code { font-size: 12px; color: var(--dim); }
.tag.warn { background: var(--warn-bg); border-color: var(--warn-line); color: #8a5a00; }
.tag.bad { background: var(--bad-bg); border-color: var(--bad-line); color: #9b2420; }
.more { margin-top: 10px; display: flex; align-items: center; gap: 10px; color: var(--faint); font-size: 12px; }
.an tr.high td { background: var(--bad-bg); }
.an tr.medium td { background: var(--warn-bg); }
.an td.z { color: #c8c8c8; }
.funnel-row { display: grid; grid-template-columns: 180px 1fr 120px; align-items: center; gap: 12px; padding: 5px 0; }
.funnel-row .name { font-size: 12.5px; }
.funnel-row .name .sub { display: block; font-size: 11px; }
.funnel-row svg { display: block; width: 100%; height: 20px; }
.funnel-row .num { text-align: right; font-variant-numeric: tabular-nums; }
.funnel-row .num .sub { display: block; font-size: 11px; }
footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--faint); font-size: 12px; display: flex; flex-wrap: wrap; gap: 6px 20px; }
.err { color: var(--down); margin-bottom: 8px; }
.err:empty { display: none; }
@media (max-width: 1100px) { .charts.three { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 900px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .kpi:nth-child(4n) { border-right: 1px solid var(--border); } .kpi:nth-child(2n) { border-right: 0; } .kpi:nth-last-child(-n+4) { border-bottom: 1px solid var(--border); } .kpi:nth-last-child(-n+2) { border-bottom: 0; } .charts, .charts.three, .grid2 { grid-template-columns: 1fr; } .top nav { display: none; } }
@media (max-width: 640px) { main { padding: 12px 16px 48px; } .top { padding: 0 16px; } .funnel-row { grid-template-columns: 110px 1fr 84px; } }
`;

/** 로그인 화면 */
export function loginPageHtml(opts: { nonce: string; csrf: string; message: string | null; disabled: boolean }): string {
  const nonce = escapeHtml(opts.nonce);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>modelll 관리자 로그인</title>
<style nonce="${nonce}">${STYLE}
.login { max-width: 360px; margin: 14vh auto 0; padding: 0 16px; }
.login .box { padding: 22px; }
.login h1 { font-size: 17px; margin-bottom: 4px; }
.login p { color: var(--dim); margin-bottom: 16px; }
.login label { display: block; font-size: 12px; font-weight: 600; color: var(--dim); margin-bottom: 4px; }
.login input[type=password] { width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: 6px; font: inherit; }
.login input[type=password]:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--soft); }
.login .btn { width: 100%; height: 36px; margin-top: 12px; }
.login .msg { margin: -4px 0 12px; color: var(--down); font-size: 12.5px; }
</style></head>
<body><div class="login"><div class="box">
<h1>modelll 관리자</h1>
<p>서비스 지표를 보려면 비밀번호를 입력합니다.</p>
${opts.message ? `<p class="msg" role="alert">${escapeHtml(opts.message)}</p>` : ''}
${opts.disabled ? '<p class="msg" role="alert">서버에 ADMIN_PASSWORD_HASH가 없어 로그인할 수 없습니다.</p>' : ''}
<form method="post" action="/login" autocomplete="off">
<input type="hidden" name="csrf" value="${escapeHtml(opts.csrf)}">
<label for="pw">비밀번호</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus maxlength="1024">
<button class="btn btn-primary" type="submit">로그인</button>
</form></div></div></body></html>`;
}

/** 화면을 그리는 스크립트. 문자열 이어 붙이기만 쓰고, 넣는 값은 모두 esc()를 거친다 */
const SCRIPT = String.raw`
'use strict';
var $ = function (id) { return document.getElementById(id); };
function esc(v) { return String(v).replace(/[&<>"'\x60]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\x60': '&#96;' }[c]; }); }
function fmt(n) { return (Number(n) || 0).toLocaleString('ko-KR'); }
function pctNum(a, b) { return b > 0 ? a / b * 100 : null; }
function pct(a, b) { var p = pctNum(a, b); return p === null ? '–' : (Math.round(p * 10) / 10) + '%'; }
function dur(sec) { sec = Math.round(Number(sec) || 0); if (sec < 60) return sec + '초'; var m = Math.floor(sec / 60); if (m < 60) return m + '분 ' + (sec % 60) + '초'; return Math.floor(m / 60) + '시간 ' + (m % 60) + '분'; }
function U(row, k) { return (row && row.u && row.u[k]) || 0; }
function C(row, k) { return (row && row.c && row.c[k]) || 0; }
function prefixed(obj, prefix) { var out = []; for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && k.indexOf(prefix) === 0) out.push([k.slice(prefix.length), obj[k]]); return out; }
function sumRows(rows, part, prefix) { var acc = {}; rows.forEach(function (r) { prefixed(r[part] || {}, prefix).forEach(function (e) { acc[e[0]] = (acc[e[0]] || 0) + e[1]; }); }); return Object.keys(acc).map(function (k) { return [k, acc[k]]; }).sort(function (a, b) { return b[1] - a[1]; }); }
function total(rows, f) { var s = 0; rows.forEach(function (r) { s += f(r); }); return s; }
function cliOf(r) { var s = 0; prefixed((r && r.c) || {}, 'cli:').forEach(function (e) { s += e[1]; }); return s; }
function mcpOf(r) { var s = 0; prefixed((r && r.c) || {}, 'mcp:').forEach(function (e) { s += e[1]; }); return s; }

var COLORS = __SERIES__;
var HEAT = __HEAT__;

// ───────── 나라 이름과 국기 ─────────
var regionNames = null;
try { regionNames = new Intl.DisplayNames(['ko'], { type: 'region' }); } catch (e) { regionNames = null; }
function countryName(cc) {
  if (!/^[A-Z]{2}$/.test(cc)) return '알 수 없음';
  try { return (regionNames && regionNames.of(cc)) || cc; } catch (e) { return cc; }
}
function flag(cc) {
  if (!/^[A-Z]{2}$/.test(cc)) return '🏳️';
  return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65);
}
function countryLabel(cc) { return '<span class="flag">' + flag(cc) + '</span>' + esc(countryName(cc)) + '<span class="cc">' + esc(/^[A-Z]{2}$/.test(cc) ? cc : '??') + '</span>'; }

// ───────── 시각(Asia/Seoul) ─────────
var seoulFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
function seoul(ms) { var d = new Date(ms); return isNaN(d.getTime()) ? '' : seoulFmt.format(d); }

// ───────── 그래프 ─────────
function niceTop(max) { if (max <= 4) return 4; var raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); var steps = [1, 2, 2.5, 5, 10]; for (var i = 0; i < steps.length; i++) { var t = steps[i] * p; if (t >= raw && Number.isInteger(t)) return t * 4; } return Math.ceil(raw) * 4; }
function axis(W, H, L, R, T, B, top) {
  var out = '';
  for (var g = 0; g <= 4; g++) {
    var y = T + (H - T - B) * (1 - g / 4);
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="' + (g === 0 ? '#e5e5e5' : '#f2f2f2') + '"/>';
    out += '<text x="' + (L - 6) + '" y="' + (y + 3.5) + '" font-size="10" fill="#8f8f8f" text-anchor="end">' + esc(fmt(top * g / 4)) + '</text>';
  }
  return out;
}
function xTicks(rows, W, H, L, cw) {
  var n = rows.length, out = '';
  var ticks = n <= 1 ? [0] : n <= 10 ? rows.map(function (_, i) { return i; }) : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(3 * (n - 1) / 4), n - 1];
  ticks.forEach(function (i) { out += '<text x="' + (L + cw * i + cw / 2).toFixed(1) + '" y="' + (H - 5) + '" font-size="10" fill="#8f8f8f" text-anchor="middle">' + esc(rows[i].day.slice(5)) + '</text>'; });
  return out;
}

/** 막대그래프(여러 계열이면 쌓는다). 막대마다 그날 값을 말풍선(data-tip)으로 */
function bars(rows, series) {
  var W = 600, H = 170, L = 36, R = 6, T = 10, B = 20;
  var n = rows.length, max = 0;
  rows.forEach(function (r) { var s = 0; series.forEach(function (se) { s += se.get(r); }); if (s > max) max = s; });
  var top = niceTop(max);
  var cw = (W - L - R) / Math.max(1, n), bw = Math.max(1, Math.min(16, cw * 0.66));
  var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">' + axis(W, H, L, R, T, B, top);
  rows.forEach(function (r, i) {
    var x = L + cw * i + (cw - bw) / 2, base = H - B, tip = [], sum = 0;
    series.forEach(function (se, si) {
      var v = se.get(r); sum += v; tip.push(se.label + ' ' + fmt(v));
      if (v <= 0) return;
      var h = (H - T - B) * v / top;
      // 쌓인 칸 사이에 1px 틈
      var gap = si > 0 && base < H - B ? 1 : 0;
      base -= h;
      out += '<rect x="' + x.toFixed(1) + '" y="' + base.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0.5, h - gap).toFixed(1) + '" rx="2" fill="' + se.color + '"/>';
    });
    if (series.length > 1) tip.push('합계 ' + fmt(sum));
    out += '<rect x="' + (L + cw * i).toFixed(1) + '" y="' + T + '" width="' + cw.toFixed(1) + '" height="' + (H - T - B) + '" fill="transparent" class="hit" data-tip="' + esc(r.day + '\n' + tip.join('\n')) + '"></rect>';
  });
  return out + xTicks(rows, W, H, L, cw) + '</svg>';
}

/** 선 그래프(한 계열). 점마다 값을 말풍선으로 */
function line(rows, se, wide) {
  var W = wide ? 1200 : 600, H = wide ? 200 : 170, L = 36, R = 6, T = 10, B = 20;
  var n = rows.length, max = 0;
  rows.forEach(function (r) { var v = se.get(r); if (v > max) max = v; });
  var top = niceTop(max);
  var cw = (W - L - R) / Math.max(1, n);
  var pts = rows.map(function (r, i) { return [L + cw * i + cw / 2, T + (H - T - B) * (1 - se.get(r) / top)]; });
  var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">' + axis(W, H, L, R, T, B, top);
  if (pts.length) {
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    out += '<path d="' + d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - B) + ' L' + pts[0][0].toFixed(1) + ' ' + (H - B) + ' Z" fill="' + se.color + '" fill-opacity="0.08"/>';
    out += '<path d="' + d + '" fill="none" stroke="' + se.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    if (n <= 45) pts.forEach(function (p) { out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.2" fill="#fff" stroke="' + se.color + '" stroke-width="1.5"/>'; });
    var last = pts[pts.length - 1];
    out += '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="4" fill="' + se.color + '" stroke="#fff" stroke-width="2"/>';
  }
  rows.forEach(function (r, i) {
    var extra = se.tip ? se.tip(r) : '';
    out += '<rect x="' + (L + cw * i).toFixed(1) + '" y="' + T + '" width="' + cw.toFixed(1) + '" height="' + (H - T - B) + '" fill="transparent" class="hit" data-tip="' + esc(r.day + '\n' + se.label + ' ' + fmt(se.get(r)) + (extra ? '\n' + extra : '')) + '"></rect>';
  });
  return out + xTicks(rows, W, H, L, cw) + '</svg>';
}

/** 시간대별(0~23시) 막대. 오늘은 막대, 비교 날(어제)은 회색 점선으로 겹친다. 아직 오지 않은 시각은 비운다 */
function hourChart(title, desc, cur, prev, get, cls, nowHour) {
  var color = COLORS[cls];
  var W = 600, H = 170, L = 36, R = 6, T = 10, B = 20, n = 24, max = 0;
  var a = [], b = [];
  for (var h = 0; h < n; h++) { a.push(get(cur, h)); b.push(prev ? get(prev, h) : 0); max = Math.max(max, a[h], b[h]); }
  var top = niceTop(max);
  var cw = (W - L - R) / n, bw = Math.max(1, Math.min(16, cw * 0.66));
  var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">' + axis(W, H, L, R, T, B, top);
  for (h = 0; h < n; h++) {
    if (nowHour !== null && h > nowHour) continue;
    var v = a[h], bh = (H - T - B) * v / top;
    if (v > 0) out += '<rect x="' + (L + cw * h + (cw - bw) / 2).toFixed(1) + '" y="' + (H - B - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0.5, bh).toFixed(1) + '" rx="2" fill="' + (h === nowHour ? color + 'aa' : color) + '"/>';
  }
  if (prev) {
    var d = b.map(function (v, i) { return (i ? 'L' : 'M') + (L + cw * i + cw / 2).toFixed(1) + ' ' + (T + (H - T - B) * (1 - v / top)).toFixed(1); }).join(' ');
    out += '<path d="' + d + '" fill="none" stroke="#a3a3a3" stroke-width="1.5" stroke-dasharray="3 3"/>';
  }
  for (h = 0; h < n; h++) {
    var tip = h + '시~' + (h + 1) + '시\n오늘 ' + (nowHour !== null && h > nowHour ? '–' : fmt(a[h])) + (prev ? '\n어제 ' + fmt(b[h]) : '');
    out += '<rect x="' + (L + cw * h).toFixed(1) + '" y="' + T + '" width="' + cw.toFixed(1) + '" height="' + (H - T - B) + '" fill="transparent" class="hit" data-tip="' + esc(tip) + '"></rect>';
  }
  [0, 6, 12, 18, 23].forEach(function (h) { out += '<text x="' + (L + cw * h + cw / 2).toFixed(1) + '" y="' + (H - 5) + '" font-size="10" fill="#8f8f8f" text-anchor="middle">' + h + '시</text>'; });
  out += '</svg>';
  var legend = '<div class="legend"><span><i class="sw-' + cls + '"></i>오늘</span>' + (prev ? '<span><i class="dash"></i>어제</span>' : '') + '</div>';
  return '<div class="chart"><div class="head"><h3>' + esc(title) + '</h3></div><p class="desc">' + esc(desc) + '</p>' + legend + out + '</div>';
}
function renderHourly(s) {
  var t = s.today, y = s.yesterday;
  var nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date(s.now))) % 24;
  var hasAny = false;
  for (var h = 0; h < 24 && !hasAny; h++) if (U(t, 'h:users:' + h) || U(y, 'h:users:' + h)) hasAny = true;
  $('hourly').innerHTML = !hasAny ? '<p class="empty">이 판부터 시간대별로 셉니다. 접속이 생기면 여기에 쌓입니다</p>' :
    hourChart('접속자', '그 시간대에 방에 연결돼 있던 고유 브라우저', t, y, function (r, h) { return U(r, 'h:users:' + h); }, 'aqua', nowHour) +
    hourChart('최대 동시 접속', '그 시간대 안에서 같은 순간 연결된 고유 브라우저의 최댓값', t, y, function (r, h) { return C(r, 'h:peak:' + h); }, 'blue', nowHour) +
    hourChart('편집 횟수', '그 시간대에 보낸 Yjs 업데이트 수', t, y, function (r, h) { return C(r, 'h:edits:' + h); }, 'orange', nowHour);
}

function legendOf(series) { return series.length > 1 ? '<div class="legend">' + series.map(function (s) { return '<span><i class="sw-' + esc(s.cls) + '"></i>' + esc(s.label) + '</span>'; }).join('') + '</div>' : ''; }
function chartBox(title, desc, svg, totalText, cls, series) {
  return '<div class="chart' + (cls ? ' ' + cls : '') + '"><div class="head"><h3>' + esc(title) + '</h3>' + (totalText ? '<span class="total">' + esc(totalText) + '</span>' : '') + '</div><p class="desc">' + esc(desc) + '</p>' + legendOf(series || []) + svg + '</div>';
}
function chart(title, desc, rows, series, totalText, cls) { return chartBox(title, desc, bars(rows, series), totalText, cls, series); }

function meter(v, max, color) {
  var w = max > 0 ? Math.max(1, 100 * v / max) : 0;
  return '<svg viewBox="0 0 100 8" preserveAspectRatio="none"><rect width="100" height="8" rx="2" fill="#f2f2f2"/><rect width="' + w.toFixed(1) + '" height="8" rx="2" fill="' + (color || COLORS.blue) + '"/></svg>';
}

function card(label, value, desc, extra) {
  return '<div class="card' + (extra || '') + '"><div class="label">' + esc(label) + '</div><div class="value">' + value + '</div><div class="desc">' + esc(desc) + '</div></div>';
}

// ───────── 핵심 지표 ─────────
/** 어제와 비교한 줄. unit이 '%p'면 차이를 퍼센트포인트로 */
function delta(cur, prev, unit, label) {
  label = label || '어제';
  if (prev === null || prev === undefined) return '<span class="flat">비교할 기록 없음</span>';
  var d = cur - prev;
  var shown = unit === '%p' ? (Math.round(Math.abs(d) * 10) / 10) + '%p' : fmt(Math.abs(d));
  var prevShown = unit === '%p' ? (Math.round(prev * 10) / 10) + '%' : fmt(prev);
  if (Math.abs(d) < 1e-9) return '<span class="flat">변화 없음</span> <span>' + esc(label) + ' ' + esc(prevShown) + '</span>';
  var rel = unit !== '%p' && prev > 0 ? ' ' + (d > 0 ? '+' : '−') + Math.round(Math.abs(d) / prev * 100) + '%' : '';
  return '<b class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + esc(shown) + esc(rel) + '</b> <span>' + esc(label) + ' ' + esc(prevShown) + '</span>';
}
function kpi(label, value, deltaHtml, extra) {
  return '<div class="kpi"><div class="label">' + (extra || '') + esc(label) + '</div><div class="value">' + value + '</div><div class="delta">' + deltaHtml + '</div></div>';
}
function renderKpis(s) {
  var t = s.today, y = s.yesterday;
  var dau = U(t, 'visitors'), mau = s.active.mau, wau = s.active.wau;
  var stick = pctNum(dau, mau), yStick = y ? pctNum(U(y, 'visitors'), y.mau) : null;
  $('kpis').innerHTML =
    kpi('DAU', esc(fmt(dau)), delta(dau, y ? U(y, 'visitors') : null, '', '어제')) +
    kpi('WAU', esc(fmt(wau)), delta(wau, y ? y.wau : null, '', '어제 기준')) +
    kpi('MAU', esc(fmt(mau)), delta(mau, y ? y.mau : null, '', '어제 기준')) +
    kpi('고착도 (DAU/MAU)', stick === null ? '–' : esc(Math.round(stick * 10) / 10) + '<small>%</small>', stick === null || yStick === null ? '<span class="flat">MAU가 아직 없습니다</span>' : delta(stick, yStick, '%p', '어제')) +
    kpi('오늘 신규 사용자', esc(fmt(U(t, 'new'))), delta(U(t, 'new'), y ? U(y, 'new') : null)) +
    kpi('오늘 만든 방', esc(fmt(U(t, 'r:new'))), delta(U(t, 'r:new'), y ? U(y, 'r:new') : null)) +
    kpi('오늘 AI 호출', esc(fmt(cliOf(t) + mcpOf(t))), delta(cliOf(t) + mcpOf(t), y ? cliOf(y) + mcpOf(y) : null)) +
    '<div class="kpi" id="kpi-online"></div>';
  renderOnline(s.live, t.peak);
}
var lastPeak = 0;
function renderOnline(live, peak) {
  if (peak !== undefined) lastPeak = peak;
  var el = $('kpi-online');
  if (!el) return;
  el.innerHTML = '<div class="label"><span class="dot"></span>현재 접속자</div><div class="value">' + esc(fmt(live.users)) + '</div><div class="delta"><span>오늘 최대 ' + esc(fmt(lastPeak)) + ', 열린 방 ' + esc(fmt(live.openRooms)) + '</span></div>';
}

// ───────── 실시간과 오늘 ─────────
function since(ms, nowMs) {
  var m = Math.max(0, Math.floor((nowMs - ms) / 60000));
  if (m < 1) return '1분 미만';
  if (m < 60) return m + '분';
  return Math.floor(m / 60) + '시간 ' + (m % 60) + '분';
}
function renderLiveList(live) {
  var el = $('live-list');
  if (!el) return;
  var list = live.list || [];
  var nowMs = live.now ? Date.parse(live.now) : Date.now();
  var users = typeof live.users === 'number' ? live.users : list.length;
  $('live-count').textContent = list.length ? users + '명' + (list.length !== users ? ', 방 연결 ' + list.length + '개' : '') : '';
  if (!list.length) { el.innerHTML = '<p class="empty">지금 접속한 사람이 없습니다</p>'; return; }
  el.innerHTML = '<div class="scroll"><table class="live-list"><tr><th>사람</th><th>이름</th><th>나라</th><th>기기</th><th>언어</th><th class="num">접속 시간</th><th>방</th><th>신규/재방문</th></tr>' +
    list.map(function (r) {
      return '<tr><td><code>' + esc(r.who || '?') + '</code></td><td>' + (r.name ? esc(r.name) : '<span class="cc">–</span>') + '</td><td>' + countryLabel(r.country) + '</td><td>' + (r.device === 'm' ? '모바일' : '데스크톱') + '</td><td>' + esc(r.lang || '–') + '</td>' +
        '<td class="num">' + esc(since(r.since, nowMs)) + '</td><td><code>' + esc(r.room) + '</code>' + (r.tabs > 1 ? ' <span class="cc">탭 ' + esc(r.tabs) + '개</span>' : '') + '</td>' +
        '<td>' + (r.isNew ? '<span class="tag new">신규</span>' : '<span class="tag">재방문</span>') + '</td></tr>';
    }).join('') + '</table></div>';
}
function renderLive(live) {
  renderOnline(live);
  renderLiveList(live);
  $('live').innerHTML =
    card('현재 접속자', esc(fmt(live.users)), '지금 방에 연결된 고유 브라우저 수(봇 제외)') +
    card('현재 연결 수', esc(fmt(live.connections)), '열린 웹소켓 연결 전체(탭마다 하나)') +
    card('열린 방', esc(fmt(live.openRooms)), '지금 누군가 연결해 있는 방') +
    card('협업 중인 방', esc(fmt(live.collabRooms)), '서로 다른 두 사람 이상이 함께 있는 방');
}

function renderToday(s) {
  var t = s.today;
  $('today').innerHTML =
    card('첫 화면 방문자', esc(fmt(U(t, 'home'))), '첫 화면을 연 고유 브라우저') +
    card('앱 사용자', esc(fmt(U(t, 'app'))), '방에 들어온 고유 브라우저') +
    card('재방문', esc(fmt(U(t, 'returning'))), '전에 온 적 있는 사람') +
    card('활성 방', esc(fmt(U(t, 'r:active'))), '접속자가 편집한 방') +
    card('협업 방', esc(fmt(U(t, 'r:collab'))), '동시에 두 사람 이상 있었던 방') +
    card('최대 동시 접속', esc(fmt(t.peak)), '하루 중 같은 순간 연결된 고유 브라우저의 최댓값') +
    card('체류 시간', esc(dur(t.sess.med)) + '<small>평균 ' + esc(dur(t.sess.avg)) + '</small>', '방 연결 세션 길이의 중앙값(세션 ' + fmt(t.sess.n) + '개)') +
    card('편집 횟수', esc(fmt(C(t, 'edits'))), '접속자가 보낸 Yjs 업데이트 수') +
    card('초대 링크 진입', esc(fmt(U(t, 'invite'))), '처음 보는 방 링크로 들어온 사람') +
    card('AI 호출', esc(fmt(cliOf(t) + mcpOf(t))) + '<small>CLI ' + esc(fmt(cliOf(t))) + ', MCP ' + esc(fmt(mcpOf(t))) + '</small>', 'CLI(모델 API)와 MCP 도구 호출');
}

function renderTotals(s) {
  var x = s.totals;
  $('totals').innerHTML =
    card('누적 방문자', esc(fmt(x.visitors)), '지표를 모으기 시작한 뒤 온 고유 브라우저') +
    card('누적 앱 사용자', esc(fmt(x.appUsers)), '방에 한 번이라도 들어온 고유 브라우저') +
    card('누적 방', esc(fmt(x.rooms)), '새로 만들어 저장된 방') +
    card('누적 AI 호출', esc(fmt(x.cli + x.mcp)) + '<small>CLI ' + esc(fmt(x.cli)) + ', MCP ' + esc(fmt(x.mcp)) + '</small>', 'CLI 명령과 MCP 도구 호출') +
    card('누적 SQL 생성', esc(fmt(x.sql)), 'SQL pane 열기, CLI sql, MCP diagram_to_sql') +
    card('AI로 만든 방', esc(fmt(x.aiRooms)), 'CLI new나 MCP create_diagram으로 만든 방') +
    card('관계 모델이 있는 방', esc(fmt(x.relRooms)), '관계 모델 글을 한 번이라도 쓴 방') +
    card('받은 의견', esc(fmt(s.feedbackTotal || 0)), '의견함에 쌓인 글(최근 1만 건까지 보관)');
}

// ───────── 추이 ─────────
var COUNTRY_COLORS = { KR: 'blue', US: 'orange', JP: 'aqua', CN: 'yellow', VN: 'magenta', TW: 'green', DE: 'violet' };
function renderMain(rows) {
  var sum = function (f) { return '기간 합계 ' + fmt(total(rows, f)); };
  var avg = function (f) { return rows.length ? '하루 평균 ' + fmt(Math.round(total(rows, f) / rows.length * 10) / 10) : ''; };
  var known = Object.keys(COUNTRY_COLORS).filter(function (cc) { return total(rows, function (r) { return U(r, 'cc:' + cc); }) > 0; });
  var ccSeries = known.map(function (cc) { var c = COUNTRY_COLORS[cc]; return { label: countryName(cc), cls: c, color: COLORS[c], get: function (r) { return U(r, 'cc:' + cc); } }; });
  ccSeries.push({ label: '그 밖의 나라', cls: 'gray', color: COLORS.gray, get: function (r) { var s = 0; prefixed(r.u || {}, 'cc:').forEach(function (e) { if (known.indexOf(e[0]) < 0) s += e[1]; }); return s; } });
  $('main-charts').innerHTML =
    chartBox('DAU', '하루 고유 방문자(첫 화면이나 방을 연 브라우저)', line(rows, { label: 'DAU', color: COLORS.blue, get: function (r) { return U(r, 'visitors'); }, tip: function (r) { return '신규 ' + fmt(U(r, 'new')) + ', 재방문 ' + fmt(U(r, 'returning')) + '\nWAU ' + fmt(r.wau) + ', MAU ' + fmt(r.mau); } }, true), avg(function (r) { return U(r, 'visitors'); }), 'wide') +
    chart('신규와 재방문', '그날 처음 온 사람과 전에 온 적 있는 사람', rows, [
      { label: '신규', cls: 'blue', color: COLORS.blue, get: function (r) { return U(r, 'new'); } },
      { label: '재방문', cls: 'sky', color: COLORS.sky, get: function (r) { return U(r, 'returning'); } }], sum(function (r) { return U(r, 'new'); }).replace('기간 합계', '신규 합계')) +
    chart('새 방', '처음 저장된 방. AI로 만든 방은 따로 보입니다', rows, [
      { label: '사람', cls: 'orange', color: COLORS.orange, get: function (r) { return Math.max(0, U(r, 'r:new') - U(r, 'r:ainew')); } },
      { label: 'AI', cls: 'violet', color: COLORS.violet, get: function (r) { return U(r, 'r:ainew'); } }], sum(function (r) { return U(r, 'r:new'); })) +
    chart('AI 호출', 'CLI(모델 API 경로)와 MCP 도구 호출 수', rows, [
      { label: 'CLI', cls: 'violet', color: COLORS.violet, get: cliOf },
      { label: 'MCP', cls: 'lilac', color: COLORS.lilac, get: mcpOf }], sum(function (r) { return cliOf(r) + mcpOf(r); })) +
    chart('나라별 방문자', '날마다 센 고유 브라우저. 주요 나라 말고는 하나로 묶습니다', rows, ccSeries, sum(function (r) { var s = 0; prefixed(r.u || {}, 'cc:').forEach(function (e) { s += e[1]; }); return s; }));
}

function renderTrends(rows) {
  var sum = function (f) { return '기간 합계 ' + fmt(total(rows, f)); };
  $('trends').innerHTML =
    chart('앱 사용자', '방에 들어온 고유 브라우저', rows, [{ label: '앱 사용자', cls: 'aqua', color: COLORS.aqua, get: function (r) { return U(r, 'app'); } }], sum(function (r) { return U(r, 'app'); })) +
    chart('활성 방과 협업 방', '편집이 일어난 방과 그중 두 사람 이상이 함께 있었던 방', rows, [
      { label: '협업', cls: 'green', color: COLORS.green, get: function (r) { return U(r, 'r:collab'); } },
      { label: '혼자', cls: 'mint', color: COLORS.mint, get: function (r) { return Math.max(0, U(r, 'r:active') - U(r, 'r:collab')); } }]) +
    chart('최대 동시 접속', '하루 중 같은 순간 연결된 고유 브라우저의 최댓값', rows, [{ label: '동시 접속', cls: 'blue', color: COLORS.blue, get: function (r) { return r.peak || 0; } }]) +
    chartBox('MAU', '그날 기준 최근 30일 동안 온 고유 브라우저', line(rows, { label: 'MAU', color: COLORS.violet, get: function (r) { return r.mau || 0; }, tip: function (r) { return 'WAU ' + fmt(r.wau); } })) +
    chart('편집 횟수', '접속자가 보낸 Yjs 업데이트 수', rows, [{ label: '편집', cls: 'orange', color: COLORS.orange, get: function (r) { return C(r, 'edits'); } }], sum(function (r) { return C(r, 'edits'); })) +
    chart('체류 시간(중앙값, 초)', '방 연결 세션 길이의 중앙값', rows, [{ label: '중앙값(초)', cls: 'aqua', color: COLORS.aqua, get: function (r) { return (r.sess && r.sess.med) || 0; } }]) +
    chart('안정성', '빨강과 주황이 서버 쪽 문제이고, 회색은 절전이나 네트워크 변경으로 그냥 끊긴 연결(1006)입니다', rows, [
      { label: '5xx', cls: 'red', color: COLORS.red, get: function (r) { return C(r, 'err5xx'); } },
      { label: 'WS 서버 쪽 종료', cls: 'orange', color: COLORS.orange, get: function (r) { return C(r, 'wsServer'); } },
      // wsAbnormal은 나누기 전의 옛 기록이며 거의 다 1006이었다
      { label: 'WS 그냥 끊김', cls: 'gray', color: COLORS.gray, get: function (r) { return C(r, 'wsDrop') + C(r, 'wsAbnormal'); } }],
      '서버 쪽 합계 ' + fmt(total(rows, function (r) { return C(r, 'err5xx') + C(r, 'wsServer'); })));
}

// ───────── 리텐션 히트맵 ─────────
var RET_COLS = [['d1', 'D1', 1], ['d3', 'D3', 3], ['d7', 'D7', 7], ['d14', 'D14', 14], ['d30', 'D30', 30]];
function readyOf(r, k) { return k === 'd1' ? r.ready[0] : k === 'd7' ? r.ready[1] : k === 'd30' ? r.ready[2] : k === 'd3' ? !!(r.readyMore && r.readyMore[0]) : !!(r.readyMore && r.readyMore[1]); }
function knownOf(r, k) { return (k !== 'd3' && k !== 'd14') || r.tracked !== false; }
function heatCell(v, n, ready, known, label, who) {
  if (!known) return '<td class="c na" data-tip="' + esc(who + '\n' + label + '는 이 코호트 뒤부터 셉니다') + '">–</td>';
  if (n <= 0) return '<td class="c na">–</td>';
  var p = v / n, lvl = Math.min(9, Math.round(Math.sqrt(p) * 9));
  var tip = who + ' ' + label + '\n' + pct(v, n) + ' (' + fmt(v) + ' / ' + fmt(n) + '명)' + (ready ? '' : '\n기간이 아직 끝나지 않았습니다');
  return '<td class="c h' + lvl + (lvl >= 6 ? ' dark' : '') + (ready ? '' : ' pend') + '" data-tip="' + esc(tip) + '">' + esc(pct(v, n)) + '</td>';
}
function renderRetention(s) {
  var rows = s.retention.filter(function (r) { return r.n > 0; });
  var head = '<tr><th>첫 방문일</th><th class="num">신규</th>' + RET_COLS.map(function (c) { return '<th>' + esc(c[1]) + '</th>'; }).join('') + '</tr>';
  var body = '';
  if (rows.length) {
    // 기간이 끝난 코호트만 모은 가중 평균
    var avg = '<tr class="avg"><td class="day">가중 평균</td><td class="n">' + esc(fmt(total(rows, function (r) { return r.n; }))) + '</td>' + RET_COLS.map(function (c) {
      var n = 0, v = 0; rows.forEach(function (r) { if (readyOf(r, c[0]) && knownOf(r, c[0])) { n += r.n; v += r[c[0]] || 0; } });
      return heatCell(v, n, true, true, c[1], '기간이 끝난 코호트 평균');
    }).join('') + '</tr>';
    body = avg + rows.map(function (r) {
      return '<tr><td class="day">' + esc(r.day) + '</td><td class="n">' + esc(fmt(r.n)) + '</td>' + RET_COLS.map(function (c) { return heatCell(r[c[0]] || 0, r.n, readyOf(r, c[0]), knownOf(r, c[0]), c[1], r.day + ' 코호트'); }).join('') + '</tr>';
    }).join('');
  } else body = '<tr><td colspan="7" class="empty">아직 신규 사용자가 없습니다.</td></tr>';
  var rooms = s.roomNextDay.filter(function (r) { return r.created > 0; });
  var rbody = rooms.length ? rooms.map(function (r) {
    return '<tr' + (r.ready ? '' : ' class="pending"') + '><td>' + esc(r.day) + '</td><td class="num">' + esc(fmt(r.created)) + '</td><td class="num">' + esc(fmt(r.reopened)) + '</td><td class="num">' + (r.ready ? esc(pct(r.reopened, r.created)) : '진행 중') + '</td></tr>';
  }).join('') : '<tr><td colspan="4" class="empty">아직 새 방이 없습니다.</td></tr>';
  $('retention').innerHTML =
    '<div class="box"><h3>재방문 코호트</h3><p class="desc">첫 방문일별 신규 사용자 가운데 N일 안에 다시 온 비율입니다. 진할수록 높고, 점선 칸은 기간이 아직 끝나지 않은 칸입니다. 칸에 마우스를 올리면 사람 수가 보입니다</p><div class="scroll"><table class="heat">' + head + body + '</table></div></div>' +
    '<div class="box"><h3>다음 날 다시 열린 방</h3><p class="desc">만든 날별 새 방 가운데 다음 날 다시 누가 연 방의 비율</p><div class="scroll"><table><tr><th>만든 날</th><th class="num">새 방</th><th class="num">다음 날 열림</th><th class="num">비율</th></tr>' + rbody + '</table></div></div>';
}

// ───────── 나라 ─────────
var countryPeriod = 'd7';
function renderCountries(s) {
  var data = (s.countries && s.countries[countryPeriod]) || [];
  var sum = 0, max = 0; data.forEach(function (e) { sum += e[1]; if (e[1] > max) max = e[1]; });
  var shown = data.slice(0, 20), rest = data.slice(20);
  var restSum = 0; rest.forEach(function (e) { restSum += e[1]; });
  var by = {}; ['today', 'd7', 'd30'].forEach(function (k) { by[k] = {}; ((s.countries && s.countries[k]) || []).forEach(function (e) { by[k][e[0]] = e[1]; }); });
  var body = shown.length ? shown.map(function (e) {
    return '<tr><td>' + countryLabel(e[0]) + '</td><td class="bar">' + meter(e[1], max) + '</td><td class="num">' + esc(fmt(e[1])) + '</td><td class="num"><span class="sub">' + esc(pct(e[1], sum)) + '</span></td>' +
      '<td class="num"><span class="sub">' + esc(fmt(by.today[e[0]] || 0)) + '</span></td><td class="num"><span class="sub">' + esc(fmt(by.d7[e[0]] || 0)) + '</span></td><td class="num"><span class="sub">' + esc(fmt(by.d30[e[0]] || 0)) + '</span></td></tr>';
  }).join('') + (rest.length ? '<tr><td>나머지 ' + esc(rest.length) + '개 나라</td><td class="bar">' + meter(restSum, max, COLORS.gray) + '</td><td class="num">' + esc(fmt(restSum)) + '</td><td class="num"><span class="sub">' + esc(pct(restSum, sum)) + '</span></td><td></td><td></td><td></td></tr>' : '')
    : '<tr><td colspan="7" class="empty">이 기간에 나라 기록이 없습니다.</td></tr>';
  $('countries').innerHTML = '<div class="scroll"><table><tr><th>나라</th><th></th><th class="num">방문자</th><th class="num">비율</th><th class="num">오늘</th><th class="num">7일</th><th class="num">30일</th></tr>' + body + '</table></div>';
}

// ───────── 의견함 ─────────
var FLAG_NAMES = { dup: ['같은 글 반복', 'warn'], long: ['긴 글', 'warn'], burst: ['1분 5건 이상', 'bad'] };
var inbox = { items: [], total: 0, kept: 0, offset: 0, page: 50 };
function fbItem(e) {
  var tags = (e.flags || []).map(function (f) { var n = Object.prototype.hasOwnProperty.call(FLAG_NAMES, f) ? FLAG_NAMES[f] : null; return n ? '<span class="tag ' + n[1] + '">' + esc(n[0]) + '</span>' : ''; }).join(' ');
  return '<div class="fb"><div class="meta"><span class="time">' + esc(seoul(e.at)) + '</span><span>' + countryLabel(String(e.country || '??')) + '</span>' +
    (e.lang ? '<span>언어 ' + esc(e.lang) + '</span>' : '') + (e.page ? '<span>페이지 <code>' + esc(e.page) + '</code></span>' : '') +
    '<span>' + esc(e.ua || '') + '</span><span>IP <code>' + esc(String(e.ipHash || '').slice(0, 8)) + '</code></span>' + tags + '</div>' +
    '<div class="msg">' + esc(e.message) + '</div></div>';
}
function renderInbox() {
  var el = $('inbox');
  if (!inbox.items.length) { el.innerHTML = '<p class="empty">아직 받은 의견이 없습니다.</p>'; $('inbox-more').innerHTML = ''; return; }
  el.innerHTML = inbox.items.map(fbItem).join('');
  var more = inbox.items.length < inbox.kept ? '<button class="btn" type="button" id="fb-more">더 보기</button>' : '';
  $('inbox-more').innerHTML = more + '<span>' + esc(fmt(inbox.items.length)) + '건 표시, 전체 ' + esc(fmt(inbox.total)) + '건' + (inbox.total > inbox.kept ? ' (화면에서는 최근 ' + esc(fmt(inbox.kept)) + '건까지)' : '') + '</span>';
  var b = $('fb-more');
  if (b) b.addEventListener('click', function () { loadInbox(inbox.items.length); });
}
function loadInbox(offset) {
  return get('/api/feedback?offset=' + offset + '&limit=' + inbox.page).then(function (r) {
    inbox.items = offset ? inbox.items.concat(r.items) : r.items;
    inbox.total = r.total; inbox.kept = r.kept;
    $('fb-count').textContent = '전체 ' + fmt(r.total) + '건';
    renderInbox();
  });
}

// ───────── 이상 발송 ─────────
function z(n) { return '<td class="num' + (n ? '' : ' z') + '">' + esc(fmt(n)) + '</td>'; }
function renderAnomalies(rows) {
  if (!rows.length) { $('anomalies').innerHTML = '<p class="empty">이상한 발송이 없습니다.</p>'; return; }
  $('anomalies').innerHTML = '<div class="scroll"><table class="an"><tr><th>IP 해시</th><th>나라</th><th class="num">받은 글</th><th class="num">최근 1시간</th><th class="num">제한 걸림</th><th class="num">형식 오류</th><th class="num">1분 5건 이상</th><th class="num">1시간 20건 넘김</th><th class="num">같은 글</th><th class="num">긴 글</th><th class="num">다른 사이트</th><th>마지막</th></tr>' +
    rows.map(function (r) {
      return '<tr class="' + (r.level === 'high' ? 'high' : 'medium') + '"><td><code>' + esc(String(r.ipHash).slice(0, 8)) + '</code></td><td>' + countryLabel(String(r.country || '??')) + '</td>' +
        z(r.sent) + z(r.lastHour) + z(r.rejected) + z(r.invalid) + z(r.burst) + z(r.hourly) + z(r.duplicate) + z(r.long) + z(r.crossOrigin) + '<td class="sub">' + esc(seoul(r.last)) + '</td></tr>';
    }).join('') + '</table></div>';
}

// ───────── 퍼널, 기능, 분포 ─────────
function renderFunnel(rows) {
  var steps = [
    ['home', '첫 화면 방문', '첫 화면을 연 사람'],
    ['f:create', '새 다이어그램 만들기', '만들기 버튼을 누른 사람'],
    ['f:shape', '첫 도형 추가', 'ERD에 도형을 추가한 사람'],
    ['f:rel', '관계 모델 작성', '관계 모델 글을 고친 사람'],
    ['f:ie', 'IE 편집', '타입, NULL, 키, 이름을 고친 사람'],
    ['f:sqlview', 'SQL 확인', 'SQL 탭을 연 사람'],
    ['f:sqlexport', 'SQL 복사, 내려받기', '.sql 복사나 내려받기를 한 사람']];
  var vals = steps.map(function (s) { return total(rows, function (r) { return U(r, s[0]); }); });
  var first = vals[0], max = Math.max.apply(null, vals.concat([1]));
  $('funnel').innerHTML = steps.map(function (s, i) {
    var v = vals[i], w = Math.max(v > 0 ? 2 : 0, Math.round(600 * v / max));
    return '<div class="funnel-row"><div class="name">' + esc(s[1]) + '<span class="sub">' + esc(s[2]) + '</span></div>' +
      '<svg viewBox="0 0 600 20" preserveAspectRatio="none"><rect width="600" height="20" rx="4" fill="#f2f2f2"/><rect width="' + w + '" height="20" rx="4" fill="' + (i === 0 ? COLORS.sky : COLORS.blue) + '" data-tip="' + esc(s[1] + '\n' + fmt(v) + '명' + (i ? ', 첫 단계의 ' + pct(v, first) : '')) + '"/></svg>' +
      '<div class="num">' + esc(fmt(v)) + '<span class="sub">' + (i === 0 ? '기준' : esc(pct(v, first)) + ', 앞 단계의 ' + esc(pct(v, vals[i - 1]))) + '</span></div></div>';
  }).join('');
}

function miniTable(title, entries, names) {
  if (!entries.length) return '<p class="desc">' + esc(title) + ': 기록 없음</p>';
  var max = entries[0][1];
  return '<table><tr><th>' + esc(title) + '</th><th></th><th class="num">횟수</th></tr>' + entries.map(function (e) {
    var name = names && Object.prototype.hasOwnProperty.call(names, e[0]) ? names[e[0]] : e[0];
    return '<tr><td>' + esc(name) + '</td><td class="bar">' + meter(e[1], max, COLORS.violet) + '</td><td class="num">' + esc(fmt(e[1])) + '</td></tr>';
  }).join('') + '</table>';
}

function renderUsage(rows) {
  var u = function (k) { return total(rows, function (r) { return U(r, k); }); };
  var c = function (k) { return total(rows, function (r) { return C(r, k); }); };
  var opened = u('r:open');
  var tr = function (name, desc, v, of) { return '<tr><td>' + esc(name) + '<br><span class="sub">' + esc(desc) + '</span></td><td class="num">' + esc(fmt(v)) + '</td><td class="num"><span class="sub">' + (of ? esc(of) : '') + '</span></td></tr>'; };
  $('usage').innerHTML =
    '<div class="box"><h3>기능 사용</h3><p class="desc">기간 동안 날마다 센 고유 사람(또는 방) 수의 합</p><table>' +
    tr('관계 모델을 쓴 방', '관계 모델 글이 고쳐진 방(사람과 AI)', u('r:rel'), '열린 방의 ' + pct(u('r:rel'), opened)) +
    tr('옮기기 안내 열기', '새 다이어그램 창에서 기존 도구에서 옮기기를 고른 사람', u('u:migrate')) +
    tr('검증 패널 열기', '검증 패널을 연 사람', u('u:validate')) +
    tr('표기 안내 열기', '표기법 안내를 연 사람', u('u:legend')) +
    tr('도움말 열기', '도움말을 연 사람', u('u:help')) +
    tr('pane 배치 바꾸기', 'pane을 열고 닫거나 옮긴 사람', u('u:layout')) +
    tr('내보내기', '그림이나 JSON을 내보낸 사람', u('u:export')) +
    tr('링크 복사(초대)', '방 링크를 복사한 횟수', c('share')) +
    tr('SQL 생성', 'SQL pane 열기, CLI sql, MCP diagram_to_sql 횟수', c('sql')) +
    '</table></div>' +
    '<div class="box"><h3>AI</h3><p class="desc">CLI는 서버 API 경로로, MCP는 도구 이름으로 구분합니다. validate와 syntax는 서버를 거치지 않아 CLI에서는 세지 않습니다</p><table>' +
    tr('AI로 만든 방', 'CLI new, MCP create_diagram', u('r:ainew')) +
    tr('AI가 고친 방', 'CLI push, relational push, MCP update_diagram', u('r:aimod')) +
    '</table>' + miniTable('CLI 명령별', sumRows(rows, 'c', 'cli:'), { new: 'new (새 방)', push: 'push (방 고치기)', pull: 'pull (모델 읽기)', diagram: 'diagram (JSON 읽기)', relational: 'relational (관계 모델 읽기)', 'relational-push': 'relational push', sql: 'sql' }) +
    miniTable('MCP 도구별', sumRows(rows, 'c', 'mcp:')) + '</div>';
}

function dist(title, desc, entries, names, unit) {
  if (!entries.length) return '<div class="box"><h3>' + esc(title) + '</h3><p class="desc">' + esc(desc) + '</p><p class="empty">아직 기록이 없습니다.</p></div>';
  var sum = 0, max = 0; entries.forEach(function (e) { sum += e[1]; if (e[1] > max) max = e[1]; });
  var shown = entries.slice(0, 15), rest = entries.slice(15);
  if (rest.length) { var r = 0; rest.forEach(function (e) { r += e[1]; }); shown.push(['(나머지 ' + rest.length + '개)', r]); }
  var body = shown.map(function (e) {
    var name = names && Object.prototype.hasOwnProperty.call(names, e[0]) ? names[e[0]] : e[0];
    return '<tr><td>' + esc(name) + '</td><td class="bar">' + meter(e[1], max) + '</td><td class="num">' + esc(fmt(e[1])) + (unit ? '<span class="sub">' + esc(unit) + '</span>' : '') + '</td><td class="num"><span class="sub">' + esc(pct(e[1], sum)) + '</span></td></tr>';
  }).join('');
  return '<div class="box"><h3>' + esc(title) + '</h3><p class="desc">' + esc(desc) + '</p><table>' + body + '</table></div>';
}

var SEARCH = ['google.', 'naver.com', 'bing.com', 'daum.net', 'duckduckgo.com', 'yahoo.', 'baidu.com', 'yandex.', 'ecosia.org', 'search.brave.com', 'zum.com'];
function refName(d) { if (d === 'direct') return '직접 입력, 북마크'; for (var i = 0; i < SEARCH.length; i++) if (d.indexOf(SEARCH[i]) === 0 || d.indexOf('.' + SEARCH[i]) >= 0) return '검색: ' + d; return d; }

function renderDist(rows) {
  var refs = sumRows(rows, 'c', 'ref:').map(function (e) { return [refName(e[0]), e[1]]; });
  $('dist').innerHTML =
    dist('유입 도메인', '페이지를 처음 연 때 직전 사이트의 도메인(전체 주소는 남기지 않습니다)', refs) +
    dist('진입 경로', '페이지를 처음 연 곳: 첫 화면, 초대 링크(처음 보는 방), 전에 연 내 방', sumRows(rows, 'c', 'land:'), { home: '첫 화면', link: '초대 링크', room: '내 방 주소' }) +
    dist('UTM source', '주소에 utm_source가 있었던 방문', sumRows(rows, 'c', 'utm:')) +
    dist('DBMS 선택', 'SQL과 IE에서 DBMS를 고른 횟수', sumRows(rows, 'c', 'dbms:'), { postgresql: 'PostgreSQL', mysql: 'MySQL', oracle: 'Oracle' }) +
    dist('내보내기 종류', '내보내기 횟수(SQL 복사와 내려받기 포함)', sumRows(rows, 'c', 'exp:').concat(sumRows(rows, 'c', 'sqlx:').map(function (e) { return ['sql_' + e[0], e[1]]; })),
      { png: 'PNG 저장', copy_png: 'PNG 복사', svg: 'SVG 저장', json: 'JSON 저장', sql_copy: 'SQL 복사', sql_download: '.sql 내려받기' }) +
    dist('언어', '화면 언어별 고유 사람(날마다 센 값의 합)', sumRows(rows, 'u', 'lang:')) +
    dist('기기', '모바일과 데스크톱(날마다 센 고유 사람의 합)', sumRows(rows, 'u', 'dev:'), { m: '모바일', d: '데스크톱' }) +
    dist('방에 들어온 방법', '방 화면을 연 횟수: 새로 만듦, 첫 화면에서, 내 방 주소, 초대 링크', sumRows(rows, 'c', 'entry:'), { new: '새로 만듦', home: '첫 화면에서 코드나 최근 목록', recent: '내 방 주소로 바로', link: '초대 링크' });
}

// ───────── 불러오기 ─────────
function get(url) {
  return fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
    if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

var state = { days: 30, summary: null, rows: [] };
function stamp(iso) { $('updated').textContent = '갱신 ' + new Date(iso).toLocaleTimeString('ko-KR'); }

function loadAll() {
  return Promise.all([get('/api/summary'), get('/api/daily' + (state.days ? '?days=' + state.days : '')), get('/api/anomalies'), loadInbox(0)]).then(function (res) {
    var s = res[0], rows = res[1].rows;
    state.summary = s; state.rows = rows;
    renderKpis(s); renderHourly(s); renderLive(s.live); renderMain(rows); renderRetention(s); renderCountries(s); renderAnomalies(res[2].rows);
    renderToday(s); renderTotals(s); renderTrends(rows); renderFunnel(rows); renderUsage(rows); renderDist(rows);
    var note = rows.length ? rows[0].day + ' ~ ' + rows[rows.length - 1].day + ' (' + rows.length + '일)' : '';
    $('period-note').textContent = note; $('period-note2').textContent = note;
    $('an-count').textContent = res[2].rows.length ? res[2].rows.length + '곳' : '';
    stamp(s.now);
    $('error').textContent = '';
  }).catch(function (e) { $('error').textContent = '불러오지 못했습니다: ' + e.message; });
}

function refreshLive() {
  get('/api/live').then(function (live) { renderLive(live); stamp(live.now); }).catch(function () {});
}

function segmented(id, onPick) {
  document.querySelectorAll('#' + id + ' button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#' + id + ' button').forEach(function (x) { x.classList.toggle('on', x === b); });
      onPick(b.getAttribute('data-v'));
    });
  });
}
segmented('period', function (v) { state.days = Number(v) || 0; loadAll(); });
segmented('cc-period', function (v) { countryPeriod = v; if (state.summary) renderCountries(state.summary); });
$('fb-refresh').addEventListener('click', function () { loadInbox(0).catch(function () {}); get('/api/anomalies').then(function (r) { renderAnomalies(r.rows); }).catch(function () {}); });

loadAll();
setInterval(refreshLive, 10000);
setInterval(loadAll, 5 * 60 * 1000);

// 막대, 점, 칸에 마우스를 올리면 그 값을 말풍선으로 보입니다
var tipEl = document.createElement('div');
tipEl.id = 'tip';
document.body.appendChild(tipEl);
document.addEventListener('mousemove', function (ev) {
  var t = ev.target;
  var text = t && t.getAttribute ? t.getAttribute('data-tip') : null;
  if (!text) { tipEl.style.display = 'none'; return; }
  tipEl.textContent = text;
  tipEl.style.display = 'block';
  var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  var x = ev.clientX + 12, y = ev.clientY - h - 10;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - 12;
  if (y < 8) y = ev.clientY + 16;
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
});
`
  .replace('__SERIES__', JSON.stringify(SERIES))
  .replace('__HEAT__', JSON.stringify(HEAT));

/** 대시보드 */
export function adminPageHtml(opts: { nonce: string; csrf: string }): string {
  const nonce = escapeHtml(opts.nonce);
  const swatches = Object.entries(SERIES)
    .map(([k, v]) => `.sw-${k} { background: ${v}; }`)
    .join('\n');
  const heat = HEAT.map((c, i) => `.heat td.h${i} { background: ${c}; }`).join('\n');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>modelll 관리자</title>
<style nonce="${nonce}">${STYLE}
${swatches}
${heat}</style></head>
<body>
<header class="top"><h1>modelll 관리자</h1><span class="badge">SSH 터널 전용</span>
<nav><a href="#sec-kpi">지표</a><a href="#sec-hourly">시간대</a><a href="#sec-trend">추이</a><a href="#sec-retention">리텐션</a><a href="#sec-country">나라</a><a href="#sec-feedback">의견함</a><a href="#sec-anomaly">이상 발송</a><a href="#sec-more">상세</a></nav>
<span class="grow"></span><span class="updated" id="updated"></span>
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(opts.csrf)}"><button class="btn" type="submit">로그아웃</button></form></header>
<main>
<p class="err" id="error" role="alert"></p>
<section id="sec-live"><div class="sec-head"><h2>지금 접속 중</h2><p id="live-count"></p><p>10초마다 갱신합니다. 한 줄은 한 사람이 연 방 하나이고, 사람 칸이 같으면 같은 브라우저입니다</p></div><div id="live-list"></div></section>
<section id="sec-kpi"><div class="sec-head"><h2>핵심 지표</h2><p>오늘은 Asia/Seoul 자정부터입니다. 현재 접속자는 10초마다 갱신합니다</p></div><div class="kpis" id="kpis"></div></section>
<section id="sec-hourly"><div class="sec-head"><h2>시간대별 추이</h2><p>오늘(Asia/Seoul)을 한 시간 단위로 보고, 점선은 어제 같은 시간입니다</p></div><div class="charts three" id="hourly"></div></section>
<section id="sec-trend"><div class="sec-head"><h2>추이</h2><p id="period-note"></p><span class="grow"></span>
<div class="segmented" id="period" role="group" aria-label="기간"><button type="button" data-v="7">7일</button><button type="button" data-v="30" class="on">30일</button><button type="button" data-v="90">90일</button><button type="button" data-v="0">전체</button></div></div>
<div class="charts" id="main-charts"></div></section>
<section id="sec-retention"><div class="sec-head"><h2>리텐션</h2><p>최근 30일 코호트</p></div><div class="grid2" id="retention"></div></section>
<section id="sec-country"><div class="sec-head"><h2>나라별 방문자</h2><p>IP로 찾은 나라입니다. 날마다 센 고유 브라우저의 합이고, IP는 저장하지 않습니다</p><span class="grow"></span>
<div class="segmented" id="cc-period" role="group" aria-label="나라 기간"><button type="button" data-v="today">오늘</button><button type="button" data-v="d7" class="on">7일</button><button type="button" data-v="d30">30일</button></div></div>
<div class="box" id="countries"></div></section>
<section id="sec-feedback"><div class="sec-head"><h2>의견함</h2><p id="fb-count"></p><span class="grow"></span><button class="btn" type="button" id="fb-refresh">새로 고침</button></div>
<div class="box"><div class="inbox" id="inbox"></div><div class="more" id="inbox-more"></div></div></section>
<section id="sec-anomaly"><div class="sec-head"><h2>이상 발송</h2><p id="an-count"></p><p>제한에 걸렸거나 형식이 틀렸거나 몰아서 보낸 IP입니다. 빨간 줄은 제한, 다른 사이트, 1시간 20건 넘김이 있는 곳입니다</p></div>
<div class="box" id="anomalies"></div></section>
<section id="sec-more"><div class="sec-head"><h2>실시간</h2><p>10초마다 갱신</p></div><div class="cards" id="live"></div></section>
<section><div class="sec-head"><h2>오늘 상세</h2><p>Asia/Seoul 자정부터</p></div><div class="cards" id="today"></div></section>
<section><div class="sec-head"><h2>누적</h2><p>지표를 모으기 시작한 뒤 전체</p></div><div class="cards" id="totals"></div></section>
<section><div class="sec-head"><h2>그 밖의 일별 추이</h2><p id="period-note2"></p></div><div class="charts three" id="trends"></div></section>
<section><div class="sec-head"><h2>퍼널</h2><p>단계마다 기간 동안 날마다 센 고유 사람 수의 합입니다. 각 단계는 따로 셉니다(앞 단계를 거쳤는지 묻지 않습니다)</p></div><div class="box" id="funnel"></div></section>
<section><div class="sec-head"><h2>기능 사용과 AI</h2></div><div class="grid2" id="usage"></div></section>
<section><div class="sec-head"><h2>유입과 분포</h2><p>위에서 고른 기간</p></div><div class="grid2" id="dist"></div></section>
<footer><span>개인정보는 저장하지 않습니다. 사람은 브라우저가 만든 익명 ID를, 의견을 보낸 곳은 IP를 서버 비밀 솔트로 해시한 값으로만 구분하고, 봇은 세지 않습니다.</span>
<span>나라 정보: <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">IP Geolocation by DB-IP</a> (CC BY 4.0)</span></footer>
</main>
<script nonce="${nonce}">${SCRIPT}</script>
</body></html>`;
}
