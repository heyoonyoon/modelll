import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/locales/en';
import { HOME_FAQ, PAGE_DESCRIPTION, PAGE_TITLE, jsonLdScript, renderHomeStatic, structuredData } from './homeStatic';

/** 태그를 뺀 글 */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('로봇이 읽는 첫 화면 글', () => {
  const html = renderHomeStatic(en);

  it('제목은 하나이고 사전 문장이 모두 채워져 있다', () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    const text = textOf(html);
    // 사전에 없는 키는 키 이름 그대로 나오고, 채우지 못한 자리 표시는 {name}으로 남는다
    expect(text).not.toMatch(/\b(home|ai)\.[a-z]+\.[a-zA-Z.]+/);
    expect(text).not.toMatch(/\{\w+\}/);
    expect(text).toContain(en['home.hero.lead'] as string);
    // 첫 화면과 같은 주제를 다룰 만큼 충분히 길다
    expect(text.split(' ').length).toBeGreaterThan(1200);
  });

  it('제목과 설명은 검색 결과에서 잘리지 않는 길이다', () => {
    expect(PAGE_TITLE.length).toBeLessThanOrEqual(60);
    expect(PAGE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it('구조화 데이터는 올바른 JSON이고 자주 묻는 질문이 화면 글과 같다', () => {
    const script = jsonLdScript(structuredData(PAGE_TITLE, PAGE_DESCRIPTION));
    const json = /^<script type="application\/ld\+json">(.*)<\/script>$/s.exec(script)![1];
    expect(json).not.toContain('<');
    const graph = (JSON.parse(json) as { '@graph': Array<Record<string, unknown>> })['@graph'];
    const faq = graph.find((n) => n['@type'] === 'FAQPage') as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
    expect(faq.mainEntity.map((q) => q.name)).toEqual(HOME_FAQ.map((f) => f.q));
    const text = textOf(html);
    for (const q of faq.mainEntity) {
      expect(text).toContain(q.name.replace(/&/g, '&amp;'));
      expect(text).toContain(q.acceptedAnswer.text.replace(/&/g, '&amp;'));
    }
  });

  it('llms-full.txt의 자주 묻는 질문이 같은 글이다', () => {
    const full = readFileSync(path.join(process.cwd(), 'public', 'llms-full.txt'), 'utf8');
    for (const f of HOME_FAQ) {
      expect(full).toContain(`### ${f.q}\n\n${f.a}`);
    }
  });
});
