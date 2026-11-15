#!/usr/bin/env node
/**
 * IndexNow로 검색 엔진(Bing, Yandex, Naver, Seznam 등)에 주소가 바뀌었다고 알린다. ChatGPT 검색은 Bing의 색인을 쓴다.
 * 자동으로 돌지 않는다. 첫 화면 내용이 크게 바뀐 배포가 끝난 뒤에 손으로 한 번 실행한다.
 *
 *   node scripts/indexnow.mjs              # 보낼 내용만 보여 준다(아무것도 보내지 않는다)
 *   node scripts/indexnow.mjs --send       # 실제로 보낸다
 *   node scripts/indexnow.mjs --send https://modelll.app/ https://modelll.app/llms.txt
 *
 * 열쇠 파일: public/<KEY>.txt (내용이 KEY와 같아야 한다). 배포된 뒤 https://modelll.app/<KEY>.txt 로 열려야 받아 준다.
 * 열쇠를 바꾸려면 새 32자리 16진수를 만들고(node -e "console.log(crypto.randomBytes(16).toString('hex'))")
 * 파일 이름, 파일 내용, 아래 KEY를 같이 바꾼다.
 * 응답: 200/202는 받음, 403은 열쇠 파일을 찾지 못함, 422는 주소가 host와 맞지 않음, 429는 너무 자주 보냄.
 */
const HOST = 'modelll.app';
const KEY = '7fc7c6a3d4ffa7aa6ee3c4323818a155';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const args = process.argv.slice(2);
const send = args.includes('--send');
const urls = args.filter((a) => a !== '--send');
const urlList = urls.length > 0 ? urls : [`https://${HOST}/`];

for (const u of urlList) {
  if (new URL(u).host !== HOST) {
    console.error(`${HOST}의 주소만 보낼 수 있습니다: ${u}`);
    process.exit(2);
  }
}

const body = { host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList };

if (!send) {
  console.log(`보낼 곳: POST ${ENDPOINT}`);
  console.log(JSON.stringify(body, null, 2));
  console.log('실제로 보내려면 --send 를 붙입니다.');
  process.exit(0);
}

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});
console.log(`${res.status} ${res.statusText}`);
const text = await res.text();
if (text) console.log(text);
process.exit(res.ok ? 0 : 1);
