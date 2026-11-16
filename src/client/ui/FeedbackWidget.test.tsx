// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_MAX, FeedbackWidget, offsetAboveMinimap } from './FeedbackWidget';

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function openWidget() {
  render(<FeedbackWidget />);
  fireEvent.click(screen.getByTestId('feedback-button'));
  return screen.getByTestId('feedback-text') as HTMLTextAreaElement;
}

describe('FeedbackWidget', () => {
  it('버튼을 누르면 입력 창이 열리고 입력 칸에 포커스가 간다', () => {
    const area = openWidget();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.activeElement).toBe(area);
    expect(screen.getByTestId('feedback-button').getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByTestId('feedback-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Esc로 닫으면 포커스가 버튼으로 돌아간다', () => {
    openWidget();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('feedback-button'));
  });

  it('바깥을 누르면 닫힌다', () => {
    openWidget();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('입력 칸의 키는 바깥 단축키로 새지 않는다', () => {
    const area = openWidget();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    fireEvent.keyDown(area, { key: 'Delete' });
    window.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
  });

  it('보내면 다듬은 글과 주소, 언어를 JSON으로 보내고 비운 뒤 닫힌다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    fetchMock.mockResolvedValue(reply(201, { ok: true }));
    const area = openWidget();
    fireEvent.change(area, { target: { value: '  미니맵이 작습니다  ' } });
    await act(async () => {
      fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/feedback');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ message: '미니맵이 작습니다', page: '/', lang: 'ko' });
    expect(area.value).toBe('');
    expect(screen.getByRole('status').textContent).toBe('보냈습니다');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('feedback-button'));
  });

  it('빈 글은 보내지 않는다', () => {
    const area = openWidget();
    fireEvent.change(area, { target: { value: '   ' } });
    fireEvent.keyDown(area, { key: 'Enter', metaKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('429를 받으면 잠시 뒤에 보내라고 알리고 글을 남긴다', async () => {
    fetchMock.mockResolvedValue(reply(429, { error: 'rate_limited', retryAfter: 30 }));
    const area = openWidget();
    fireEvent.change(area, { target: { value: '의견' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('feedback-send'));
    });
    expect(screen.getByRole('status').textContent).toBe('잠시 뒤에 다시 보내 주세요');
    expect(area.value).toBe('의견');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('네트워크 오류면 짧게 알리고 글을 남긴다', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const area = openWidget();
    fireEvent.change(area, { target: { value: '의견' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('feedback-send'));
    });
    expect(screen.getByRole('status').textContent).toBe('보내지 못했습니다');
    expect(area.value).toBe('의견');
  });

  it('보내는 중이거나 1초 안에는 다시 보내지 않는다', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (resolve = r)));
    const area = openWidget();
    fireEvent.change(area, { target: { value: '의견' } });
    const send = screen.getByTestId('feedback-send') as HTMLButtonElement;
    fireEvent.click(send);
    expect(send.disabled).toBe(true);
    fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true });
    fireEvent.click(send);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve(reply(500, { error: 'x' })));
    // 실패한 직후 1초 안에 다시 눌러도 보내지 않는다
    fireEvent.click(send);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('글자 수는 끝에 가까워졌을 때만 보이고 최대 길이를 넘지 않는다', () => {
    const area = openWidget();
    fireEvent.change(area, { target: { value: 'a'.repeat(100) } });
    expect(screen.queryByTestId('feedback-count')).toBeNull();
    fireEvent.change(area, { target: { value: 'a'.repeat(FEEDBACK_MAX + 50) } });
    expect(area.value.length).toBe(FEEDBACK_MAX);
    expect(screen.getByTestId('feedback-count').textContent).toBe(`${FEEDBACK_MAX}/${FEEDBACK_MAX}`);
  });

  it('글은 HTML로 그리지 않는다', () => {
    const area = openWidget();
    fireEvent.change(area, { target: { value: '<img src=x onerror=alert(1)>' } });
    expect(document.querySelector('.fb img')).toBeNull();
  });
});

describe('offsetAboveMinimap', () => {
  const rect = (x: number, y: number, w: number, h: number) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h }) as DOMRect;

  it('오른쪽 아래 구석의 미니맵 위로 올린다', () => {
    expect(offsetAboveMinimap([rect(1274, 808, 114, 80)], 1400, 900)).toEqual({ right: 14, bottom: 100 });
  });

  it('구석에서 떨어진 미니맵은 무시한다', () => {
    expect(offsetAboveMinimap([rect(643, 808, 114, 80)], 1400, 900)).toBeNull();
    expect(offsetAboveMinimap([], 1400, 900)).toBeNull();
  });
});
