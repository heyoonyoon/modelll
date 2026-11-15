/**
 * 방에서 고른 DBMS와 그 고르기 버튼. 방 전체가 함께 쓰는 값이라 pane마다 두지 않고 위쪽 바에 하나만 둔다.
 * IE(타입 목록)와 SQL(CREATE TABLE 문)이 같은 값을 읽는다. 이 파일은 엔진(파서, 변환)을 가져오지 않는다
 * (위쪽 바가 처음부터 불러도 가볍다).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { readRoomDialect, RELATIONAL_META, setRoomDialect } from '../../shared/relational/ydoc';
import type { SqlDialect } from '../../shared/relational/userSchema';
import { useRoom } from '../collab/hooks';
import { useT } from '../i18n';
import { stopKeys } from './common';
import { setDialect, useRelPanes } from './paneStore';
import { CellMenu } from './pickers';
import { DIALECTS } from './storage';
import './DialectSelect.css';

export const DIALECT_LABEL: Record<SqlDialect, string> = { mysql: 'MySQL', postgresql: 'PostgreSQL', oracle: 'Oracle' };

/**
 * 방에서 고른 DBMS. 방 문서에 있어 팀원과 함께 쓴다. 아직 아무도 고르지 않은 방이면
 * 이 브라우저에서 마지막으로 고른 값(없으면 기본값)을 보여 준다.
 */
export function useDialect(): SqlDialect {
  const room = useRoom();
  const local = useRelPanes((s) => s.dialect);
  const [shared, setShared] = useState<SqlDialect | null>(() => readRoomDialect(room.doc));
  useEffect(() => {
    const update = () => setShared(readRoomDialect(room.doc));
    update();
    const meta = room.doc.getMap(RELATIONAL_META);
    meta.observe(update);
    return () => meta.unobserve(update);
  }, [room]);
  return shared ?? local;
}

/**
 * DBMS 고르기. 방 문서에 저장해 팀원 화면에도 바로 바뀐다.
 * 운영체제 select 대신 앱의 메뉴를 펼친다(지금 값에 체크, 방향키와 Enter, Esc나 바깥 누르기로 닫기).
 */
export function DialectSelect({ testId = 'dialect-select', className }: { testId?: string; className?: string }) {
  const t = useT();
  const room = useRoom();
  const dialect = useDialect();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const labelId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-dialect`;
  const choose = (d: SqlDialect) => {
    setRoomDialect(room.doc, d);
    // 새 방에서 처음 보여 줄 값으로도 기억한다
    setDialect(d);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    stopKeys(e);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close(true);
    }
  };
  return (
    <div className={`dialect-select${className ? ` ${className}` : ''}`}>
      <span className="dialect-select-label" id={labelId}>
        {t('sqlView.dialect')}
      </span>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-ghost dialect-select-button${open ? ' is-active' : ''}`}
        data-testid={testId}
        data-value={dialect}
        title={t('sqlView.dialect')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${labelId}-value`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
        onKeyUp={stopKeys}
      >
        <span id={`${labelId}-value`}>{DIALECT_LABEL[dialect]}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <CellMenu
          anchor={() => buttonRef.current}
          label={t('sqlView.dialect')}
          choices={DIALECTS.map((d) => ({ value: d, label: DIALECT_LABEL[d] }))}
          current={dialect}
          testId={`${testId}-menu`}
          onPick={(v) => {
            choose(v as SqlDialect);
            close(true);
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
