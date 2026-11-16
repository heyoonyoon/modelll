/**
 * 모든 화면 오른쪽 아래의 건의사항 버튼과 입력 창. 글은 POST /api/feedback 으로 우리 서버에만 보낸다.
 * 보낸 글은 화면에 HTML로 그리지 않는다(입력 칸의 값으로만 다룬다).
 */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { getLocale, useT } from '../i18n';
import './FeedbackWidget.css';

export const FEEDBACK_PATH = '/api/feedback';
export const FEEDBACK_MAX = 2000;
/** 글자 수는 이만큼 넘게 썼을 때부터 보인다 */
const COUNTER_FROM = 1800;
/** 연달아 보내지 못하게 하는 간격(ms) */
const SEND_GAP_MS = 1000;
/** 보냈다는 표시를 보여 준 뒤 창을 닫기까지(ms) */
const CLOSE_AFTER_SENT_MS = 1200;

type Status = 'idle' | 'sending' | 'sent' | 'rate' | 'error';

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
    </svg>
  );
}

/** 방 화면에서 버튼이 놓이는 기본 자리(오른쪽, 아래 여백과 크기, px). FeedbackWidget.css 의 data-place='room' 과 같다 */
const ROOM_SPOT = { right: 14, bottom: 16, size: 36 };

interface Offset {
  right: number;
  bottom: number;
}

/** 버튼 자리를 미니맵이 차지하고 있으면 미니맵 바로 위로 올릴 위치. 겹치지 않으면 null */
export function offsetAboveMinimap(minimaps: DOMRect[], vw: number, vh: number): Offset | null {
  const { right, bottom, size } = ROOM_SPOT;
  const zone = { left: vw - right - size - 8, top: vh - bottom - size - 8 };
  let best: Offset | null = null;
  for (const r of minimaps) {
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= zone.left || r.bottom <= zone.top || r.left >= vw || r.top >= vh) continue;
    const next = { right: Math.max(right, Math.round(vw - r.right)), bottom: Math.round(vh - r.top + 8) };
    if (!best || next.bottom > best.bottom) best = next;
  }
  return best;
}

function useMinimapOffset(enabled: boolean): Offset | null {
  const [offset, setOffset] = useState<Offset | null>(null);
  useEffect(() => {
    if (!enabled) {
      setOffset(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rects = Array.from(document.querySelectorAll('[data-testid="minimap"]'), (el) => el.getBoundingClientRect());
      const next = offsetAboveMinimap(rects, window.innerWidth, window.innerHeight);
      setOffset((cur) => (cur?.right === next?.right && cur?.bottom === next?.bottom ? cur : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // 미니맵은 켜고 끄기, pane 옮기기, 창 크기 바꾸기로 나타나거나 움직인다
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-minimap', 'data-size'] });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return offset;
}

export function FeedbackWidget({ placement = 'home' }: { placement?: 'home' | 'room' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const lastSentAt = useRef(0);
  const sending = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const lift = useMinimapOffset(placement === 'room');

  const close = useCallback((refocus = true) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setOpen(false);
    setStatus((s) => (s === 'sending' ? s : 'idle'));
    if (refocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    areaRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    };
    // 포커스가 어디 있든 Esc는 이 창만 닫는다(선택 해제 같은 전역 단축키로 넘기지 않는다)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  const send = useCallback(async () => {
    const message = text.trim().slice(0, FEEDBACK_MAX);
    if (!message || sending.current) return;
    const now = Date.now();
    if (now - lastSentAt.current < SEND_GAP_MS) return;
    lastSentAt.current = now;
    sending.current = true;
    setStatus('sending');
    let next: Status = 'error';
    try {
      const res = await fetch(FEEDBACK_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message, page: location.pathname, lang: getLocale() }),
      });
      next = res.ok ? 'sent' : res.status === 429 ? 'rate' : 'error';
    } catch {
      next = 'error';
    }
    sending.current = false;
    setStatus(next);
    if (next === 'sent') {
      setText('');
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => close(true), CLOSE_AFTER_SENT_MS);
    } else if (document.activeElement === document.body || document.activeElement === null) {
      // 보내는 동안 버튼이 꺼져 포커스가 빠졌으면 입력 칸으로 돌려준다
      areaRef.current?.focus();
    }
  }, [text, close]);

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // 캔버스의 전역 단축키로 넘어가지 않게 한다
    e.stopPropagation();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const label = t('feedback.title');
  const trimmed = text.trim();
  const busy = status === 'sending';
  const note =
    status === 'sent' ? t('feedback.sent') : status === 'rate' ? t('feedback.rateLimited') : status === 'error' ? t('feedback.failed') : '';

  return (
    <div
      className="fb"
      data-place={placement}
      data-open={open || undefined}
      data-testid="feedback"
      style={lift ? ({ '--fb-right': `${lift.right}px`, '--fb-bottom': `${lift.bottom}px` } as CSSProperties) : undefined}
    >
      {open && (
        <div
          ref={panelRef}
          className="fb-panel"
          role="dialog"
          aria-labelledby={titleId}
          data-testid="feedback-panel"
          onKeyDown={onPanelKey}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <div className="fb-head">
            <span id={titleId} className="fb-title">
              {label}
            </span>
            <button type="button" className="fb-x" aria-label={t('common.close')} onClick={() => close(true)}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <textarea
            ref={areaRef}
            className="fb-area"
            data-testid="feedback-text"
            value={text}
            maxLength={FEEDBACK_MAX}
            placeholder={t('feedback.placeholder')}
            aria-label={label}
            onChange={(e) => {
              setText(e.target.value.slice(0, FEEDBACK_MAX));
              if (status !== 'sending') setStatus('idle');
            }}
          />
          <div className="fb-foot">
            <span className={`fb-note${status === 'sent' ? ' is-ok' : status === 'idle' || busy ? '' : ' is-err'}`} role="status" aria-live="polite">
              {note}
            </span>
            {text.length >= COUNTER_FROM && (
              <span className="fb-count" data-testid="feedback-count">
                {text.length}/{FEEDBACK_MAX}
              </span>
            )}
            <button type="button" className="fb-send" data-testid="feedback-send" disabled={!trimmed || busy} onClick={() => void send()}>
              {t('feedback.send')}
            </button>
          </div>
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="fb-btn"
        data-testid="feedback-button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(true) : (setStatus('idle'), setOpen(true)))}
      >
        <ChatIcon />
        {!open && (
          <span className="fb-tip" aria-hidden="true">
            {label}
          </span>
        )}
      </button>
    </div>
  );
}
