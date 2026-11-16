import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveAssets } from './assetArchive';

const DAY = 24 * 60 * 60 * 1000;

describe('지난 버전 화면 파일 보관함', () => {
  let root: string;
  let staticDir: string;
  let archive: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-assets-'));
    staticDir = path.join(root, 'client');
    archive = path.join(root, 'data', 'assets-archive');
    await fs.mkdir(path.join(staticDir, 'assets'), { recursive: true });
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('지금 버전 파일을 넣고, 지난 버전 파일은 남기며, 보관 기간이 지난 것만 지운다', async () => {
    await fs.writeFile(path.join(staticDir, 'assets', 'index-NEW.js'), 'new');
    await fs.mkdir(archive, { recursive: true });
    await fs.writeFile(path.join(archive, 'panes-OLD.js'), 'old');
    await fs.writeFile(path.join(archive, 'panes-ANCIENT.js'), 'ancient');
    const now = Date.now();
    const ancient = (now - 8 * DAY) / 1000;
    await fs.utimes(path.join(archive, 'panes-ANCIENT.js'), ancient, ancient);

    const r = await archiveAssets(staticDir, archive, { now });
    expect(r).toEqual({ copied: 1, removed: 1 });
    expect((await fs.readdir(archive)).sort()).toEqual(['index-NEW.js', 'panes-OLD.js']);
    // 다시 돌려도 이미 있는 파일은 건너뛴다
    expect(await archiveAssets(staticDir, archive, { now })).toEqual({ copied: 0, removed: 0 });
  });

  it('클라이언트를 빌드하지 않았어도 실패하지 않는다', async () => {
    await fs.rm(path.join(staticDir, 'assets'), { recursive: true });
    expect(await archiveAssets(staticDir, archive)).toEqual({ copied: 0, removed: 0 });
  });
});
