/**
 * 배포 뒤에 옛 화면이 나중에 받는 파일(관계 모델, IE, SQL 화면)을 못 찾으면 페이지를 한 번 새로 고친다.
 * 파일 이름에 해시가 붙어 있어 배포하면 옛 이름의 파일은 서버에서 사라진다. 그대로 두면 React가 화면 전체를 내려 하얀 화면이 된다.
 * 문서는 서버에 있으므로 새로 고쳐도 잃는 것이 없다. 계속 새로 고치지 않도록 RELOAD_GUARD_MS 안에는 한 번만 한다.
 */
const KEY = 'modelll.chunkReloadAt';
export const RELOAD_GUARD_MS = 30_000;

/** 방금 새로 고치지 않았으면 새로 고치고 true. 이미 새로 고쳤으면 false(오류를 그대로 보여 준다) */
export function reloadOnce(now = Date.now(), reload: () => void = () => location.reload()): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0;
  } catch {
    // 저장소가 막혀 있으면 기록 없이 한 번 새로 고친다
  }
  if (now - last < RELOAD_GUARD_MS) return false;
  try {
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // 위와 같다
  }
  reload();
  return true;
}

/** 동적 import를 감싼다. 받기에 실패하면 새로 고치고, 새로 고치는 동안은 끝나지 않는 약속을 돌려준다 */
export function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  return load().catch((err: unknown) => {
    if (reloadOnce()) return new Promise<T>(() => {});
    throw err;
  });
}

/** Vite가 미리 받는 파일(CSS 등)을 못 받았을 때도 같은 방법으로 처리한다 */
export function installChunkReload(): void {
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadOnce()) e.preventDefault();
  });
}
