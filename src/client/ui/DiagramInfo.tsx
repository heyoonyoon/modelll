/**
 * 아무것도 선택하지 않았을 때 오른쪽 위에 뜨는 다이어그램 패널(제목, 보기 설정, 검증).
 * 검증은 개수만 보이고, 누르면 문제 목록이 한 줄씩 펼쳐진다. 한 줄을 누르면 전체 문장이 보이고 그 도형으로 화면이 옮겨 간다.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEdges, useNodes, useTitle } from "../collab/hooks";
import { tSentence, useT } from "../i18n";
import { ui, useUi } from "../state/ui";
import {
  countIssues,
  ErrorIcon,
  focusIssueElements,
  OkIcon,
  useIssues,
  WarningIcon,
} from "./IssuesPanel";
import "./DiagramInfo.css";

function RowIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="di-row-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const GRID_ICON = (
  <RowIcon>
    <g fill="currentColor" stroke="none">
      {[3.5, 8, 12.5].flatMap((y) =>
        [3.5, 8, 12.5].map((x) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />
        )),
      )}
    </g>
  </RowIcon>
);
const SNAP_ICON = (
  <RowIcon>
    <path d="M3 1.5v13" />
    <rect x="5.5" y="3" width="8" height="3.5" rx="0.5" />
    <rect x="5.5" y="9.5" width="5" height="3.5" rx="0.5" />
  </RowIcon>
);
const MINIMAP_ICON = (
  <RowIcon>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <rect
      x="8"
      y="8"
      width="4.5"
      height="3.5"
      rx="0.5"
      fill="currentColor"
      stroke="none"
    />
  </RowIcon>
);

function SwitchRow({
  icon,
  label,
  on,
  onChange,
  testId,
}: {
  icon: ReactNode;
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="di-row"
      data-testid={testId}
      onClick={() => onChange(!on)}
    >
      {icon}
      <span className="di-row-label">{label}</span>
      <span className={`di-switch${on ? " is-on" : ""}`} aria-hidden="true" />
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`di-chevron${open ? " is-open" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path
        d="m4.5 3 3 3-3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IssuesSection() {
  const t = useT();
  const nodes = useNodes();
  const edges = useEdges();
  const issues = useIssues();
  const { errors, warnings } = useMemo(() => countIssues(issues), [issues]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
        ui().setHighlight([]);
      }
    },
    [],
  );

  const none = issues.length === 0;
  return (
    <div className="di-section">
      <button
        type="button"
        className="di-row di-issues-head"
        data-testid="di-issues-head"
        aria-expanded={!none && open}
        disabled={none}
        title={none ? t("issues.empty") : undefined}
        onClick={() => setOpen(!open)}
      >
        <RowIcon>
          <circle cx="8" cy="8" r="6" />
          <path d="m5.5 8.2 1.8 1.8 3.4-3.8" />
        </RowIcon>
        <span className="di-row-label">{t("issues.title")}</span>
        {none ? (
          <span className="di-ok" data-testid="issues-empty">
            <OkIcon />
          </span>
        ) : (
          <>
            {errors > 0 && (
              <span
                className="di-count is-error"
                data-testid="issues-error-count"
                aria-label={t("count.errors", { count: errors })}
              >
                {errors > 99 ? "99+" : errors}
              </span>
            )}
            {warnings > 0 && (
              <span
                className="di-count is-warning"
                data-testid="issues-warning-count"
                aria-label={t("count.warnings", { count: warnings })}
              >
                {warnings > 99 ? "99+" : warnings}
              </span>
            )}
            <Chevron open={open} />
          </>
        )}
      </button>
      {open && !none && (
        <ul className="di-issues" data-testid="di-issues">
          {issues.map((issue) => {
            const isOpen = expanded === issue.id;
            const text = tSentence(issue.message);
            return (
              <li key={issue.id}>
                <button
                  type="button"
                  className={`di-issue is-${issue.severity}${isOpen ? " is-open" : ""}`}
                  data-testid="issue-item"
                  data-severity={issue.severity}
                  aria-expanded={isOpen}
                  title={isOpen ? undefined : text}
                  onClick={() => {
                    setExpanded(isOpen ? null : issue.id);
                    if (!isOpen)
                      focusIssueElements(issue, nodes, edges, timer, false);
                  }}
                >
                  {issue.severity === "error" ? <ErrorIcon /> : <WarningIcon />}
                  <span className="sr-only">
                    {issue.severity === "error"
                      ? t("common.error")
                      : t("common.warning")}
                  </span>
                  <span className="di-issue-msg">{text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const COLLAPSE_KEY = "modelll.diagramInfo.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 접힌 상태에서도 오류와 경고 개수는 제목 옆에 보인다 */
function CollapsedCounts() {
  const issues = useIssues();
  const { errors, warnings } = useMemo(() => countIssues(issues), [issues]);
  return (
    <>
      {errors > 0 && (
        <span className="di-count is-error">
          {errors > 99 ? "99+" : errors}
        </span>
      )}
      {warnings > 0 && (
        <span className="di-count is-warning">
          {warnings > 99 ? "99+" : warnings}
        </span>
      )}
    </>
  );
}

export function DiagramInfo() {
  const t = useT();
  const title = useTitle();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // 저장이 막혀 있어도 지금 화면에서는 접힌다
    }
  };
  const showGrid = useUi((s) => s.showGrid);
  const snapEnabled = useUi((s) => s.snapEnabled);
  const minimapOpen = useUi((s) => s.panels.minimap);
  const name = title || t("doc.untitled");
  return (
    <aside
      className={`panel di${collapsed ? " is-collapsed" : ""}`}
      data-testid="diagram-info"
      aria-label={t("doc.titleLabel")}
    >
      <button
        type="button"
        className="di-head"
        data-testid="di-collapse"
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
      >
        <h2 className="di-title">{name}</h2>
        {collapsed && <CollapsedCounts />}
        <svg
          className={`di-head-chevron${collapsed ? "" : " is-open"}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path
            d="m3 4.5 3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {!collapsed && (
        <div className="di-body">
          <div className="di-section">
            <h3 className="di-section-title">{t("view.section")}</h3>
            <SwitchRow
              icon={GRID_ICON}
              label={t("view.grid")}
              testId="toggle-grid"
              on={showGrid}
              onChange={(on) => ui().setShowGrid(on)}
            />
            <SwitchRow
              icon={SNAP_ICON}
              label={t("view.snap")}
              testId="toggle-snap"
              on={snapEnabled}
              onChange={(on) => ui().setSnapEnabled(on)}
            />
            <SwitchRow
              icon={MINIMAP_ICON}
              label={t("view.minimap")}
              testId="toggle-minimap"
              on={minimapOpen}
              onChange={(on) => ui().togglePanel("minimap", on)}
            />
          </div>
          <IssuesSection />
        </div>
      )}
    </aside>
  );
}
