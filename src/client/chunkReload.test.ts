// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_GUARD_MS, reloadOnce } from './chunkReload';

describe('배포 뒤 화면 파일을 못 받으면 새로 고치기', () => {
  beforeEach(() => sessionStorage.clear());

  it('한 번 새로 고치고, 짧은 시간 안에 또 실패하면 다시 새로 고치지 않는다', () => {
    const reload = vi.fn();
    expect(reloadOnce(1_000_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnce(1_000_000 + 5_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // 시간이 지나면(다음 배포 등) 다시 새로 고칠 수 있다
    expect(reloadOnce(1_000_000 + RELOAD_GUARD_MS + 1, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
