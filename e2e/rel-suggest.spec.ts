import { expect, test } from '@playwright/test';

test('관계 모델 편집기에서 Tab으로 자동완성 후보를 넣는다', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('chen-erd.identity', JSON.stringify({ id: 'e2e-sg', name: '영희', color: '#E5484D' }));
    localStorage.setItem(
      'modelll.layout',
      JSON.stringify({
        version: 1,
        maximized: null,
        lastGroup: 'g1',
        root: {
          type: 'split', id: 's1', direction: 'row', sizes: [0.4, 0.6],
          children: [
            { type: 'group', id: 'g1', panes: ['erd'], active: 'erd' },
            { type: 'group', id: 'g2', panes: ['relational'], active: 'relational' },
          ],
        },
      }),
    );
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');

  // 선택이 없으면 다이어그램 정보 패널이 뜨고, 줌 바에는 보기 토글이 없다
  await expect(page.getByTestId('diagram-info')).toBeVisible();
  await expect(page.locator('.zoom-controls [data-testid="toggle-grid"]')).toHaveCount(0);
  await expect(page.getByTestId('issues-button')).toHaveCount(0);

  const editor = page.getByTestId('relational-editor');
  await editor.click();
  await page.keyboard.type('Table1 (id, name)\nTable2 (id, Table1_id)\nForeign Key (Table1_id) references Ta');
  const list = page.getByTestId('relational-suggest');
  await expect(list).toBeVisible();
  await expect(list.locator('li').first()).toHaveText('Table1');
  await page.keyboard.press('Tab');
  await expect(list).toHaveCount(0);
  await expect(editor).toBeFocused();
  await page.keyboard.type(' (i');
  await expect(list.locator('li').first()).toHaveText('id');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await page.keyboard.type('d)');
  await expect(editor).toHaveValue('Table1 (id, name)\nTable2 (id, Table1_id)\nForeign Key (Table1_id) references Table1 (id)');

  // 다른 테이블의 컬럼 이름을 넣는다
  await page.keyboard.type('\nTable3 (id, Table');
  await expect(list.locator('li').first()).toHaveText('Table1_id');
  // Enter로도 넣는다(줄은 바뀌지 않는다)
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue(/Table3 \(id, Table1_id$/);

  // 검증은 개수만 보이고, 누르면 한 줄씩 펼쳐지며, 한 줄을 누르면 전체 문장이 보인다(선택은 바뀌지 않는다)
  const canvas = page.locator('.canvas-root');
  const box = (await canvas.boundingBox())!;
  for (const [x, y] of [[120, 300], [120, 420]]) {
    await page.getByTestId('tool-place:entity').click();
    await page.mouse.click(box.x + x, box.y + y);
    await page.keyboard.press('Escape');
  }
  await page.mouse.click(box.x + 300, box.y + 600);
  const head = page.getByTestId('di-issues-head');
  await expect(head).toBeVisible();
  await expect(page.getByTestId('issue-item')).toHaveCount(0);
  await head.click();
  const items = page.getByTestId('issue-item');
  await expect(items.first()).toBeVisible();
  await items.first().click();
  await expect(items.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('diagram-info')).toBeVisible();
  await page.getByTestId('diagram-info').screenshot({ path: test.info().outputPath('panel.png') });
  // 패널을 접으면 제목 줄만 남고, 다시 누르면 펼쳐진다
  await page.getByTestId('di-collapse').click();
  await expect(page.getByTestId('toggle-grid')).toHaveCount(0);
  await page.getByTestId('diagram-info').screenshot({ path: test.info().outputPath('panel-collapsed.png') });
  await page.getByTestId('di-collapse').click();
  await expect(page.getByTestId('toggle-grid')).toBeVisible();
  await page.locator('[data-node-id]').first().click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.getByTestId('inspector').screenshot({ path: test.info().outputPath('inspector.png') });
  await ctx.close();
});
