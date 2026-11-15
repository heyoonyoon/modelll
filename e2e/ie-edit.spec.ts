import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

/** 이름이 저장된 상태로 새 접속자를 만든다(이름 입력 창이 뜨지 않게). 배치는 IE를 크게, 관계 모델과 SQL을 오른쪽에 둔다 */
async function join(browser: Browser, id: string, name: string, color: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    ([i, n, c]) => {
      if (!localStorage.getItem('chen-erd.identity')) localStorage.setItem('chen-erd.identity', JSON.stringify({ id: i, name: n, color: c }));
      localStorage.setItem(
        'modelll.layout',
        JSON.stringify({
          version: 1,
          maximized: null,
          lastGroup: 'g1',
          root: {
            type: 'split',
            id: 's1',
            direction: 'row',
            sizes: [0.6, 0.4],
            children: [
              { type: 'group', id: 'g1', panes: ['ie'], active: 'ie' },
              {
                type: 'split',
                id: 's2',
                direction: 'column',
                sizes: [0.5, 0.5],
                children: [
                  { type: 'group', id: 'g2', panes: ['relational'], active: 'relational' },
                  { type: 'group', id: 'g3', panes: ['sql', 'erd'], active: 'sql' },
                ],
              },
            ],
          },
        }),
      );
    },
    [id, name, color],
  );
  return { ctx, page: await ctx.newPage() };
}

/** 이름 입력칸에 적고 Enter */
async function typeName(input: Locator, value: string): Promise<void> {
  await expect(input).toBeFocused();
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

test('글 없이 IE에서 테이블, 컬럼, 관계를 만들면 관계 모델 글과 SQL이 따라오고, 옮긴 자리가 팀원에게 보인다', async ({ browser }) => {
  const a = await join(browser, 'e2e-ie-a', '철수', '#E5484D');
  const page = a.page;
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await page.waitForURL(/\/r\/[a-z0-9]+$/);
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');

  const ie = page.getByTestId('ie-diagram');
  const editor = page.getByTestId('relational-editor');
  // 1. 빈 그림: 글을 먼저 적으라고 하지 않고 테이블 추가 버튼을 보인다
  await expect(page.getByTestId('ie-empty')).toContainText('아직 테이블이 없습니다');
  await page.getByTestId('ie-empty-add').click();
  await typeName(ie.getByTestId('ie-table-name-input-Table1'), '학과');
  await expect(editor).toHaveValue('학과 (id)');

  // 2. 도구 줄로 두 번째 테이블
  await ie.getByTestId('ie-tool-add-table').click();
  // 버튼을 누르면 실루엣이 포인터를 따라다니고, 누른 자리에 놓인다
  const ieBox = (await ie.boundingBox())!;
  await page.mouse.move(ieBox.x + ieBox.width * 0.7, ieBox.y + ieBox.height * 0.7);
  await expect(ie.getByTestId('ie-ghost')).toBeVisible();
  await page.mouse.click(ieBox.x + ieBox.width * 0.7, ieBox.y + ieBox.height * 0.7);
  await typeName(ie.getByTestId('ie-table-name-input-Table1'), '학생');
  await expect(editor).toHaveValue('학과 (id)\n학생 (id)');
  await expect(ie.locator('g.ie-table')).toHaveCount(2);

  // 3. 컬럼: 상자에 올리면 컬럼 추가 버튼이 보인다. 더하면 바로 이름을 고친다
  await ie.getByTestId('ie-table-name-학과').hover();
  // 상자에서 아래 버튼까지 천천히 옮겨도 버튼이 사라지지 않는다(상자 바깥 틈을 둘레가 이어 준다)
  const addBtn = ie.getByTestId('ie-add-column-학과');
  await expect(addBtn).toBeVisible();
  const ab = (await addBtn.boundingBox())!;
  const tb = (await ie.locator('g.ie-table[data-table="학과"] .ie-box').boundingBox())!;
  expect(ab.y).toBeGreaterThan(tb.y + tb.height);
  await page.mouse.move(ab.x + ab.width / 2, tb.y + tb.height - 4);
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2, { steps: 8 });
  await expect(addBtn).toBeVisible();
  await addBtn.click();
  await typeName(ie.getByTestId('ie-name-input-학과.column1'), '학과명');
  // 기본키 이름은 두 번 눌러 바꾼다
  await ie.getByTestId('ie-name-학과.id').dblclick();
  await typeName(ie.getByTestId('ie-name-input-학과.id'), '학과코드');
  await ie.getByTestId('ie-table-name-학생').hover();
  await ie.getByTestId('ie-add-column-학생').click();
  await typeName(ie.getByTestId('ie-name-input-학생.column1'), '이름');
  await expect(editor).toHaveValue('학과 (학과코드, 학과명)\n학생 (id, 이름)');

  // 칸 이름 줄은 올리지 않아도 보인다
  await page.mouse.move(5, 5);
  await expect(ie.getByTestId('ie-colhead-학과')).toBeVisible();
  await expect(ie.getByTestId('ie-colhead-학과')).toContainText('타입');

  // 4. 관계: 부모(학과)에 올리면 연결 점이 나오고, 점을 끌어 자식(학생)에 놓으면 비식별 관계가 생긴다
  await expect(ie.locator('[data-testid="ie-connect-학과-right"]')).toBeHidden();
  await ie.getByTestId('ie-table-name-학과').hover();
  const handle = ie.getByTestId('ie-connect-학과-right');
  await expect(handle).toBeVisible();
  const hb = (await handle.boundingBox())!;
  const child = (await ie.locator('g.ie-table[data-table="학생"] .ie-box').boundingBox())!;
  // Esc는 끌기를 그만둔다
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(child.x + child.width / 2, child.y + child.height / 2, { steps: 6 });
  await expect(ie.getByTestId('ie-rubber')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ie.getByTestId('ie-rubber')).toHaveCount(0);
  await page.mouse.up();
  await expect(editor).toHaveValue('학과 (학과코드, 학과명)\n학생 (id, 이름)');
  // 다시 끌어 놓는다
  await ie.getByTestId('ie-table-name-학과').hover();
  const hb2 = (await ie.getByTestId('ie-connect-학과-right').boundingBox())!;
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(child.x + child.width / 2, child.y + child.height / 2, { steps: 6 });
  await expect(ie.getByTestId('ie-draft-target')).toBeVisible();
  await page.mouse.up();
  await expect(editor).toHaveValue('학과 (학과코드, 학과명)\n학생 (id, 이름, 학과코드)\nForeign Key (학과코드) references 학과 (학과코드)');
  await expect(ie.locator('.ie-link[data-link-id="학생#fk1"]')).toHaveAttribute('data-identifying', 'false');
  // 새 관계는 골라져 있고 작은 창에서 식별 관계로 바꿀 수 있다
  await expect(ie.getByTestId('ie-link-pop')).toBeVisible();
  await ie.screenshot({ path: test.info().outputPath('ie-pop.png') });
  // 정렬 붙기: 학생을 끌어 왼쪽 끝이 학과와 거의 맞으면 안내선이 보이고 딱 맞춰 놓인다
  {
    const dept = (await ie.locator('g.ie-table[data-table="학과"] .ie-box').first().boundingBox())!;
    const stu = (await ie.locator('g.ie-table[data-table="학생"] .ie-box').first().boundingBox())!;
    const grabX = stu.x + 40;
    const grabY = stu.y + 12;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX - (stu.x - dept.x) + 3, grabY + 60, { steps: 8 });
    await expect(ie.getByTestId('guides')).toBeVisible();
    await page.mouse.up();
    await expect(ie.getByTestId('guides')).toHaveCount(0);
    const after = (await ie.locator('g.ie-table[data-table="학생"] .ie-box').first().boundingBox())!;
    expect(Math.abs(after.x - dept.x)).toBeLessThan(1);
  }
  // 끌면 테이블이 골라지므로 관계를 다시 고른다
  {
    const pt = await ie.locator('.ie-link[data-link-id="학생#fk1"] path.ie-link-hit').first().evaluate((el) => {
      const path = el as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM()!;
      return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
    });
    await page.mouse.click(pt.x, pt.y);
  }
  await expect(ie.getByTestId('ie-link-pop')).toBeVisible();
  await ie.getByTestId('ie-link-mode-identifying').click();
  await expect(ie.locator('.ie-link[data-link-id="학생#fk1"]')).toHaveAttribute('data-identifying', 'true');
  await expect(page.locator('.rel-editor-marks .rel-ul')).toHaveText(['학과코드', 'id', '학과코드']);
  await ie.getByTestId('ie-link-mode-non-identifying').click();
  await expect(ie.locator('.ie-link[data-link-id="학생#fk1"]')).toHaveAttribute('data-identifying', 'false');
  // 기본키에는 밑줄이 그어져 있다
  await expect(page.locator('.rel-editor-marks .rel-ul')).toHaveText(['학과코드', 'id']);

  // 5. SQL이 따라온다
  const sql = page.getByTestId('sql-code');
  await expect(sql).toContainText('CREATE TABLE `학과`');
  await expect(sql).toContainText('FOREIGN KEY (`학과코드`) REFERENCES `학과` (`학과코드`)');

  // 6. 팀원이 들어와 같은 그림을 본다. 철수가 상자를 끌어 옮기면 영희 화면에서도 옮겨진다
  const b = await join(browser, 'e2e-ie-b', '영희', '#0090FF');
  await b.page.goto(page.url());
  await expect(b.page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
  const boxA = ie.locator('g.ie-table[data-table="학생"] .ie-box');
  const boxB = b.page.locator('g.ie-table[data-table="학생"] .ie-box');
  await expect(boxB).toHaveCount(1);
  const before = await boxA.getAttribute('x');
  await expect(boxB).toHaveAttribute('x', before!);
  const head = (await ie.getByTestId('ie-table-name-학생').boundingBox())!;
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + head.width / 2 + 60, head.y + head.height / 2 + 30, { steps: 4 });
  await page.mouse.move(head.x + head.width / 2 + 120, head.y + head.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  await expect(boxA).not.toHaveAttribute('x', before!);
  const after = await boxA.getAttribute('x');
  await expect(boxB).toHaveAttribute('x', after!);
  await expect(b.page.locator('g.ie-table[data-table="학생"] .ie-box')).toHaveAttribute('y', (await boxA.getAttribute('y'))!);

  // 7. 관계를 골라 지우면(기본은 외래키 컬럼도 지운다) 글과 팀원 화면에서도 사라진다
  await ie.locator('.ie-link[data-link-id="학생#fk1"]').focus();
  await expect(ie.getByTestId('ie-link-pop')).toBeVisible();
  await ie.getByTestId('ie-link-delete').click();
  await expect(editor).toHaveValue('학과 (학과코드, 학과명)\n학생 (id, 이름)');
  await expect(b.page.locator('.ie-link')).toHaveCount(0);

  await b.ctx.close();
  await a.ctx.close();
});
