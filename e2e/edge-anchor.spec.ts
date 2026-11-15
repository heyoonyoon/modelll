import { expect, test, type Page } from '@playwright/test';

/** ERD 캔버스: 연결 점 여덟 곳, 끝점 손잡이로 붙는 자리 옮기기, 두 번 눌러 자동으로 되돌리기 */
async function place(page: Page, tool: string, x: number, y: number, text: string): Promise<void> {
  const box = (await page.getByTestId('canvas-svg').boundingBox())!;
  await page.getByTestId(`tool-place:${tool}`).click();
  await page.mouse.click(box.x + x, box.y + y);
  await page.getByTestId('text-editor').fill(text);
  await page.getByTestId('text-editor').press('Enter');
}
const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('모서리 연결 점에서 잇고, 끝점을 마름모 변 가운데로 옮기고, 두 번 눌러 자동으로 되돌린다. 팀원 화면도 따라온다', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => localStorage.setItem('chen-erd.identity', JSON.stringify({ id: 'e2e-anchor', name: '철수', color: '#E5484D' })));
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');

  await place(page, 'entity', 150, 200, '학생');
  await place(page, 'relationship', 450, 350, '수강');
  await page.locator('[data-node-id]').first().click();
  // 도형마다 연결 점 여덟 곳
  await expect(page.locator('[data-connect-from]')).toHaveCount(8);
  const from = center((await page.locator('[data-connect-from][data-side="bottom-right"]').boundingBox())!);
  const rel = (await page.locator('[data-node-id]').nth(1).boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(rel.x + rel.width / 2, rel.y + rel.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-edge-id]')).toHaveCount(1);

  // 팀원
  const ctxB = await browser.newContext();
  await ctxB.addInitScript(() => localStorage.setItem('chen-erd.identity', JSON.stringify({ id: 'e2e-anchor-b', name: '영희', color: '#0090FF' })));
  const b = await ctxB.newPage();
  await b.goto(page.url());
  await expect(b.locator('[data-edge-id]')).toHaveCount(1);
  const pathB = () => b.locator('[data-edge-id] .edge-hit').getAttribute('d');
  const before = await pathB();

  // 끝점 손잡이를 마름모 오른쪽 아래 변 가운데로 옮긴다(실행 취소 한 번)
  const end = page.locator('[data-edge-end="target"] .canvas-edge-end-mark');
  const e0 = center((await end.boundingBox())!);
  const goal = { x: rel.x + rel.width * 0.75, y: rel.y + rel.height * 0.75 };
  await page.mouse.move(e0.x, e0.y);
  await page.mouse.down();
  await page.mouse.move(goal.x, goal.y, { steps: 10 });
  await page.mouse.up();
  const e1 = center((await end.boundingBox())!);
  expect(Math.hypot(e1.x - goal.x, e1.y - goal.y)).toBeLessThan(4);
  await expect.poll(pathB).not.toBe(before);

  // 두 번 누르면 그 끝은 자동으로 붙는다
  await page.mouse.dblclick(e1.x, e1.y);
  await expect.poll(async () => {
    const p = center((await end.boundingBox())!);
    return Math.round(Math.hypot(p.x - e0.x, p.y - e0.y));
  }).toBeLessThan(2);
  await expect.poll(pathB).toBe(before);

  await ctxB.close();
  await ctx.close();
});
