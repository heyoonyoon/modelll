/**
 * 지난 버전의 화면 파일(dist/client/assets)을 DATA_DIR/assets-archive 에 모아 두고 함께 내준다.
 *
 * 파일 이름에 내용 해시가 붙어 있어 배포하면 옛 이름의 파일은 새 이미지에 없다. 배포 전에 열어 둔 탭이
 * 나중에 관계 모델이나 IE 화면을 처음 열면 옛 이름을 요청하는데, 여기 남겨 둔 파일로 답하면 그대로 열린다.
 * 서버가 뜰 때 지금 버전의 파일을 보관함에 복사하고, 오래된 파일은 지운다.
 * (배포 스크립트는 교체 직전에 돌고 있던 옛 컨테이너의 파일도 이 폴더에 복사해 둔다: deploy/remote-deploy.sh)
 */
import { promises as fs, constants as fsc } from 'node:fs';
import path from 'node:path';

/** 보관하는 기간. 이보다 오래 보관함에만 있던 파일은 지운다 */
export const ARCHIVE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export function archiveDirOf(dataDir: string): string {
  return path.join(dataDir, 'assets-archive');
}

/** 지금 버전의 파일을 보관함에 넣고(이미 있으면 건너뛴다) 오래된 파일을 지운다. 실패해도 서버는 뜬다 */
export async function archiveAssets(
  staticDir: string,
  archiveDir: string,
  opts: { keepMs?: number; now?: number; log?: (message: string) => void } = {},
): Promise<{ copied: number; removed: number }> {
  const keepMs = opts.keepMs ?? ARCHIVE_KEEP_MS;
  const now = opts.now ?? Date.now();
  let copied = 0;
  let removed = 0;
  try {
    await fs.mkdir(archiveDir, { recursive: true });
    const assetsDir = path.join(staticDir, 'assets');
    let current: string[] = [];
    try {
      current = (await fs.readdir(assetsDir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      // 클라이언트를 빌드하지 않은 서버(개발, 테스트)
    }
    const keep = new Set(current);
    for (const name of current) {
      try {
        await fs.copyFile(path.join(assetsDir, name), path.join(archiveDir, name), fsc.COPYFILE_EXCL);
        copied += 1;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        // 이번 버전에도 있는 파일은 보관 기간을 새로 센다
        await fs.utimes(path.join(archiveDir, name), now / 1000, now / 1000).catch(() => {});
      }
    }
    for (const e of await fs.readdir(archiveDir, { withFileTypes: true })) {
      if (!e.isFile() || keep.has(e.name)) continue;
      const file = path.join(archiveDir, e.name);
      const st = await fs.stat(file);
      if (now - st.mtimeMs > keepMs) {
        await fs.unlink(file);
        removed += 1;
      }
    }
  } catch (err) {
    opts.log?.(`asset archive failed: ${(err as Error).message}`);
  }
  return { copied, removed };
}
