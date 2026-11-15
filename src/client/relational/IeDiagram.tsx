/**
 * 관계 모델 글에서 유도한 IE(까마귀발) 그림. 테이블 상자는 엔진의 layoutIe 자리(이름으로 찾는다)에 놓고,
 * 기본키 묶음(구분선 위)과 나머지 묶음(구분선 아래)으로 나눈다. 각 행은 [키 표시 | 이름 | 타입 | NULL] 네 칸이고,
 * 칸 경계는 테이블 안에서 모두 같다(ieColumnGrid). 타입은 사람이 정한 것만 적고, 외래키 컬럼이 가리키는 컬럼에서
 * 물려받은 타입은 흐리게 적는다. NULL 칸은 NOT NULL, NULL, 빈칸(미지정) 셋 중 하나다.
 * 선은 외래키 하나에 하나이고, 식별 관계는 실선, 비식별 관계는 점선이다. 선 끝은 아는 것만 그린다.
 * 끌기와 휠로 화면을 옮기고 확대한다.
 *
 * editor가 있으면 그림 안에서 고친다. 그림은 언제나 글과 설정에서 다시 유도한다.
 *   타입 칸 누르기: 그 자리에 콤보박스. 고른 DBMS의 흔한 타입에서 고르거나 직접 적는다. Enter나 칸을 떠나면 쓰고 Esc는 버린다.
 *                   빈 값은 미지정. 틀린 값은 쓰지 않고 표시한다.
 *   NULL 칸 누르기: 미지정, NOT NULL, NULL 중에 고르는 메뉴. 기본키는 언제나 NOT NULL이라 바꿀 수 없다.
 *   키 칸 누르기: 없음, PK, FK, PK+FK 중에 고르는 메뉴. PK는 글의 그 이름에 밑줄, FK는 가리킬 테이블과 컬럼을 골라
 *                 'Foreign Key (컬럼) references 테이블 (컬럼)' 줄을 더하거나 지운다(planSetKeys).
 *   이름 칸, 테이블 이름 두 번 누르기: 이름 바꾸기(글의 테이블 줄, Foreign Key 줄, references를 함께 고친다).
 *   키보드로는 칸에 포커스를 두고 Enter(또는 F2)를 누른다. 그림에 포커스가 있을 때 ⌘Z, Ctrl+Z는 그림에서 고친 것만 되돌린다.
 *
 * (추가) 글 없이 그림만으로 모델 전체를 만든다. 모두 글을 고치는 계획(structure.ts)이라 글, SQL, 팀원 화면이 함께 바뀐다.
 *   도구 줄: 테이블 추가 하나. 빈 곳을 두 번 눌러도 테이블을 더한다.
 *   상자 끌기: 상자를 끌어 옮기고 놓을 때 한 번만 방 문서에 적는다(끄는 동안은 내 화면만 움직인다).
 *              구조를 바꾸거나 상자를 옮기면 다른 상자 자리도 함께 적어 둔다(자동 배치가 다시 돌아 상자들이 튀지 않게).
 *   상자 머리 아래 칸 이름 줄(키, 이름, 타입, NULL)은 언제나 보인다.
 *   상자에 올리거나 고르면: 머리 오른쪽에 테이블 삭제, 상자 아래 끝에 컬럼 추가(더하고 바로 이름을 고친다), 행마다 컬럼 삭제.
 *   관계 잇기: ERD 캔버스처럼 상자에 올리면 연결 점이 나온다. 점을 끌어 다른 상자에 놓으면 끈 쪽이 부모, 놓은 쪽이 자식인
 *              비식별 관계가 생긴다. 끄는 동안 그 점에서 고무줄 선을 그리고 Esc는 그만둔다.
 *   선 누르기: 관계를 고르고 작은 창에서 식별과 비식별을 바꾸거나(외래키 컬럼의 기본키 밑줄을 켜고 끈다) 지운다
 *              (외래키 컬럼도 지울지 고른다). Delete와 Backspace는 고른 테이블이나 관계를 지운다.
 *   글에 오류가 있으면 구조 도구는 막고 이유를 툴팁으로 보인다. 타입은 추측하지 않는다(새 컬럼은 이름만 있다).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { ColumnSetting, IeColumn, IeLayout, IeModel, IePoint, IeTable } from '../../shared/relational/userSchema';
import type { Viewport } from '../../shared/types';
import { clampZoom, fitRect, panViewport, wheelDeltaPx, wheelPan, wheelZoomFactor, zoomViewportAt } from '../canvas/viewportMath';
import { useT } from '../i18n';
import { approximateLineWidth } from '../../shared/measure';
import { CONNECT_DOT_OFFSET, CONNECT_DOT_RADIUS } from '../canvas/interaction/logic';
import { toast } from '../ui/toast';
import { GridDots } from '../canvas/ViewportControls';
import { computeSnap, GuideLines } from '../canvas/snap';
import { SNAP_DISTANCE } from '../canvas/interaction/logic';
import { useUi } from '../state/ui';
import type { Guide } from '../../shared/types';
import { MAX_ZOOM, MIN_ZOOM } from '../../shared/types';
import '../canvas/ViewportControls.css';
import { Icon, icons, stopKeys } from './common';
import type { ForeignKeyTarget } from './engine';
import { CellMenu, TypeCombo } from './pickers';
import { IE_BOX, ieBoxSize, ieColumnGrid, ieSectionHeight, type IeColumnGrid } from './engine';
import { endKind, endMarks, polylinePath, routeLinks, type Box, type Mark } from './ieGeometry';

const B = IE_BOX;

/** 그림 안 편집. 이름과 기본키는 글을 고치고, 타입과 NULL은 컬럼 설정을 고친다. 실패하면 이유 글자를 돌려준다 */
export interface IeEditor {
  setColumn(table: string, column: string, patch: ColumnSetting): string | null;
  renameColumn(table: string, column: string, next: string): string | null;
  renameTable(table: string, next: string): string | null;
  /** 키 고르기(없음, PK, FK, PK+FK). FK를 새로 켜면 ref가 있어야 한다 */
  setKeys(table: string, column: string, want: { primaryKey: boolean; foreignKey: boolean; ref?: ForeignKeyTarget }): string | null;
  /** 그림에서 고친 것 되돌리기(redo면 다시 실행) */
  undo(redo: boolean): void;
  /** (추가) 테이블을 더하고 그 자리를 적는다 */
  addTable(at: IePoint): IeOutcome<{ table: string }>;
  deleteTable(table: string): string | null;
  /** (추가) 이름만 있는 컬럼을 더한다(타입은 비워 둔다) */
  addColumn(table: string): IeOutcome<{ column: string }>;
  deleteColumn(table: string, column: string): string | null;
  /** (추가) 부모의 기본키를 자식에 더하고 외래키 줄을 적는다. link는 새 선의 id */
  addRelationship(child: string, parent: string, identifying: boolean): IeOutcome<{ link: string }>;
  /** (추가) 선의 id('자식#fk1')로 관계를 지운다. dropColumns면 외래키 컬럼도 뺀다 */
  deleteRelationship(linkId: string, dropColumns: boolean): string | null;
  /** (추가) 관계를 식별이나 비식별로 바꾼다. 그 외래키 컬럼들의 기본키 밑줄을 함께 켜고 끈다(되돌리기 한 번) */
  setIdentifying(child: string, columns: readonly string[], identifying: boolean): string | null;
  /** (추가) 상자 자리 적기(한 번에) */
  moveTables(points: Record<string, IePoint>): void;
  /** (추가) 옮겨 놓은 자리를 모두 지운다(자동 배치로). 지운 것이 있으면 true */
  resetPositions(): boolean;
  /** (추가) 여러 편집을 한 번에(되돌리기 한 번에 함께 돌아간다) */
  transact<T>(fn: () => T): T;
}

/** (추가) 성공이면 결과, 실패면 이유 글자 */
export type IeOutcome<T> = ({ ok: true } & T) | { ok: false; message: string };

/** 고치고 있는 칸 */
interface EditingCell {
  kind: 'type' | 'name' | 'table';
  table: string;
  column: string | null;
}

/** 칸 테스트 아이디에 쓰는 '테이블.컬럼' */
const cellId = (table: string, column: string) => `${table}.${column}`;
const testIdOf = (cell: EditingCell) => (cell.kind === 'table' ? `ie-table-name-${cell.table}` : `ie-${cell.kind}-${cellId(cell.table, cell.column!)}`);

/** 열린 칸 메뉴(NULL, 키). fk가 있으면 외래키가 가리킬 곳을 고르는 중이다 */
interface OpenMenu {
  kind: 'null' | 'key';
  table: string;
  column: string;
  fk?: { primaryKey: boolean };
}

/** (추가) 도구 줄과 상자 버튼 아이콘(앱의 아이콘처럼 16 칸, 선만) */
const ieIcons = {
  table: (
    <Icon>
      <rect x="1.75" y="2.75" width="9.5" height="9.5" rx="1.25" />
      <path d="M1.75 6.25h9.5" />
      <path d="M13.25 9.5v5M10.75 12h5" />
    </Icon>
  ),
  trash: (
    <Icon size={14}>
      <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.6 9h6.3l.6-9" />
    </Icon>
  ),
  close: (
    <Icon size={12}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  ),
};

/** (추가) 그림 위의 작은 버튼(상자 버튼, 컬럼 삭제). 막혀 있으면 누를 때 이유를 알린다 */
function CtlButton({
  label,
  testId,
  blocked,
  className,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  blocked: string | null;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`ie-ctl-btn ${className}${blocked ? ' is-disabled' : ''}`}
      data-testid={testId}
      aria-label={label}
      title={blocked ?? label}
      aria-disabled={blocked ? true : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (blocked) toast(blocked, 'error');
        else onClick();
      }}
    >
      {children}
    </button>
  );
}

function MarkShape({ mark }: { mark: Mark }) {
  if (mark.type === 'bar') return <line className="ie-mark ie-mark-bar" x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} />;
  if (mark.type === 'circle') return <circle className="ie-mark ie-mark-circle" cx={mark.cx} cy={mark.cy} r={mark.r} />;
  return <path className="ie-mark ie-mark-crow" d={mark.d} />;
}

/** 칸 자리의 입력칸. 열리면 바로 글자를 모두 고른다 */
function CellEditor({
  value,
  placeholder,
  label,
  testId,
  className,
  x,
  y,
  w,
  h,
  onCommit,
  onClose,
}: {
  value: string;
  placeholder?: string | null;
  label: string;
  testId: string;
  className: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 쓴다. 쓸 수 없으면 이유 글자 */
  onCommit: (next: string) => string | null;
  /** 입력칸을 닫는다. refocus면 그 칸으로 포커스를 돌린다(키보드로 닫았을 때) */
  onClose: (refocus: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);
  /** 쓰고 닫는다. 쓸 수 없으면 Enter일 때는 열어 두고, 칸을 떠날 때는 버리고 알린다 */
  const commit = (how: 'enter' | 'blur') => {
    if (done.current) return;
    const next = draft.trim();
    if (next !== value) {
      const problem = onCommit(next);
      if (problem !== null) {
        setError(problem);
        if (how === 'enter') return;
        toast(problem, 'error');
      }
    }
    done.current = true;
    onClose(how === 'enter');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 입력칸의 키는 그림(화면 이동, 확대, 되돌리기)과 캔버스 단축키로 가지 않는다
    stopKeys(e);
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      commit('enter');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done.current = true;
      onClose(true);
    }
  };
  return (
    <foreignObject className="ie-edit" x={x} y={y} width={w} height={h}>
      <input
        ref={ref}
        className={`input ie-input ${className}${error ? ' is-invalid' : ''}`}
        data-testid={testId}
        value={draft}
        placeholder={placeholder ?? undefined}
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={() => commit('blur')}
        onKeyDown={onKeyDown}
        onKeyUp={stopKeys}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </foreignObject>
  );
}

/** 누를 수 있는 칸(hover 바탕과 포커스 테두리를 그릴 사각형을 깐다) */
function Cell({
  kind,
  testId,
  label,
  hint,
  x,
  y,
  w,
  h,
  active,
  className = '',
  value,
  onActivate,
  children,
}: {
  kind: 'type' | 'null' | 'key' | 'name' | 'table';
  testId: string;
  label: string;
  hint?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 고칠 수 있는 칸인지 */
  active: boolean;
  className?: string;
  value?: string;
  onActivate: () => void;
  children?: ReactNode;
}) {
  return (
    <g
      className={`ie-cell ie-cell-${kind}${active ? ' is-editable' : ''}${className ? ` ${className}` : ''}`}
      data-edit={active ? kind : undefined}
      data-testid={testId}
      data-value={value}
      role={active ? 'button' : undefined}
      tabIndex={active ? 0 : undefined}
      aria-label={active ? label : undefined}
      onKeyDown={
        active
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'F2') return;
              e.preventDefault();
              e.stopPropagation();
              onActivate();
            }
          : undefined
      }
    >
      <rect className="ie-cell-hit" x={x} y={y} width={w} height={h} />
      {children}
      {active && hint && <title>{hint}</title>}
    </g>
  );
}

interface TableBoxProps {
  table: IeTable;
  typeOptions: readonly string[];
  box: Box;
  editor?: IeEditor;
  /** 이 테이블에서 고치고 있는 칸 */
  editing: EditingCell | null;
  onEdit: (cell: EditingCell | null, refocus?: boolean) => void;
  /** 칸 하나를 누른 것처럼 한다(키보드) */
  onActivate: (cell: { kind: string; table: string; column: string | null }) => void;
  /** (추가) 고른 테이블인지 */
  selected?: boolean;
  /** (추가) 구조 편집(컬럼 추가와 삭제, 테이블 삭제). 없으면 버튼을 그리지 않는다 */
  structure?: {
    blocked: string | null;
    onAddColumn: () => void;
    onDelete: () => void;
    onDeleteColumn: (column: string) => void;
  };
  /** (추가) 상자 안에 포커스가 들어오면(키보드로 고르기) */
  onFocusTable?: () => void;
  /** (추가) 연결 점을 그린다(관계 잇기). 화면 배율은 점 크기를 화면에서 같게 맞추는 데 쓴다 */
  connectable?: boolean;
  zoom?: number;
}

/** 머리 아래 칸 이름 줄(키, 이름, 타입, NULL)의 높이. 상자 크기는 엔진의 크기에 이만큼 더한다(화면에서만) */
export const COLHEAD_H = 20;
/** 상자 바로 아래(왼쪽 맞춤)에 띄우는 컬럼 추가 버튼: 상자와의 틈, 높이, 폭. 폭은 최소 상자 폭의 절반보다 좁아 아래 가운데 연결 점과 겹치지 않는다 */
const ADD_GAP = 5;
const ADD_H = 22;
const ADD_W = 82;
/** 머리 오른쪽 테이블 삭제 버튼 */
const HEAD_BTN = 24;
/** 행 오른쪽 컬럼 삭제 버튼 */
const DEL_SIZE = 20;

/** 연결 점 쪽 */
type DotSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * 상자의 연결 점 자리(월드 좌표). ERD 캔버스처럼 상자 바로 바깥, 화면에서 같은 거리에 둔다.
 * 왼쪽과 오른쪽은 머리 높이에 두어 행의 컬럼 삭제 버튼과 겹치지 않는다. 아래쪽은 상자 아래 가운데다(컬럼 추가 버튼은 왼쪽에 있다).
 */
export function connectDots(box: Box, zoom: number): Array<{ side: DotSide; x: number; y: number }> {
  const off = CONNECT_DOT_OFFSET / zoom;
  const midY = box.y + B.headerHeight / 2;
  return [
    { side: 'top', x: box.x + box.w / 2, y: box.y - off },
    { side: 'right', x: box.x + box.w + off, y: midY },
    { side: 'bottom', x: box.x + box.w / 2, y: box.y + box.h + off },
    { side: 'left', x: box.x - off, y: midY },
  ];
}

/** 칸 x 경계 */
function gridX(box: Box, g: IeColumnGrid) {
  const name = box.x + g.key;
  const type = name + g.name;
  const nullable = type + g.type;
  return { key: box.x, name, type, nullable };
}

function TableBox({
  table,
  typeOptions,
  box,
  editor,
  editing,
  onEdit,
  onActivate,
  selected = false,
  structure,
  onFocusTable,
  connectable = false,
  zoom = 1,
}: TableBoxProps) {
  const t = useT();
  const { headerHeight: header, rowHeight: row, cellPadX: pad } = B;
  const pkCols = table.columns.filter((c) => c.primaryKey);
  const otherCols = table.columns.filter((c) => !c.primaryKey);
  /** 첫 행의 위(머리와 칸 이름 줄 아래) */
  const top = box.y + header + COLHEAD_H;
  const dividerY = top + ieSectionHeight(pkCols.length);
  const g = ieColumnGrid(table, box.w);
  const X = gridX(box, g);
  const active = Boolean(editor);
  const editingTable = editing?.kind === 'table';

  const rowEl = (c: IeColumn, i: number, y: number, last: boolean) => {
    const tags = [c.primaryKey ? 'PK' : '', c.foreignKey ? 'FK' : ''].filter(Boolean);
    const mid = y + row / 2;
    const id = cellId(table.name, c.name);
    const editingType = editing?.kind === 'type' && editing.column === c.name;
    const editingName = editing?.kind === 'name' && editing.column === c.name;
    const nullText = c.notNull === true ? 'NOT NULL' : c.notNull === false ? 'NULL' : '';
    const nullActive = active && !c.primaryKey;
    const keyMid = X.key + g.key / 2;
    const names = { table: table.name, column: c.name };
    const act = (kind: string) => () => onActivate({ kind, table: table.name, column: c.name });
    return (
      <g
        key={`${i}:${c.name}`}
        className="ie-row"
        data-column={c.name}
        data-type={c.type ?? undefined}
        data-inherited-type={c.type ? undefined : (c.inheritedType ?? undefined)}
        data-not-null={c.notNull === null ? undefined : String(c.notNull)}
      >
        {/* 행 사이 옅은 선(묶음의 마지막 행 아래는 구분선이나 상자 테두리) */}
        {!last && <line className="ie-row-line" x1={box.x} x2={box.x + box.w} y1={y + row} y2={y + row} />}
        <Cell
          kind="key"
          testId={`ie-key-${id}`}
          label={t('relView.ie.keyLabel', names)}
          hint={t('relView.ie.keyHint')}
          x={X.key}
          y={y}
          w={g.key}
          h={row}
          active={active}
          value={c.primaryKey ? 'pk' : 'none'}
          onActivate={act('key')}
        >
          {/* 기본키이면서 외래키인 컬럼은 두 표시를 위아래로 겹친다 */}
          <text className={`ie-tag${tags.length > 1 ? ' is-stacked' : ''}`} x={keyMid} y={mid}>
            {tags.length > 1 ? (
              <>
                <tspan x={keyMid} y={mid - 5}>
                  {tags[0]}
                </tspan>
                <tspan x={keyMid} y={mid + 6}>
                  {tags[1]}
                </tspan>
              </>
            ) : (
              tags[0]
            )}
          </text>
        </Cell>
        <Cell
          kind="name"
          testId={`ie-name-${id}`}
          label={t('relView.ie.columnNameLabel', names)}
          hint={t('relView.ie.renameHint')}
          x={X.name}
          y={y}
          w={g.name}
          h={row}
          active={active && !editingName}
          onActivate={act('name')}
        >
          {!editingName && (
            <>
              <text className={`ie-col${c.primaryKey ? ' is-pk' : ''}`} x={X.name + pad} y={mid}>
                {c.name}
              </text>
              {/* SVG 글자의 밑줄은 브라우저마다 자리가 달라서 기본키 밑줄은 직접 긋는다 */}
              {c.primaryKey && (
                <line className="ie-pk-line" x1={X.name + pad} x2={X.name + pad + approximateLineWidth(c.name, B.fontSize)} y1={mid + 8} y2={mid + 8} />
              )}
            </>
          )}
        </Cell>
        <Cell
          kind="type"
          testId={`ie-type-${id}`}
          label={t('sqlView.typeLabel', names)}
          x={X.type}
          y={y}
          w={g.type}
          h={row}
          active={active && !editingType}
          className={c.type ?? c.inheritedType ? '' : 'is-empty'}
          onActivate={act('type')}
        >
          {!editingType &&
            (c.type ? (
              <text className="ie-type" x={X.type + pad} y={mid}>
                {c.type}
              </text>
            ) : c.inheritedType ? (
              <text className="ie-type is-inherited" x={X.type + pad} y={mid}>
                {c.inheritedType}
              </text>
            ) : active ? (
              // 빈 칸: 평소엔 글자가 없고, 올려 두거나 포커스가 있을 때만 옅게 보인다
              <text className="ie-type-hint" x={X.type + pad} y={mid} aria-hidden="true">
                {t('sqlView.settings.type')}
              </text>
            ) : null)}
        </Cell>
        <Cell
          kind="null"
          testId={`ie-null-${id}`}
          label={`${t('sqlView.nullLabel', names)}: ${nullText || t('sqlView.settings.unset')}`}
          hint={t('relView.ie.nullHint')}
          x={X.nullable}
          y={y}
          w={g.nullable}
          h={row}
          active={nullActive}
          className={c.primaryKey ? 'is-locked' : ''}
          value={c.notNull === true ? 'not-null' : c.notNull === false ? 'null' : 'unset'}
          onActivate={act('null')}
        >
          {nullText && (
            <text className="ie-null" x={X.nullable + pad} y={mid}>
              {nullText}
            </text>
          )}
        </Cell>
        {editor && editingType && (
          // 좁은 타입 칸이면 NULL 칸 위까지 넓혀 적기 쉽게 한다(상자 밖으로는 나가지 않는다)
          <foreignObject className="ie-edit" x={X.type + 2} y={y + 2} width={Math.max(g.type, Math.min(140, g.type + g.nullable)) - 4} height={row - 4}>
            <TypeCombo
              value={c.type ?? ''}
              options={typeOptions}
              placeholder={c.inheritedType ?? t('sqlView.settings.type')}
              label={t('sqlView.typeLabel', names)}
              testId={`ie-type-input-${id}`}
              className="ie-input ie-input-type"
              autoFocus
              onCommit={(next) => editor.setColumn(table.name, c.name, { type: next === '' ? undefined : next })}
              onDone={(how) => onEdit(null, how !== 'blur')}
            />
          </foreignObject>
        )}
        {editor && editingName && (
          <CellEditor
            value={c.name}
            label={t('relView.ie.columnNameLabel', names)}
            testId={`ie-name-input-${id}`}
            className="ie-input-name"
            x={X.name + 2}
            y={y + 2}
            w={Math.max(g.name, Math.min(160, g.name + g.type)) - 4}
            h={row - 4}
            onCommit={(next) => editor.renameColumn(table.name, c.name, next)}
            onClose={(refocus) => onEdit(null, refocus)}
          />
        )}
        {structure && (
          <>
            {/* 행 오른쪽의 삭제 버튼까지 올려 둔 상태가 이어지게 하는 투명한 자리 */}
            <rect className="ie-row-bridge" x={box.x + box.w} y={y} width={DEL_SIZE + 8} height={row} />
            <foreignObject className="ie-ctl ie-col-del" x={box.x + box.w + 4} y={y + (row - DEL_SIZE) / 2} width={DEL_SIZE} height={DEL_SIZE}>
              <CtlButton
                className="ie-ctl-icon"
                testId={`ie-delete-column-${id}`}
                label={t('relView.ie.deleteColumnLabel', names)}
                blocked={structure.blocked}
                onClick={() => structure.onDeleteColumn(c.name)}
              >
                {ieIcons.close}
              </CtlButton>
            </foreignObject>
          </>
        )}
      </g>
    );
  };
  const bottom = box.y + box.h;
  const colHeadMid = box.y + header + COLHEAD_H / 2;
  /** 올려 둔 상태가 연결 점과 상자 아래 버튼까지 이어지게 하는 투명한 둘레(상자에 올린 뒤에만 포인터를 받는다) */
  const reach = Math.max(28, (CONNECT_DOT_OFFSET + CONNECT_DOT_RADIUS + 8) / zoom);
  return (
    <g
      className={`ie-table${selected ? ' is-selected' : ''}`}
      data-table={table.name}
      data-selected={selected ? 'true' : undefined}
      role="group"
      aria-label={t('relView.ie.tableLabel', { name: table.name })}
      onFocus={onFocusTable}
    >
      {(structure || connectable) && (
        <rect
          className="ie-table-reach"
          x={box.x - reach}
          y={box.y - reach}
          width={box.w + reach * 2}
          height={box.h + Math.max(reach, ADD_GAP + ADD_H + 6) + reach}
        />
      )}
      {/* 상자 바탕(누르기와 끌기를 받는다). 테두리는 칸 바탕이 덮지 않게 맨 위에 따로 그린다 */}
      <rect className="ie-box" x={box.x} y={box.y} width={box.w} height={box.h} rx={4} />
      <path className="ie-head" d={`M${box.x} ${box.y + header}V${box.y + 4}a4 4 0 0 1 4 -4H${box.x + box.w - 4}a4 4 0 0 1 4 4V${box.y + header}Z`} />
      <Cell
        kind="table"
        testId={`ie-table-name-${table.name}`}
        label={t('relView.ie.tableNameLabel', { table: table.name })}
        hint={t('relView.ie.renameHint')}
        x={box.x}
        y={box.y}
        w={box.w}
        h={header}
        active={active && !editingTable}
        onActivate={() => onActivate({ kind: 'table', table: table.name, column: null })}
      >
        {!editingTable && (
          <text className="ie-name" x={box.x + B.paddingX} y={box.y + header / 2}>
            {table.name}
          </text>
        )}
      </Cell>
      {/* 칸 이름 줄: 언제나 보인다 */}
      <rect className="ie-colhead" x={box.x} y={box.y + header} width={box.w} height={COLHEAD_H} />
      <g className="ie-colhead-labels" data-testid={`ie-colhead-${table.name}`} aria-hidden="true">
        <text className="ie-colhead-text is-center" x={X.key + g.key / 2} y={colHeadMid}>
          {t('relView.ie.colKey')}
        </text>
        <text className="ie-colhead-text" x={X.name + pad} y={colHeadMid}>
          {t('relView.ie.colName')}
        </text>
        <text className="ie-colhead-text" x={X.type + pad} y={colHeadMid}>
          {t('sqlView.settings.type')}
        </text>
        <text className="ie-colhead-text" x={X.nullable + pad} y={colHeadMid}>
          NULL
        </text>
      </g>
      {/* 칸 경계(세로, 옅게) */}
      {[X.name, X.type, X.nullable].map((x) => (
        <line key={x} className="ie-grid-line" x1={x} x2={x} y1={box.y + header} y2={bottom} />
      ))}
      <line className="ie-head-line" x1={box.x} y1={box.y + header} x2={box.x + box.w} y2={box.y + header} />
      <line className="ie-colhead-line" x1={box.x} y1={top} x2={box.x + box.w} y2={top} />
      {pkCols.map((c, i) => rowEl(c, i, top + i * row, i === pkCols.length - 1))}
      {/* 나머지 묶음이 비면 상자는 기본키 묶음의 마지막 행에서 끝난다(빈 줄과 구분선을 그리지 않는다) */}
      {otherCols.length > 0 && <line className="ie-divider" x1={box.x} y1={dividerY} x2={box.x + box.w} y2={dividerY} />}
      {otherCols.map((c, i) => rowEl(c, pkCols.length + i, dividerY + i * row, i === otherCols.length - 1))}
      {editor && editingTable && (
        <CellEditor
          value={table.name}
          label={t('relView.ie.tableNameLabel', { table: table.name })}
          testId={`ie-table-name-input-${table.name}`}
          className="ie-input-table"
          x={box.x + 6}
          y={box.y + 6}
          w={box.w - 12}
          h={header - 12}
          onCommit={(next) => editor.renameTable(table.name, next)}
          onClose={(refocus) => onEdit(null, refocus)}
        />
      )}
      {structure && !editingTable && (
        // 머리 오른쪽의 테이블 삭제: 올려 두거나 고르거나 포커스가 안에 있을 때만 보인다
        <foreignObject
          className="ie-ctl ie-table-del"
          x={box.x + box.w - HEAD_BTN - 8}
          y={box.y + (header - HEAD_BTN) / 2}
          width={HEAD_BTN}
          height={HEAD_BTN}
        >
          <CtlButton
            className="ie-ctl-icon is-danger"
            testId={`ie-delete-table-${table.name}`}
            label={t('relView.ie.deleteTableLabel', { table: table.name })}
            blocked={structure.blocked}
            onClick={structure.onDelete}
          >
            {ieIcons.trash}
          </CtlButton>
        </foreignObject>
      )}
      {structure && (
        // 컬럼 추가: 상자 바로 아래 왼쪽의 작은 알약 버튼(상자는 그대로). 상자 둘레의 투명한 자리가 올려 둔 상태를 이어 준다
        <foreignObject className="ie-ctl ie-add-col" x={box.x} y={bottom + ADD_GAP} width={ADD_W} height={ADD_H}>
          <CtlButton
            className="ie-ctl-text ie-add-col-btn"
            testId={`ie-add-column-${table.name}`}
            label={t('relView.ie.addColumnLabel', { table: table.name })}
            blocked={structure.blocked}
            onClick={structure.onAddColumn}
          >
            {icons.plus}
            <span>{t('relView.ie.addColumn')}</span>
          </CtlButton>
        </foreignObject>
      )}
      {/* 바깥 테두리. 모든 선과 같은 굵기와 색으로 맨 위에 그려 칸 바탕이 테두리를 덮지 않는다 */}
      <g className="ie-outline" pointerEvents="none">
        <rect className="ie-box-line" x={box.x} y={box.y} width={box.w} height={box.h} rx={4} />
      </g>
      {connectable &&
        connectDots(box, zoom).map((d) => (
          <g key={d.side} className="ie-connect-dot" data-connect-from={table.name} data-side={d.side} data-testid={`ie-connect-${table.name}-${d.side}`}>
            <circle className="ie-connect-dot-hit" cx={d.x} cy={d.y} r={(CONNECT_DOT_RADIUS + 4) / zoom} />
            <circle className="ie-connect-dot-mark" cx={d.x} cy={d.y} r={CONNECT_DOT_RADIUS / zoom} />
          </g>
        ))}
    </g>
  );
}

/** 외래키가 가리킬 테이블과 컬럼(그 테이블의 기본키 중에서) 고르기 */
function ForeignKeyForm({
  model,
  table,
  onConfirm,
  onCancel,
}: {
  model: IeModel;
  table: string;
  /** 쓴다. 쓸 수 없으면 이유 글자 */
  onConfirm: (ref: ForeignKeyTarget) => string | null;
  onCancel: () => void;
}) {
  const t = useT();
  const keysOf = (name: string) => model.tables.find((tb) => tb.name === name)?.columns.filter((c) => c.primaryKey).map((c) => c.name) ?? [];
  // 처음엔 기본키가 있는 다른 테이블
  const first = model.tables.find((tb) => tb.name !== table && tb.columns.some((c) => c.primaryKey)) ?? model.tables[0];
  const [refTable, setRefTable] = useState(first?.name ?? '');
  const keys = keysOf(refTable);
  const [refColumn, setRefColumn] = useState(keys[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const tableRef = useRef<HTMLSelectElement>(null);
  useEffect(() => tableRef.current?.focus({ preventScroll: true }), []);
  return (
    <form
      className="ie-fk-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!refTable || !refColumn) return;
        setError(onConfirm({ table: refTable, column: refColumn }));
      }}
    >
      <label className="ie-fk-field">
        <span>{t('relView.ie.fkTable')}</span>
        <select
          ref={tableRef}
          className="input"
          data-testid="ie-fk-table"
          value={refTable}
          onChange={(e) => {
            setRefTable(e.target.value);
            setRefColumn(keysOf(e.target.value)[0] ?? '');
            setError(null);
          }}
        >
          {model.tables.map((tb) => (
            <option key={tb.name} value={tb.name}>
              {tb.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ie-fk-field">
        <span>{t('relView.ie.fkColumn')}</span>
        <select
          className="input"
          data-testid="ie-fk-column"
          value={refColumn}
          disabled={keys.length === 0}
          onChange={(e) => {
            setRefColumn(e.target.value);
            setError(null);
          }}
        >
          {keys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {(keys.length === 0 || error) && (
        <p className="ie-fk-note" role="alert" data-testid="ie-fk-error">
          {keys.length === 0 ? t('relView.ie.fkNoKey') : error}
        </p>
      )}
      <div className="ie-fk-actions">
        <button type="button" className="btn btn-ghost" data-testid="ie-fk-cancel" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" data-testid="ie-fk-confirm" disabled={keys.length === 0}>
          {t('common.confirm')}
        </button>
      </div>
    </form>
  );
}

/** 상자 자리(엔진의 배치 자리에, 칸 수와 타입에 맞춘 크기에 칸 이름 줄을 더한 높이). 배치에 없는 테이블은 빠진다 */
function useBoxes(model: IeModel, layout: IeLayout): Record<string, Box> {
  return useMemo(() => {
    const out: Record<string, Box> = {};
    for (const table of model.tables) {
      const at = layout.tables[table.name];
      if (!at || out[table.name]) continue;
      const size = ieBoxSize(table);
      out[table.name] = { x: at.x, y: at.y, w: Math.max(at.w, size.w), h: size.h + COLHEAD_H };
    }
    return out;
  }, [model, layout]);
}

function bounds(boxes: Record<string, Box>): Box | null {
  const list = Object.values(boxes);
  if (list.length === 0) return null;
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  return { x, y, w: Math.max(...list.map((b) => b.x + b.w)) - x, h: Math.max(...list.map((b) => b.y + b.h)) - y };
}

const FIT_MAX = 1.25;
/** 이만큼(px) 넘게 움직이면 누르기가 아니라 끌기로 본다 */
const CLICK_SLOP = 4;
/** 두 번 누르기로 보는 간격(ms) */
const DOUBLE_CLICK_MS = 450;
/** (추가) 새 테이블 상자의 대강 크기(머리, 칸 이름 줄, 기본키 한 행). 빈 자리를 찾을 때 쓴다 */
const NEW_BOX = { w: 220, h: B.headerHeight + COLHEAD_H + B.rowHeight };

/** (추가) 고른 것(테이블 하나나 관계 하나) */
type Selection = { kind: 'table'; table: string } | { kind: 'link'; id: string };

/** (추가) 누르고 있는 동안의 상태: 화면 이동, 상자 옮기기, 관계 잇기 */
interface Drag {
  id: number;
  /** 마지막 포인터 자리 */
  x: number;
  y: number;
  /** 누른 자리 */
  sx: number;
  sy: number;
  moved: number;
  target: EventTarget | null;
  mode: 'pan' | 'table' | 'link';
  table?: string;
  /** 옮기는 상자의 처음 자리 */
  origin?: IePoint;
}

/** (추가) 연결 점을 끌고 있는 관계. from이 부모, 놓은 테이블이 자식. start는 끈 점, to는 포인터(월드 좌표) */
interface LinkDraft {
  from: string;
  start: IePoint;
  to: IePoint;
  /** 포인터 아래의 놓을 수 있는 테이블 */
  target: string | null;
}

/** 꺾은선의 길이 가운데 점 */
function midpointOf(points: readonly IePoint[]): IePoint {
  if (points.length === 1) return points[0];
  const seg = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let half = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] && seg[i] > 0) {
      const r = half / seg[i];
      return { x: points[i].x + (points[i + 1].x - points[i].x) * r, y: points[i].y + (points[i + 1].y - points[i].y) * r };
    }
    half -= seg[i];
  }
  return points[points.length - 1];
}

interface Props {
  model: IeModel;
  layout: IeLayout;
  /** 있으면 그림 안에서 고친다(타입, NULL, 키, 이름, 테이블, 컬럼, 관계, 자리). 없으면 보기만 한다 */
  editor?: IeEditor;
  /** (추가) 구조를 바꾸는 도구를 막는 이유(글에 오류가 있을 때). 없으면 null */
  structureBlocked?: string | null;
  /** 타입 칸에서 고를 흔한 타입(고른 DBMS의 것) */
  typeOptions?: readonly string[];
  /** 그림 위 왼쪽 위에 띄울 것(오류 배지) */
  /** 테이블 추가 버튼 옆에 둘 것(DBMS 고르기) */
  tools?: ReactNode;
  overlay?: ReactNode;
}

export function IeDiagram({ model, layout, editor, structureBlocked = null, typeOptions = [], overlay, tools }: Props) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const baseBoxes = useBoxes(model, layout);
  // 끌고 있는 상자는 놓을 때까지 내 화면에서만 움직인다(놓을 때 방 문서에 한 번 적는다)
  const [moving, setMoving] = useState<{ table: string; x: number; y: number } | null>(null);
  /** 테이블을 끄는 동안의 정렬 안내선(ERD와 같은 정렬 붙기). 놓을 자리는 movingRef에 둔다 */
  const [guides, setGuides] = useState<Guide[]>([]);
  const movingRef = useRef<{ table: string; x: number; y: number } | null>(null);
  const showGrid = useUi((s) => s.showGrid);
  const boxes = useMemo(() => {
    if (!moving || !baseBoxes[moving.table]) return baseBoxes;
    return { ...baseBoxes, [moving.table]: { ...baseBoxes[moving.table], x: moving.x, y: moving.y } };
  }, [baseBoxes, moving]);
  const blocked = editor ? structureBlocked : null;
  /** 그림에서 테이블을 더하거나 지울 때는 화면을 다시 맞추지 않는다(놓은 자리가 그대로 보이게) */
  const holdView = useRef(false);
  // 그림에서 테이블 이름을 바꿀 때도 화면을 다시 맞추지 않는다(방금 더한 테이블 이름을 정할 때 화면이 움직이지 않게)
  const boxEditor = useMemo<IeEditor | undefined>(
    () =>
      editor && {
        ...editor,
        renameTable: (table, next) => {
          holdView.current = true;
          const problem = editor.renameTable(table, next);
          if (problem) holdView.current = false;
          return problem;
        },
      },
    [editor],
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  // 고른 것이 글에서 없어지면(지우거나 이름을 바꾸면) 고르지 않은 것으로 본다
  const selected =
    selection &&
    (selection.kind === 'table' ? model.tables.some((tb) => tb.name === selection.table) : model.links.some((l) => l.id === selection.id))
      ? selection
      : null;
  /** 연결 점을 끌고 있는 관계(끈 테이블이 글에서 없어지면 그만둔 것으로 본다) */
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const draft = linkDraft && baseBoxes[linkDraft.from] ? linkDraft : null;
  /** 관계를 지울 때 외래키 컬럼도 지울지(ERDCloud처럼 기본은 지운다) */
  const [dropColumns, setDropColumns] = useState(true);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  // 고치던 테이블이나 컬럼이 글에서 없어지면(팀원이 지우거나 이름을 바꾸면) 입력칸을 닫는다
  const editingAlive =
    editing !== null &&
    model.tables.some((tb) => tb.name === editing.table && (editing.column === null || tb.columns.some((c) => c.name === editing.column)));
  const onEdit = (cell: EditingCell | null, refocus = false) => {
    const prev = editing;
    setEditing(cell);
    if (cell === null && prev && refocus) {
      // 키보드로 닫았으면 그 칸으로 포커스를 돌린다(입력칸이 사라진 뒤에). 이름을 바꿨으면 새 이름의 칸은 찾지 못하고 그림에 둔다
      const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 0);
      later(() => {
        const want = testIdOf(prev);
        const el = [...(rootRef.current?.querySelectorAll<SVGGElement>('[data-testid]') ?? [])].find((n) => n.getAttribute('data-testid') === want);
        if (el) el.focus({ preventScroll: true });
        else rootRef.current?.focus({ preventScroll: true });
      });
    }
  };
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const columnOf = (table: string, column: string) => model.tables.find((tb) => tb.name === table)?.columns.find((col) => col.name === column);
  const cellEl = (testId: string) =>
    [...(rootRef.current?.querySelectorAll<SVGGElement>('[data-testid]') ?? [])].find((n) => n.getAttribute('data-testid') === testId) ?? null;
  const closeMenu = (refocus: boolean) => {
    const prev = menu;
    setMenu(null);
    if (prev && refocus) cellEl(`ie-${prev.kind}-${cellId(prev.table, prev.column)}`)?.focus({ preventScroll: true });
  };
  /** 칸 하나를 누른다(포인터나 키보드). NULL과 키 칸은 메뉴를 열고 닫는다 */
  const activate = ({ kind, table, column }: { kind: string; table: string; column: string | null }) => {
    if (!editor) return;
    if (kind === 'type' || kind === 'name') {
      if (column !== null) onEdit({ kind, table, column });
    } else if (kind === 'table') onEdit({ kind, table, column: null });
    else if ((kind === 'null' || kind === 'key') && column !== null) {
      const c = columnOf(table, column);
      if (!c || (kind === 'null' && c.primaryKey)) return;
      const same = menu && menu.kind === kind && menu.table === table && menu.column === column;
      setMenu(same ? null : { kind, table, column });
    }
  };
  const menuColumn = menu ? columnOf(menu.table, menu.column) : undefined;
  const pickMenu = (value: string) => {
    if (!editor || !menu || !menuColumn) return;
    let problem: string | null = null;
    if (menu.kind === 'null') {
      problem = editor.setColumn(menu.table, menu.column, { notNull: value === 'not-null' ? true : value === 'null' ? false : undefined });
    } else {
      const primaryKey = value === 'pk' || value === 'pkfk';
      const foreignKey = value === 'fk' || value === 'pkfk';
      if (foreignKey && !menuColumn.foreignKey) {
        // 새 외래키: 가리킬 곳을 먼저 고른다
        setMenu({ ...menu, fk: { primaryKey } });
        return;
      }
      problem = editor.setKeys(menu.table, menu.column, { primaryKey, foreignKey });
    }
    if (problem) toast(problem, 'error');
    closeMenu(true);
  };
  /** 이름 칸과 테이블 이름은 두 번 눌러야 고친다(한 번 누르기는 그냥 고르기와 끌기). 빈 곳 두 번 누르기는 테이블 추가 */
  const lastClick = useRef<{ key: string; at: number } | null>(null);

  const links = useMemo(() => model.links.filter((l) => boxes[l.child.table] && boxes[l.parent.table]), [model, boxes]);
  const routes = useMemo(
    () => routeLinks(links.map((l) => ({ id: l.id, from: l.child.table, to: l.parent.table })), boxes),
    [links, boxes],
  );

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.w === Math.round(r.width) && s.h === Math.round(r.height) ? s : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 전체가 보이게 맞춘다 */
  const fit = () => {
    const b = bounds(baseBoxes);
    if (!b || size.w === 0 || size.h === 0) return;
    // 위쪽은 상자 위로 돌아가는 선과 그 이름표가 잘리지 않게 더 넉넉히 둔다
    const fitIn = (area: { w: number; h: number }): Viewport => {
      const v = fitRect({ x: b.x - 40, y: b.y - 60, w: b.w + 80, h: b.h + 80 }, area, 24);
      const zoom = clampZoom(Math.min(v.zoom, FIT_MAX));
      return { zoom, x: area.w / 2 - (b.x + b.w / 2) * zoom, y: area.h / 2 - (b.y + b.h / 2) * zoom };
    };
    setViewport(fitIn(size));
  };
  // 테이블이 생기거나 없어질 때만 다시 맞춘다(글자 하나 고칠 때마다 화면이 움직이지 않게).
  // 그림에서 테이블을 더하거나 지웠으면 맞추지 않는다(놓은 자리를 그대로 보여 준다)
  const fitKey = `${size.w}x${size.h}|${model.tables.map((tb) => tb.name).join('\u0000')}`;
  const fittedKey = useRef('');
  useEffect(() => {
    if (size.w === 0 || fittedKey.current === fitKey) return;
    const hold = holdView.current && fittedKey.current !== '';
    holdView.current = false;
    fittedKey.current = fitKey;
    if (!hold) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // 휠: 화면 이동, Ctrl/Cmd+휠과 핀치: 확대(캔버스와 같은 규칙)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const dy = wheelDeltaPx(e.deltaY, e.deltaMode, r.height);
        setViewport(zoomViewportAt(v, { x: e.clientX - r.left, y: e.clientY - r.top }, wheelZoomFactor(dy)));
        return;
      }
      const d = wheelPan(wheelDeltaPx(e.deltaX, e.deltaMode, r.width), wheelDeltaPx(e.deltaY, e.deltaMode, r.height), e.shiftKey);
      setViewport(panViewport(v, d.x, d.y));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ───────────── (추가) 구조 편집 ─────────────

  /** 화면 좌표를 그림(월드) 좌표로 */
  const toWorld = (clientX: number, clientY: number): IePoint => {
    const r = rootRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - (r?.left ?? 0) - v.x) / v.zoom, y: (clientY - (r?.top ?? 0) - v.y) / v.zoom };
  };
  /** 지금 보이는 상자 자리 모두. 구조를 바꿀 때 함께 적어 두어 자동 배치가 다시 돌아도 상자들이 튀지 않게 한다 */
  const frozen = (): Record<string, IePoint> => Object.fromEntries(Object.entries(baseBoxes).map(([n, b]) => [n, { x: b.x, y: b.y }]));
  /** 구조 편집을 해도 되는지. 막혀 있으면 이유를 알린다 */
  const guard = (): IeEditor | null => {
    if (!editor) return null;
    if (blocked) {
      toast(blocked, 'error');
      return null;
    }
    return editor;
  };
  /** 상자 자리를 함께 적으며 구조를 고친다(되돌리기 한 번에 함께 돌아간다) */
  const withFrozen = <T,>(ed: IeEditor, fn: () => T): T =>
    ed.transact(() => {
      ed.moveTables(frozen());
      return fn();
    });
  const report = (problem: string | null): boolean => {
    if (problem) toast(problem, 'error');
    return problem === null;
  };
  /** 보이는 화면 가운데 근처의 빈 자리(새 상자 왼쪽 위) */
  const spotInView = (): IePoint => {
    const v = viewRef.current;
    const c = { x: (size.w / 2 - v.x) / v.zoom - NEW_BOX.w / 2, y: (size.h / 2 - v.y) / v.zoom - NEW_BOX.h / 2 };
    const list = Object.values(baseBoxes);
    const free = (p: IePoint) => !list.some((b) => p.x < b.x + b.w + 24 && b.x < p.x + NEW_BOX.w + 24 && p.y < b.y + b.h + 24 && b.y < p.y + NEW_BOX.h + 24);
    for (let ring = 0; ring < 8; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const p = { x: c.x + dx * (NEW_BOX.w + 40), y: c.y + dy * (NEW_BOX.h + 40) };
          if (free(p)) return p;
        }
      }
    }
    return c;
  };
  const addTableAt = (at: IePoint) => {
    const ed = guard();
    if (!ed) return;
    holdView.current = true;
    const r = withFrozen(ed, () => ed.addTable({ x: Math.round(at.x), y: Math.round(at.y) }));
    if (!r.ok) {
      holdView.current = false;
      toast(r.message, 'error');
      return;
    }
    setMenu(null);
    setSelection({ kind: 'table', table: r.table });
    // 새 테이블은 바로 이름을 고친다
    setEditing({ kind: 'table', table: r.table, column: null });
  };
  /** 테이블 추가 버튼을 누른 뒤: 새 테이블 실루엣이 포인터를 따라다니고, 누른 자리에 놓인다 */
  const [placing, setPlacing] = useState<{ at: IePoint | null } | null>(null);
  const startPlacing = () => {
    if (!guard()) return;
    setMenu(null);
    setPlacing((cur) => (cur ? null : { at: null }));
  };
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPlacing(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [placing !== null]);
  const addColumn = (table: string) => {
    const ed = guard();
    if (!ed) return;
    const r = withFrozen(ed, () => ed.addColumn(table));
    if (!r.ok) {
      toast(r.message, 'error');
      return;
    }
    setMenu(null);
    setSelection({ kind: 'table', table });
    // 새 컬럼은 바로 이름을 고친다(타입은 비워 둔다)
    setEditing({ kind: 'name', table, column: r.column });
  };
  const refocusStage = () => rootRef.current?.focus({ preventScroll: true });
  const deleteTable = (table: string) => {
    const ed = guard();
    if (!ed) return;
    holdView.current = true;
    if (!report(withFrozen(ed, () => ed.deleteTable(table)))) {
      holdView.current = false;
      return;
    }
    setMenu(null);
    setSelection(null);
    refocusStage();
  };
  const deleteColumn = (table: string, column: string) => {
    const ed = guard();
    if (!ed) return;
    if (report(withFrozen(ed, () => ed.deleteColumn(table, column)))) setMenu(null);
  };
  const deleteLink = (id: string) => {
    const ed = guard();
    if (!ed) return;
    if (!report(withFrozen(ed, () => ed.deleteRelationship(id, dropColumns)))) return;
    setSelection(null);
    refocusStage();
  };
  /** 관계 끌기를 그만둔다(Esc, 빈 곳에 놓기, 글에 오류가 생길 때) */
  const cancelLink = () => {
    if (drag.current?.mode === 'link') drag.current = null;
    setLinkDraft(null);
  };
  /** 관계 잇기: 부모의 기본키를 자식에 더한다(비식별). 새 관계를 골라 두어 작은 창에서 바로 식별로 바꿀 수 있다 */
  const connect = (child: string, parentTable: string) => {
    setLinkDraft(null);
    const ed = guard();
    if (!ed) return;
    const r = withFrozen(ed, () => ed.addRelationship(child, parentTable, false));
    if (!r.ok) {
      toast(r.message, 'error');
      return;
    }
    setMenu(null);
    setSelection({ kind: 'link', id: r.link });
  };
  /** 고른 관계를 식별이나 비식별로 바꾼다 */
  const setLinkIdentifying = (id: string, identifying: boolean) => {
    const link = model.links.find((l) => l.id === id);
    const ed = guard();
    if (!link || !ed || link.identifying === identifying) return;
    report(withFrozen(ed, () => ed.setIdentifying(link.child.table, link.columns, identifying)));
  };
  // 글에 오류가 생기면 끌던 관계를 그만둔다
  useEffect(() => {
    if (blocked) cancelLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked]);
  // 끄는 동안에는 포커스가 어디 있든 Esc로 그만둔다
  const dragging = draft !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancelLink();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const deleteSelected = () => {
    if (!selected) return;
    if (selected.kind === 'table') deleteTable(selected.table);
    else deleteLink(selected.id);
  };

  // ───────────── 포인터 ─────────────

  const drag = useRef<Drag | null>(null);
  const tableOf = (el: Element | null): string | null =>
    el && typeof el.closest === 'function' ? (el.closest('[data-table]')?.getAttribute('data-table') ?? null) : null;
  /** 포인터 아래 요소(포인터를 잡고 있으면 이벤트 대상은 그림 전체라서 자리로 찾는다) */
  const hitAt = (e: PointerEvent<SVGSVGElement>): Element | null => {
    const fromPoint = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX || 0, e.clientY || 0) : null;
    return fromPoint && rootRef.current?.contains(fromPoint) ? fromPoint : (e.target as Element | null);
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (placing) {
      e.stopPropagation();
      // 누르기의 기본 동작(그림에 포커스)이 새 테이블 이름 입력칸의 포커스를 빼앗지 않게 한다
      e.preventDefault();
      if (e.button !== 0 && e.button !== undefined) {
        setPlacing(null);
        return;
      }
      const p = toWorld(e.clientX || 0, e.clientY || 0);
      setPlacing(null);
      addTableAt({ x: p.x - NEW_BOX.w / 2, y: p.y - B.headerHeight / 2 });
      return;
    }
    if (e.button !== 0 && e.button !== undefined) return;
    // 입력칸 안의 누르기는 글자 고르기다(화면을 끌지 않는다). 그림 위 버튼은 버튼이 처리한다
    const el = e.target as Element | null;
    if (el && typeof el.closest === 'function' && el.closest('.ie-edit, .ie-ctl')) return;
    const x = e.clientX || 0;
    const y = e.clientY || 0;
    const base = { id: e.pointerId, x, y, sx: x, sy: y, moved: 0, target: e.target };
    // 연결 점: 끌어서 다른 테이블에 놓으면 관계를 잇는다(끈 테이블이 부모)
    const dot = editor && el && typeof el.closest === 'function' ? el.closest('[data-connect-from]') : null;
    const from = dot?.getAttribute('data-connect-from') ?? null;
    if (dot && from && baseBoxes[from]) {
      e.stopPropagation();
      if (blocked) {
        toast(blocked, 'error');
        return;
      }
      const side = dot.getAttribute('data-side');
      const start = connectDots(baseBoxes[from], viewRef.current.zoom).find((p) => p.side === side) ?? { x: baseBoxes[from].x, y: baseBoxes[from].y };
      setMenu(null);
      setLinkDraft({ from, start: { x: start.x, y: start.y }, to: toWorld(x, y), target: null });
      drag.current = { ...base, mode: 'link', table: from };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    // 상자 둘레의 투명한 자리는 상자가 아니다(화면 이동)
    const onReach = el && typeof el.closest === 'function' && el.classList?.contains('ie-table-reach');
    const table = editor && !onReach ? tableOf(el) : null;
    if (table && baseBoxes[table]) {
      drag.current = { ...base, mode: 'table', table, origin: { x: baseBoxes[table].x, y: baseBoxes[table].y } };
    } else drag.current = { ...base, mode: 'pan' };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const x = e.clientX || 0;
    const y = e.clientY || 0;
    if (placing) {
      setPlacing({ at: toWorld(x, y) });
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.mode === 'link') {
      const hit = tableOf(hitAt(e));
      const target = hit && hit !== d.table && baseBoxes[hit] ? hit : null;
      const to = toWorld(x, y);
      setLinkDraft((cur) => (cur ? { ...cur, to, target } : cur));
      drag.current = { ...d, x, y, moved: d.moved + Math.abs(x - d.x) + Math.abs(y - d.y) };
      return;
    }
    const dx = x - d.x;
    const dy = y - d.y;
    drag.current = { ...d, x, y, moved: d.moved + Math.abs(dx) + Math.abs(dy) };
    if (d.mode === 'pan') setViewport((v) => panViewport(v, dx, dy));
    else if (d.mode === 'table' && drag.current.moved > CLICK_SLOP) {
      const z = viewRef.current.zoom;
      let nx = d.origin!.x + (x - d.sx) / z;
      let ny = d.origin!.y + (y - d.sy) / z;
      const box = baseBoxes[d.table!];
      if (box && useUi.getState().snapEnabled && !e.altKey) {
        const others = Object.entries(baseBoxes)
          .filter(([n]) => n !== d.table)
          .map(([, b]) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
        const snap = computeSnap({ x: nx, y: ny, w: box.w, h: box.h }, others, SNAP_DISTANCE / z);
        nx += snap.dx;
        ny += snap.dy;
        setGuides(snap.guides);
      } else setGuides((g) => (g.length ? [] : g));
      const next = { table: d.table!, x: Math.round(nx), y: Math.round(ny) };
      movingRef.current = next;
      setMoving(next);
    }
  };
  const endDrag = () => {
    drag.current = null;
    movingRef.current = null;
    setGuides([]);
    setMoving(null);
    setLinkDraft(null);
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    const x = e.clientX || 0;
    const y = e.clientY || 0;
    const click = d.moved <= CLICK_SLOP;
    if (d.mode === 'table') {
      setSelection({ kind: 'table', table: d.table! });
      if (!click) {
        // 놓을 때 한 번만 방 문서에 적는다(팀원에게 이때 보인다)
        const z = viewRef.current.zoom;
        const last = movingRef.current;
        const at = last && last.table === d.table ? { x: last.x, y: last.y } : { x: Math.round(d.origin!.x + (x - d.sx) / z), y: Math.round(d.origin!.y + (y - d.sy) / z) };
        movingRef.current = null;
        setGuides([]);
        setMoving(null);
        editor?.moveTables({ ...frozen(), [d.table!]: at });
        return;
      }
    } else if (d.mode === 'link') {
      // 다른 테이블 위에 놓으면 잇고(놓은 테이블이 자식), 빈 곳이나 같은 테이블에 놓으면 그만둔다
      const hit = tableOf(hitAt(e));
      if (hit && hit !== d.table && baseBoxes[hit]) connect(hit, d.table!);
      else setLinkDraft(null);
      return;
    } else {
      if (!click) return;
      const el = d.target as Element | null;
      const linkId = el && typeof el.closest === 'function' ? el.closest('[data-link-id]')?.getAttribute('data-link-id') : null;
      if (editor && linkId) {
        setSelection({ kind: 'link', id: linkId });
        return;
      }
      if (!tableOf(el)) {
        setSelection(null);
        return;
      }
    }
    // 누르기: 누른 자리(끌기를 위해 포인터를 잡기 전의 대상)의 칸을 고친다
    const el = d.target as Element | null;
    if (!editor || !el || typeof el.closest !== 'function') return;
    const cell = el.closest('[data-edit]');
    const table = cell?.closest('[data-table]')?.getAttribute('data-table');
    if (!cell || table == null) return;
    const kind = cell.getAttribute('data-edit')!;
    const column = cell.closest('[data-column]')?.getAttribute('data-column') ?? null;
    if (kind === 'name' || kind === 'table') {
      const key = `${kind}|${table}|${column ?? ''}`;
      const now = performance.now();
      const prev = lastClick.current;
      lastClick.current = { key, at: now };
      if (!prev || prev.key !== key || now - prev.at > DOUBLE_CLICK_MS) return;
      lastClick.current = null;
    }
    activate({ kind, table, column });
  };

  const zoomCenter = (factor: number) => setViewport((v) => zoomViewportAt(v, { x: size.w / 2, y: size.h / 2 }, factor));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && editor && (e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z' || (e.ctrlKey && (e.code === 'KeyY' || e.key === 'y')))) {
      e.preventDefault();
      e.stopPropagation();
      editor.undo(e.shiftKey || e.code === 'KeyY' || e.key === 'y');
      return;
    }
    if (mod || e.altKey) return;
    if (editor && e.key === 'Escape') {
      // 끌던 관계, 고른 것 순서로 하나씩 그만둔다
      if (draft) cancelLink();
      else if (selected) setSelection(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (editor && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      e.stopPropagation();
      deleteSelected();
      return;
    }
    const step = 48;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    if (m) setViewport((v) => panViewport(v, m[0], m[1]));
    else if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-' || e.key === '_') zoomCenter(0.8);
    else if (e.key === '0') fit();
    else return;
    e.preventDefault();
  };

  const linkLabel = (l: { child: { table: string }; parent: { table: string } }) => t('relView.ie.linkLabel', { child: l.child.table, parent: l.parent.table });
  const selectedLink = selected?.kind === 'link' ? model.links.find((l) => l.id === selected.id) : undefined;
  const selectedRoute = selectedLink ? routes.get(selectedLink.id) : undefined;
  const targetBox = draft?.target ? boxes[draft.target] : undefined;

  /** 도구 줄 버튼. pressed가 있으면 켜고 끄는 도구다 */
  const toolButton = (opts: { id: string; label: string; icon: ReactNode; pressed?: boolean; disabled?: string | null; onClick: () => void }) => (
    <button
      key={opts.id}
      type="button"
      className={`btn btn-ghost btn-icon ie-tool${opts.pressed ? ' is-active' : ''}${opts.disabled ? ' is-disabled' : ''}`}
      data-testid={`ie-tool-${opts.id}`}
      aria-label={opts.label}
      title={opts.disabled ?? opts.label}
      aria-pressed={opts.pressed}
      aria-disabled={opts.disabled ? true : undefined}
      onClick={() => {
        if (opts.disabled) toast(opts.disabled, 'error');
        else opts.onClick();
      }}
    >
      {opts.icon}
    </button>
  );

  return (
    <div className="ie-wrap" data-testid="ie-diagram" data-linking={draft ? 'true' : undefined}>
      <div
        ref={rootRef}
        className={`ie-stage${moving ? ' is-moving' : ''}${draft ? ' is-linking' : ''}${placing ? ' is-placing' : ''}`}
        tabIndex={0}
        role="group"
        aria-label={t('relView.ie.label')}
        aria-describedby="ie-keys-hint"
        onKeyDown={onKeyDown}
      >
        <span id="ie-keys-hint" className="sr-only">
          {t('relView.ie.keysHint')}
          {editor ? ` ${t('relView.ie.editKeysHint')}` : ''}
        </span>
        <svg
          className="ie-svg"
          width="100%"
          height="100%"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={endDrag}
          onPointerLeave={() => setPlacing((cur) => (cur && cur.at ? { at: null } : cur))}
        >
          {showGrid && <GridDots viewport={view} patternId="ie-grid-pattern" />}
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
            <GuideLines guides={guides} />
            {placing?.at && (
              <g className="ie-ghost" data-testid="ie-ghost" transform={`translate(${placing.at.x - NEW_BOX.w / 2} ${placing.at.y - B.headerHeight / 2})`} pointerEvents="none">
                <rect width={NEW_BOX.w} height={NEW_BOX.h} rx={4} />
                <line x1={0} y1={B.headerHeight} x2={NEW_BOX.w} y2={B.headerHeight} />
                <line x1={0} y1={B.headerHeight + COLHEAD_H} x2={NEW_BOX.w} y2={B.headerHeight + COLHEAD_H} />
              </g>
            )}
            <g className="ie-links">
              {links.map((l) => {
                const route = routes.get(l.id);
                if (!route) return null;
                const first = route.points[0];
                const last = route.points[route.points.length - 1];
                const isSelected = selected?.kind === 'link' && selected.id === l.id;
                return (
                  <g
                    key={l.id}
                    className={`ie-link${isSelected ? ' is-selected' : ''}`}
                    data-link-id={l.id}
                    data-child={l.child.table}
                    data-parent={l.parent.table}
                    data-identifying={l.identifying ? 'true' : 'false'}
                    data-child-end={endKind(l.child)}
                    data-parent-end={endKind(l.parent)}
                    data-selected={isSelected ? 'true' : undefined}
                    role={editor ? 'button' : undefined}
                    tabIndex={editor ? 0 : undefined}
                    aria-label={editor ? linkLabel(l) : undefined}
                    aria-pressed={editor ? isSelected : undefined}
                    onFocus={editor ? () => setSelection({ kind: 'link', id: l.id }) : undefined}
                  >
                    {/* 가는 선도 누르기 쉽게 넓고 투명한 선을 깐다 */}
                    {editor && <path className="ie-link-hit" d={polylinePath(route.points)} />}
                    {/* 까마귀발 같은 선 끝 기호도 누르기 쉽게 넓고 투명한 선을 깐다 */}
                    {editor &&
                      [...endMarks(l.child, first, route.fromDir), ...endMarks(l.parent, last, route.toDir)].map((m, i) =>
                        m.type === 'bar' ? (
                          <line key={`h${i}`} className="ie-link-hit" x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} />
                        ) : m.type === 'circle' ? (
                          <circle key={`h${i}`} className="ie-link-hit" cx={m.cx} cy={m.cy} r={m.r} />
                        ) : (
                          <path key={`h${i}`} className="ie-link-hit" d={m.d} />
                        ),
                      )}
                    {/* 올려 두면 ERD 선처럼 옅은 파란 후광 */}
                    {editor && <path className="ie-link-glow" d={polylinePath(route.points)} />}
                    <path className={`ie-link-line${l.identifying ? '' : ' is-dashed'}`} d={polylinePath(route.points)} />
                    <g className="ie-end" data-end="child" data-kind={endKind(l.child)}>
                      {endMarks(l.child, first, route.fromDir).map((m, i) => (
                        <MarkShape key={i} mark={m} />
                      ))}
                    </g>
                    <g className="ie-end" data-end="parent" data-kind={endKind(l.parent)}>
                      {endMarks(l.parent, last, route.toDir).map((m, i) => (
                        <MarkShape key={i} mark={m} />
                      ))}
                    </g>
                  </g>
                );
              })}
            </g>
            {model.tables.map((table) =>
              boxes[table.name] ? (
                <TableBox
                  key={table.name}
                  table={table}
                  typeOptions={typeOptions}
                  box={boxes[table.name]}
                  editor={boxEditor}
                  editing={editingAlive && editing!.table === table.name ? editing : null}
                  onEdit={onEdit}
                  onActivate={activate}
                  selected={(selected?.kind === 'table' && selected.table === table.name) || draft?.from === table.name}
                  structure={
                    editor
                      ? {
                          blocked,
                          onAddColumn: () => addColumn(table.name),
                          onDelete: () => deleteTable(table.name),
                          onDeleteColumn: (column) => deleteColumn(table.name, column),
                        }
                      : undefined
                  }
                  onFocusTable={editor ? () => setSelection({ kind: 'table', table: table.name }) : undefined}
                  connectable={Boolean(editor) && !blocked}
                  zoom={view.zoom}
                />
              ) : null,
            )}
            {draft && targetBox && (
              // 놓을 수 있는 테이블(ERD 캔버스의 연결 후보 표시처럼)
              <rect
                className="ie-draft-target"
                data-testid="ie-draft-target"
                x={targetBox.x - 4 / view.zoom}
                y={targetBox.y - 4 / view.zoom}
                width={targetBox.w + 8 / view.zoom}
                height={targetBox.h + 8 / view.zoom}
                rx={4 / view.zoom}
              />
            )}
            {draft && (
              // 고무줄 선은 끈 연결 점에서 시작한다. 새 관계는 비식별이라 점선
              <g className="ie-draft" pointerEvents="none">
                <line
                  className="ie-rubber is-dashed"
                  data-testid="ie-rubber"
                  data-from={draft.from}
                  x1={draft.start.x}
                  y1={draft.start.y}
                  x2={draft.to.x}
                  y2={draft.to.y}
                />
                <circle className="ie-connect-dot-mark is-active" cx={draft.start.x} cy={draft.start.y} r={CONNECT_DOT_RADIUS / view.zoom} />
              </g>
            )}
          </g>
        </svg>
      </div>
      {model.tables.length === 0 && (
        <div className="ie-empty" data-testid="ie-empty">
          {editor ? (
            <div className="ie-empty-card">
              <p className="ie-empty-title">{t('relView.ie.emptyTitle')}</p>
              <p className="ie-empty-body">{blocked ?? t('relView.ie.emptyBody')}</p>
              <button
                type="button"
                className={`btn btn-primary ie-empty-add${blocked ? ' is-disabled' : ''}`}
                data-testid="ie-empty-add"
                aria-disabled={blocked ? true : undefined}
                title={blocked ?? undefined}
                onClick={() => addTableAt(spotInView())}
              >
                {icons.plus}
                {t('relView.ie.tool.addTable')}
              </button>
            </div>
          ) : (
            <p className="ie-empty-body">{t('relView.empty')}</p>
          )}
        </div>
      )}
      {(editor || overlay) && (
        <div className="ie-overlay">
          {editor && (
            <div className="ie-tools" role="toolbar" aria-label={t('relView.ie.tools')} data-testid="ie-tools">
              {toolButton({ id: 'add-table', label: t('relView.ie.tool.addTable'), icon: ieIcons.table, pressed: placing !== null, disabled: blocked, onClick: startPlacing })}
              {tools && (
                <>
                  <span className="ie-tools-sep" aria-hidden="true" />
                  {tools}
                </>
              )}
            </div>
          )}
          {overlay}
        </div>
      )}
      {editor && selectedLink && selectedRoute && (
        <LinkPopover
          label={linkLabel(selectedLink)}
          mid={(() => {
            const mid = midpointOf(selectedRoute.points);
            return { x: view.x + mid.x * view.zoom, y: view.y + mid.y * view.zoom };
          })()}
          obstacles={Object.values(boxes).map((b) => ({ x: view.x + b.x * view.zoom, y: view.y + b.y * view.zoom, w: b.w * view.zoom, h: b.h * view.zoom }))}
          line={selectedRoute.points.map((p) => ({ x: view.x + p.x * view.zoom, y: view.y + p.y * view.zoom }))}
          area={size}
          blocked={blocked}
          identifying={selectedLink.identifying}
          onIdentifying={(v) => setLinkIdentifying(selectedLink.id, v)}
          dropColumns={dropColumns}
          onDropColumns={setDropColumns}
          onDelete={() => deleteLink(selectedLink.id)}
        />
      )}
      {editor && menu && menuColumn && (
        <CellMenu
          key={`${menu.kind}|${menu.table}|${menu.column}|${menu.fk ? 'fk' : ''}`}
          anchor={() => cellEl(`ie-${menu.kind}-${cellId(menu.table, menu.column)}`)}
          label={
            menu.kind === 'null'
              ? t('sqlView.nullLabel', { table: menu.table, column: menu.column })
              : menu.fk
                ? t('relView.ie.fkTable')
                : t('relView.ie.keyLabel', { table: menu.table, column: menu.column })
          }
          testId={menu.fk ? 'ie-fk-form' : `ie-${menu.kind}-menu`}
          choices={
            menu.kind === 'null'
              ? [
                  { value: 'unset', label: t('sqlView.settings.unset') },
                  { value: 'not-null', label: 'NOT NULL' },
                  { value: 'null', label: 'NULL' },
                ]
              : [
                  { value: 'none', label: t('common.none') },
                  { value: 'pk', label: 'PK' },
                  { value: 'fk', label: 'FK' },
                  { value: 'pkfk', label: 'PK + FK' },
                ]
          }
          current={
            menu.kind === 'null'
              ? menuColumn.notNull === true
                ? 'not-null'
                : menuColumn.notNull === false
                  ? 'null'
                  : 'unset'
              : menuColumn.primaryKey && menuColumn.foreignKey
                ? 'pkfk'
                : menuColumn.primaryKey
                  ? 'pk'
                  : menuColumn.foreignKey
                    ? 'fk'
                    : 'none'
          }
          onPick={pickMenu}
          onClose={closeMenu}
        >
          {menu.fk && (
            <ForeignKeyForm
              model={model}
              table={menu.table}
              onCancel={() => closeMenu(true)}
              onConfirm={(ref) => {
                const problem = editor.setKeys(menu.table, menu.column, { primaryKey: menu.fk!.primaryKey, foreignKey: true, ref });
                if (problem === null) closeMenu(true);
                return problem;
              }}
            />
          )}
        </CellMenu>
      )}
      <div className="panel zoom-controls ie-zoom" role="group" aria-label={t('relView.ie.zoomLabel')}>
        <button type="button" className="btn btn-ghost btn-icon" aria-label={t('common.zoomOut')} title={t('common.zoomOut')} disabled={view.zoom <= MIN_ZOOM} onClick={() => zoomCenter(0.8)}>
          {icons.minus}
        </button>
        <button
          type="button"
          className="btn btn-ghost zoom-controls-level"
          data-testid="ie-zoom-level"
          title={t('view.zoomReset')}
          aria-label={t('view.zoomResetLabel', { percent: Math.round(view.zoom * 100) })}
          onClick={() => zoomCenter(1 / view.zoom)}
        >
          {Math.round(view.zoom * 100)}%
        </button>
        <button type="button" className="btn btn-ghost btn-icon" aria-label={t('common.zoomIn')} title={t('common.zoomIn')} disabled={view.zoom >= MAX_ZOOM} onClick={() => zoomCenter(1.25)}>
          {icons.plus}
        </button>
        <button type="button" className="btn btn-ghost btn-icon" aria-label={t('common.fit')} title={t('common.fit')} onClick={fit}>
          {icons.fit}
        </button>
      </div>
    </div>
  );
}

/** (추가) 고른 관계 아래의 작은 창: 외래키 컬럼도 지울지 고르고 관계를 지운다(묻는 창 없이) */
/** 선분이 사각형과 겹치는지(선분 위 점을 촘촘히 찍어 본다) */
function segmentHitsBox(a: { x: number; y: number }, b: { x: number; y: number }, r: Box): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

/** 창이 놓일 자리: 관계선 가운데 근처에서 테이블을 가리지 않는 첫 자리. 다 가리면 가장 덜 가리는 자리 */
function placePopover(
  mid: { x: number; y: number },
  w: number,
  h: number,
  obstacles: Box[],
  area: { w: number; h: number },
  line: Array<{ x: number; y: number }> = [],
): { left: number; top: number } {
  const gap = 12;
  const candidates: Array<{ left: number; top: number }> = [];
  for (let step = 0; step < 4; step++) {
    const d = gap + step * 36;
    candidates.push({ left: mid.x - w / 2, top: mid.y + d });
    candidates.push({ left: mid.x - w / 2, top: mid.y - d - h });
    candidates.push({ left: mid.x + d, top: mid.y - h / 2 });
    candidates.push({ left: mid.x - d - w, top: mid.y - h / 2 });
  }
  const clamp = (c: { left: number; top: number }) => ({
    left: Math.min(Math.max(c.left, 8), Math.max(8, area.w - w - 8)),
    top: Math.min(Math.max(c.top, 8), Math.max(8, area.h - h - 8)),
  });
  const covered = (c: { left: number; top: number }) => {
    let sum = 0;
    for (const b of obstacles) {
      const ox = Math.min(c.left + w, b.x + b.w) - Math.max(c.left, b.x);
      const oy = Math.min(c.top + h, b.y + b.h) - Math.max(c.top, b.y);
      if (ox > 0 && oy > 0) sum += ox * oy;
    }
    // 고른 선을 가리면 크게 친다(선이 보여야 무엇을 고쳤는지 안다)
    const pad = 6;
    const box = { x: c.left - pad, y: c.top - pad, w: w + pad * 2, h: h + pad * 2 };
    for (let i = 1; i < line.length; i++) if (segmentHitsBox(line[i - 1], line[i], box)) sum += w * h * 4;
    return sum;
  };
  let best = clamp(candidates[0]);
  let bestCover = Infinity;
  for (const raw of candidates) {
    const c = clamp(raw);
    const cover = covered(c);
    if (cover === 0) return c;
    if (cover < bestCover) {
      best = c;
      bestCover = cover;
    }
  }
  return best;
}

function LinkPopover({
  label,
  mid,
  obstacles,
  line,
  area,
  blocked,
  identifying,
  onIdentifying,
  dropColumns,
  onDropColumns,
  onDelete,
}: {
  label: string;
  /** 관계선 가운데(화면 좌표) */
  mid: { x: number; y: number };
  /** 테이블들의 화면 사각형(가리지 않으려고 피한다) */
  obstacles: Box[];
  /** 고른 관계선의 꺾인 점들(화면 좌표). 창이 선을 가리지 않게 피한다 */
  line: Array<{ x: number; y: number }>;
  area: { w: number; h: number };
  blocked: string | null;
  identifying: boolean;
  onIdentifying: (identifying: boolean) => void;
  dropColumns: boolean;
  onDropColumns: (v: boolean) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const key = `${line.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}|${Math.round(mid.x)},${Math.round(mid.y)},${obstacles.map((b) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(';')},${area.w},${area.h}`;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = placePopover(mid, el.offsetWidth, el.offsetHeight, obstacles, area, line);
    setAt((cur) => (cur && cur.left === next.left && cur.top === next.top ? cur : next));
    // key가 같으면 자리도 같다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div
      ref={ref}
      className="ie-link-pop"
      data-testid="ie-link-pop"
      role="group"
      aria-label={label}
      style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <div className="ie-link-pop-mode" role="group" aria-label={t('relView.ie.linkKind')}>
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            className={`ie-link-pop-mode-btn${identifying === v ? ' is-active' : ''}${blocked ? ' is-disabled' : ''}`}
            data-testid={`ie-link-mode-${v ? 'identifying' : 'non-identifying'}`}
            aria-pressed={identifying === v}
            aria-disabled={blocked ? true : undefined}
            title={blocked ?? undefined}
            onClick={() => {
              if (blocked) toast(blocked, 'error');
              else onIdentifying(v);
            }}
          >
            {v ? t('relView.ie.identifying') : t('relView.ie.nonIdentifying')}
          </button>
        ))}
      </div>
      <span className="ie-link-pop-sep" aria-hidden="true" />
      <label className="ie-link-pop-check">
        <input type="checkbox" data-testid="ie-link-drop-columns" checked={dropColumns} onChange={(e) => onDropColumns(e.target.checked)} />
        {t('relView.ie.dropColumns')}
      </label>
      <button
        type="button"
        className={`btn btn-ghost ie-link-pop-delete${blocked ? ' is-disabled' : ''}`}
        data-testid="ie-link-delete"
        aria-disabled={blocked ? true : undefined}
        title={blocked ?? undefined}
        onClick={() => {
          if (blocked) toast(blocked, 'error');
          else onDelete();
        }}
      >
        {ieIcons.trash}
        {t('common.delete')}
      </button>
    </div>
  );
}
