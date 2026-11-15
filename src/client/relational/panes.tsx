/**
 * 관계 모델 쪽 pane 세 가지(관계 모델, IE 다이어그램, SQL). ERD pane은 캔버스 쪽에 있다.
 * 흐름: 사람이 적은 관계 모델 글(방의 Y.Text) → IE(글과 컬럼 설정에서 유도) → SQL(같은 것에서 변환).
 * ERD에서 관계 모델을 자동으로 만들지 않고, 글에 없는 것(타입, NULL 허용 여부)은 추측하지 않는다.
 * 각 pane은 어떤 크기의 틀에 넣어도 부모를 가득 채우고, 다른 pane이 열려 있다고 가정하지 않는다.
 *
 * 이 파일은 엔진을 함께 가져온다. 방 화면은 이 파일을 따로 내려받고(lazy), 탭 제목과 아이콘은 paneMeta.tsx 에서 바로 가져온다.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { copyText } from '../ai';
import { useRoom, useTitle } from '../collab/hooks';
import { safeFilename } from '../export/exporters';
import { useT, type MessageKey } from '../i18n';
import { toast } from '../ui/toast';
import { downloadText, icons, ProblemIcon } from './common';
import {
  applyRelationalEdit,
  columnKey,
  deriveIe,
  getColumnSettingsMap,
  getIePositionsMap,
  getRelationalText,
  layoutIe,
  parseRelational,
  planRenameColumn,
  planRenameTable,
  planSetKeys,
  planSetIdentifying,
  planRepairKeys,
  countRepairableKeys,
  nameKey,
  planAddTable,
  planDeleteTable,
  planAddColumn,
  planDeleteColumn,
  planAddRelationship,
  planDeleteRelationship,
  readColumnSettings,
  readIePositions,
  setIePosition,
  readRelationalSource,
  setColumnSetting,
  toSql,
  type ColumnSettings,
  type RelEditError,
  type RelEditPlan,
  type IeModel,
  type IePositions,
  type ParseResult,
  type RelProblem,
} from './engine';
import { IeDiagram, type IeEditor } from './IeDiagram';
import { PaneFrame, isNarrow, useFrame } from './paneParts';
import { DIALECT_LABEL, DialectSelect, useDialect } from './DialectSelect';
import { revealInEditor } from './paneStore';
import { RelationalEditor, useYSource, type EditorHandle } from './RelationalEditor';
import { TYPE_OPTIONS } from './pickers';
import { ColumnSettingsTable, SqlCode, type SettingsTable } from './SqlParts';
import { UNDERLINE_KEYS } from './yTextBinding';
import { track } from '../telemetry';

export { paneTitleKey, PaneIcon } from './paneMeta';

/** SQL pane에서 SQL과 컬럼 설정 표를 나란히 두는 너비 */
const SQL_SIDE = 820;

// ───────────────────────── 방 문서 읽기 ─────────────────────────

/** 방 문서의 컬럼 설정. 내용이 바뀔 때만 새 객체가 된다 */
export function useColumnSettings(): ColumnSettings {
  const room = useRoom();
  const [state, setState] = useState(() => {
    const settings = readColumnSettings(room.doc);
    return { settings, json: JSON.stringify(settings) };
  });
  useEffect(() => {
    const update = () => {
      const settings = readColumnSettings(room.doc);
      const json = JSON.stringify(settings);
      setState((cur) => (cur.json === json ? cur : { settings, json }));
    };
    update();
    room.doc.on('update', update);
    return () => room.doc.off('update', update);
  }, [room]);
  return state.settings;
}

export interface RelationalModel {
  text: string;
  parsed: ParseResult;
  settings: ColumnSettings;
  /** 글이 비어 있지 않은지(비었으면 빈 화면 한 줄을 보여 준다) */
  hasText: boolean;
}

/** 관계 모델 글을 읽고 컬럼 설정과 함께 돌려준다. 누가 고치든 바로 다시 읽는다 */
export function useRelationalModel(): RelationalModel {
  const room = useRoom();
  const ytext = useMemo(() => getRelationalText(room.doc), [room]);
  // 밑줄(기본키)도 함께 읽는다. 밑줄만 바꿔도 IE와 SQL이 따라온다
  const source = useYSource(ytext);
  const parsed = useMemo(() => parseRelational(source), [source]);
  const settings = useColumnSettings();
  const text = source.text;
  return { text, parsed, settings, hasText: text.trim() !== '' };
}

async function copyWithToast(text: string, done: string, failed: string): Promise<void> {
  if (await copyText(text)) toast(done);
  else toast(failed, 'error');
}

/** 머리 줄의 아이콘 버튼(좁은 머리 줄에서는 글자를 숨긴다) */
function HeadButton({ icon, label, testId, disabled, onClick }: { icon: ReactNode; label: string; testId: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost rp-btn" data-testid={testId} title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      {icon}
      <span className="rp-btn-label">{label}</span>
    </button>
  );
}

/** 글이 없을 때의 한 줄 */
function EmptyLine({ testId }: { testId: string }) {
  const t = useT();
  return (
    <p className="rel-empty" data-testid={testId}>
      {t('relView.empty')}
    </p>
  );
}

// ───────────────────────── 관계 모델(글) ─────────────────────────

/**
 * 관계 모델을 수업 표기로 적는 편집기. 팀원과 같은 글을 함께 고친다.
 * 머리 줄에는 밑줄 버튼 하나만 있다(기본키에 밑줄을 긋는다). 그 밖의 안내는 두지 않는다.
 */
export function RelationalTextPane() {
  const t = useT();
  const room = useRoom();
  const ytext = useMemo(() => getRelationalText(room.doc), [room]);
  const source = useYSource(ytext);
  const problems = useMemo(() => parseRelational(source).problems, [source]);
  const { frameRef, width } = useFrame();
  const editor = useRef<EditorHandle>(null);
  const [underlined, setUnderlined] = useState(false);
  const label = t('relView.editor.underline');
  const tools = (
    <button
      type="button"
      className={`btn btn-ghost rp-btn rel-ul-btn${underlined ? ' is-active' : ''}`}
      data-testid="relational-underline"
      aria-label={label}
      aria-pressed={underlined}
      title={t('relView.editor.underlineHint', { keys: UNDERLINE_KEYS })}
      // 누를 때 편집기의 캐럿과 고른 구간을 그대로 둔다
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => editor.current?.toggleUnderline()}
    >
      {icons.underline}
      <span className="rp-btn-label">{label}</span>
    </button>
  );
  return (
    <PaneFrame pane="relational" frameRef={frameRef} width={width} narrow={false} tools={tools} toolsLabel={t('relPane.title.relational')} bodyClass="rp-body-flush">
      <RelationalEditor
        ytext={ytext}
        source={source}
        problems={problems}
        placeholder={t('relView.editor.placeholder')}
        label={t('relPane.title.relational')}
        handle={editor}
        onUnderlineState={setUnderlined}
      />
    </PaneFrame>
  );
}

// ───────────────────────── IE 다이어그램 ─────────────────────────

/** 문제 개수 배지. 누르면 편집기의 첫 문제로 간다 */
export function ProblemBadge({ problems }: { problems: readonly RelProblem[] }) {
  const t = useT();
  if (problems.length === 0) return null;
  const errors = problems.filter((p) => p.severity === 'error').length;
  const first = [...problems].sort((a, b) => a.line - b.line || a.column - b.column)[0];
  const warnings = problems.length - errors;
  const label = `${t('count.errors', { count: errors })}, ${t('count.warnings', { count: warnings })}`;
  return (
    <button
      type="button"
      className={`rel-problem-badge is-${errors > 0 ? 'error' : 'warning'}`}
      data-testid="ie-problem-badge"
      aria-label={label}
      title={label}
      onClick={() => revealInEditor({ line: first.line, column: first.column, endColumn: first.endColumn })}
    >
      <span className={`rel-problem-count${errors > 0 ? ' is-on' : ''}`}>
        <ProblemIcon severity="error" />
        {errors}
      </span>
      <span className={`rel-problem-count${warnings > 0 ? ' is-on' : ''}`}>
        <ProblemIcon severity="warning" />
        {warnings}
      </span>
    </button>
  );
}

/** (추가) 기본키와 어긋난 외래키를 한 번에 지금 기본키에 맞춘다. 고칠 수 있는 것이 있을 때만 보인다(되돌리기 한 번) */
function RepairKeysButton() {
  const t = useT();
  const room = useRoom();
  const ytext = useMemo(() => getRelationalText(room.doc), [room]);
  const source = useYSource(ytext);
  const count = useMemo(() => countRepairableKeys(source), [source]);
  if (count === 0) return null;
  const label = t('relView.ie.repairKeys');
  return (
    <button
      type="button"
      className="rel-problem-badge"
      data-testid="ie-repair-keys"
      title={label}
      onClick={() => {
        const plan = planRepairKeys(readRelationalSource(room.doc));
        if (!plan.ok) toast(t(EDIT_ERROR_KEY[plan.error]), 'error');
        else applyRelationalEdit(room.doc, plan, IE_ORIGIN);
      }}
    >
      {label}
    </button>
  );
}

/** IE 그림에서 고친 것의 origin. 그림의 되돌리기(⌘Z)는 이 origin의 변경만 되돌린다 */
export const IE_ORIGIN = 'ie-edit';

const EDIT_ERROR_KEY: Record<RelEditError, MessageKey> = {
  'text-errors': 'relView.ie.error.textErrors',
  'not-found': 'relView.ie.error.notFound',
  empty: 'relView.ie.error.empty',
  chars: 'relView.ie.error.chars',
  duplicate: 'relView.ie.error.duplicate',
  breaks: 'relView.ie.error.breaks',
  composite: 'relView.ie.error.composite',
  'no-primary-key': 'relView.ie.error.noPrimaryKey',
  'key-cycle': 'relView.ie.error.keyCycle',
};

/** (추가) 방 문서의 IE 상자 자리. 누가 옮기든 바로 다시 읽는다 */
function useIePositions(): IePositions {
  const room = useRoom();
  const [state, setState] = useState(() => {
    const positions = readIePositions(room.doc);
    return { positions, json: JSON.stringify(positions) };
  });
  useEffect(() => {
    const map = getIePositionsMap(room.doc);
    const update = () => {
      const positions = readIePositions(room.doc);
      const json = JSON.stringify(positions);
      setState((cur) => (cur.json === json ? cur : { positions, json }));
    };
    update();
    map.observe(update);
    return () => map.unobserve(update);
  }, [room]);
  return state.positions;
}

/**
 * IE 그림 안 편집. 이름, 기본키, 테이블, 컬럼, 관계는 관계 모델 글을 고치고(글이 원본, IE는 글에서 다시 유도된다),
 * 타입과 NULL은 컬럼 설정을, 상자 자리는 IE 자리를 고친다. 모두 방 문서라 팀원에게 바로 보인다.
 * 모두 IE_ORIGIN으로 고쳐서 그림 전용 되돌리기와 사용 통계(ie_edit)가 알아본다.
 */
function useIeEditor(): IeEditor {
  const t = useT();
  const room = useRoom();
  const undoRef = useRef<Y.UndoManager | null>(null);
  useEffect(() => {
    const undo = new Y.UndoManager([getRelationalText(room.doc), getColumnSettingsMap(room.doc), getIePositionsMap(room.doc)], {
      trackedOrigins: new Set([IE_ORIGIN]),
      captureTimeout: 0,
    });
    undoRef.current = undo;
    return () => {
      undo.destroy();
      if (undoRef.current === undo) undoRef.current = null;
    };
  }, [room]);
  return useMemo(() => {
    const doc = room.doc;
    const message = (error: RelEditError) => t(EDIT_ERROR_KEY[error]);
    const run = (plan: RelEditPlan): string | null => {
      if (!plan.ok) return message(plan.error);
      applyRelationalEdit(doc, plan, IE_ORIGIN);
      return null;
    };
    const source = () => readRelationalSource(doc);
    const linkChild = (linkId: string) => linkId.replace(/#fk\d+$/, '');
    const editor: IeEditor = {
      setColumn: (table, column, patch) => (setColumnSetting(doc, table, column, patch, IE_ORIGIN) ? null : t('relView.ie.typeInvalid')),
      renameColumn: (table, column, next) => run(planRenameColumn(source(), table, column, next)),
      renameTable: (table, next) => run(planRenameTable(source(), table, next)),
      setKeys: (table, column, want) => run(planSetKeys(source(), table, column, want)),
      addTable: (at) => {
        const plan = planAddTable(source());
        if (!plan.ok) return { ok: false, message: message(plan.error) };
        // 글과 자리를 한 번에 고친다(되돌리기 한 번에 함께 돌아간다)
        doc.transact(() => {
          applyRelationalEdit(doc, plan, IE_ORIGIN);
          setIePosition(doc, plan.table, at, IE_ORIGIN);
        }, IE_ORIGIN);
        return { ok: true, table: plan.table };
      },
      deleteTable: (table) => run(planDeleteTable(source(), table)),
      addColumn: (table) => {
        const plan = planAddColumn(source(), table);
        if (!plan.ok) return { ok: false, message: message(plan.error) };
        applyRelationalEdit(doc, plan, IE_ORIGIN);
        return { ok: true, column: plan.column };
      },
      deleteColumn: (table, column) => run(planDeleteColumn(source(), table, column)),
      addRelationship: (child, parent, identifying) => {
        const plan = planAddRelationship(source(), child, parent, { identifying });
        if (!plan.ok) return { ok: false, message: message(plan.error) };
        applyRelationalEdit(doc, plan, IE_ORIGIN);
        return { ok: true, link: `${child}#fk${plan.fkIndex + 1}` };
      },
      deleteRelationship: (linkId, dropColumns) => run(planDeleteRelationship(source(), linkChild(linkId), linkId, { dropColumns })),
      setIdentifying: (child, columns, identifying) => {
        // 식별 관계는 외래키 컬럼이 모두 자식의 기본키다. 자식의 기본키가 바뀌므로 자식을 가리키는 외래키로 전파한다
        // (planSetIdentifying, 한 트랜잭션이라 되돌리기 한 번에 돌아간다). 그림은 선의 컬럼 목록을 넘기므로 그것으로 외래키를 찾는다
        const src = source();
        const def = parseRelational(src).schema.tables.find((t) => nameKey(t.name) === nameKey(child));
        const same = (fk: { columns: string[] }) => fk.columns.length === columns.length && fk.columns.every((c, i) => nameKey(c) === nameKey(columns[i]));
        const index = def ? def.foreignKeys.findIndex(same) : -1;
        if (index < 0) return message('not-found');
        return run(planSetIdentifying(src, child, index, identifying));
      },
      moveTables: (points) => {
        doc.transact(() => {
          for (const [table, p] of Object.entries(points)) setIePosition(doc, table, { x: Math.round(p.x), y: Math.round(p.y) }, IE_ORIGIN);
        }, IE_ORIGIN);
      },
      resetPositions: () => {
        const map = getIePositionsMap(doc);
        if (map.size === 0) return false;
        doc.transact(() => {
          for (const key of [...map.keys()]) map.delete(key);
        }, IE_ORIGIN);
        return true;
      },
      transact<T>(fn: () => T): T {
        let out!: T;
        doc.transact(() => {
          out = fn();
        }, IE_ORIGIN);
        return out;
      },
      undo: (redo) => {
        const u = undoRef.current;
        if (!u) return;
        if (redo) u.redo();
        else u.undo();
      },
    };
    return editor;
  }, [room, t]);
}

/**
 * 관계 모델 글에서 유도한 IE(까마귀발) 그림. 확대 버튼은 그림 위에 있고 DBMS는 위쪽 바에서 고른다. 그림 안에서 타입, NULL, 기본키, 이름을 고치고
 * (추가) 테이블, 컬럼, 관계를 더하고 지우며 상자를 옮긴다. 글이 비어 있어도 그림에서 바로 시작할 수 있다.
 * 글에 오류가 있어도 막지 않는다(IE와 관계 모델은 같은 것이다). 고칠 동작이 새 오류를 만들 때만 그 동작을 알리고 하지 않는다.
 * 기본키와 어긋난 외래키가 있으면 문제 배지 옆에 '자동으로 맞추기'를 보인다(planRepairKeys).
 */
export function IePane() {
  const { parsed, settings } = useRelationalModel();
  const model = useMemo(() => deriveIe(parsed.schema, settings), [parsed.schema, settings]);
  const positions = useIePositions();
  const layout = useMemo(() => layoutIe(model, positions), [model, positions]);
  const editor = useIeEditor();
  const t = useT();
  const dialect = useDialect();
  const { frameRef, width } = useFrame();
  return (
    <PaneFrame
      pane="ie"
      frameRef={frameRef}
      width={width}
      narrow={false}
      bodyClass="rp-body-fill rp-body-flush"
      attrs={{ 'data-dialect': dialect }}
    >
      <IeDiagram
        model={model}
        layout={layout}
        editor={editor}
        typeOptions={TYPE_OPTIONS[dialect]}
        tools={<DialectSelect testId="ie-dialect-select" className="dialect-select-compact" />}
        overlay={
          <>
            <ProblemBadge problems={parsed.problems} />
            <RepairKeysButton />
          </>
        }
      />
    </PaneFrame>
  );
}

// ───────────────────────── SQL ─────────────────────────

/** 표에 넣을 테이블과 컬럼(글에 적은 순서, 같은 이름은 처음 것만) */
function settingsTables(parsed: ParseResult, settings: ColumnSettings, ie: IeModel, missing: Set<string>): SettingsTable[] {
  const inherited = new Map<string, string>();
  for (const table of ie.tables) for (const c of table.columns) if (c.inheritedType) inherited.set(columnKey(table.name, c.name), c.inheritedType);
  const seen = new Set<string>();
  const out: SettingsTable[] = [];
  for (const table of parsed.schema.tables) {
    if (seen.has(table.name)) continue;
    seen.add(table.name);
    const cols = new Set<string>();
    const columns = [];
    for (const c of table.columns) {
      if (cols.has(c.name)) continue;
      cols.add(c.name);
      const key = columnKey(table.name, c.name);
      columns.push({
        name: c.name,
        primaryKey: c.primaryKey,
        setting: settings[key] ?? {},
        inheritedType: inherited.get(key) ?? null,
        missingType: missing.has(key),
      });
    }
    out.push({ name: table.name, columns });
  }
  return out;
}

/** 타입을 정하지 않은 컬럼 수. 누르면 표의 첫 칸으로 간다 */
export function MissingTypesLine({ count, onGo }: { count: number; onGo: () => void }) {
  const t = useT();
  if (count === 0) return null;
  return (
    <button type="button" className="sql-missing" data-testid="sql-missing-types" onClick={onGo}>
      {icons.info}
      {t('sqlView.missingTypes', { count })}
    </button>
  );
}

/** CREATE TABLE 문과 컬럼 설정 표. 넓으면 나란히, 좁으면 위아래로 쌓는다 */
export function SqlPane() {
  const t = useT();
  const room = useRoom();
  const title = useTitle();
  const { parsed, settings, hasText } = useRelationalModel();
  const dialect = useDialect();
  const result = useMemo(() => toSql(parsed.schema, settings, dialect, { title }), [parsed.schema, settings, dialect, title]);
  const missing = useMemo(() => new Set(result.missingTypes.map((m) => columnKey(m.table, m.column))), [result]);
  const ie = useMemo(() => deriveIe(parsed.schema, settings), [parsed.schema, settings]);
  const tables = useMemo(() => settingsTables(parsed, settings, ie, missing), [parsed, settings, ie, missing]);
  const { frameRef, width } = useFrame();
  const stacked = isNarrow(width, SQL_SIDE);
  const empty = !hasText;

  const goMissing = () => {
    const input = frameRef.current?.querySelector<HTMLInputElement>('.sql-type-input[data-missing]');
    if (!input) return;
    input.scrollIntoView?.({ block: 'center' });
    input.focus({ preventScroll: true });
  };

  const tools = (
    <>
      {/* 방 전체가 함께 쓰는 DBMS(IE의 타입 목록과 SQL이 따른다) */}
      <DialectSelect className="dialect-select-compact" />
      <HeadButton
        icon={icons.copy}
        label={t('sqlView.copy')}
        testId="sql-copy"
        disabled={empty}
        onClick={() => {
          track('sql_copy', { r: room.id });
          void copyWithToast(result.sql, t('sqlView.copied'), t('toast.clipboardFailed'));
        }}
      />
      <HeadButton
        icon={icons.download}
        label={t('sqlView.download')}
        testId="sql-download"
        disabled={empty}
        onClick={() => {
          const name = `${safeFilename(title)}.sql`;
          if (downloadText(result.sql, name, 'application/sql')) {
            toast(t('sqlView.downloaded', { file: name }));
            track('sql_download', { r: room.id });
          } else toast(t('sqlView.downloadFailed'), 'error');
        }}
      />
    </>
  );

  return (
    <PaneFrame
      pane="sql"
      frameRef={frameRef}
      width={width}
      narrow={stacked}
      tools={tools}
      toolsLabel={t('relPane.title.sql')}
      bodyClass={stacked || empty ? undefined : 'rp-body-fill'}
      attrs={{ 'data-dialect': dialect }}
    >
      {empty ? (
        <EmptyLine testId="sql-empty" />
      ) : (
        <>
          <MissingTypesLine count={result.missingTypes.length} onGo={goMissing} />
          <div className="sql-body" data-testid="sql-body" data-layout={stacked ? 'stack' : 'side'}>
            <section className="sql-main" aria-label={DIALECT_LABEL[dialect]}>
              <SqlCode sql={result.sql} />
            </section>
            <ColumnSettingsTable
              tables={tables}
              typeOptions={TYPE_OPTIONS[dialect]}
              onChange={(table, column, patch) => setColumnSetting(room.doc, table, column, patch)}
            />
          </div>
        </>
      )}
    </PaneFrame>
  );
}
