/**
 * 첫 화면 AI 구역 안의 사용 사례: 다른 도구에서 그렸거나 손으로 그린 ERD 그림을 AI가 읽어 modelll에 다시 그린다.
 * 연결 방법(CLI, MCP) 카드와 섞이지 않게 따로 머리글을 두고, 그림 한 장(손그림 사진 → AI → modelll 화면)으로 보여 준다.
 * 복사할 지시문은 그림 아래에 작게 둔다.
 */
import { useId } from 'react';
import { computeEdgeGeometry, diagramBounds, siblingInfo } from '../../shared/geometry';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { EdgeShape } from '../canvas/EdgeShape';
import { NodeShape } from '../canvas/NodeShape';
import { useT, type MessageKey } from '../i18n';
import { Snippet } from './HomeAi';
import { Reveal } from './motion';

/** 손그림과 modelll 화면이 함께 쓰는 도형 자리. 글자는 모든 언어에서 폭 안에 들어간다(Home.test.tsx가 확인한다) */
export const MIGRATE_NODES: ErdNode[] = [
  { id: 'sid', kind: 'attribute', x: 0, y: 16, w: 104, h: 44, text: '', keyType: 'key' },
  { id: 'snm', kind: 'attribute', x: 112, y: 16, w: 96, h: 44, text: '' },
  { id: 'grd', kind: 'attribute', x: 216, y: 16, w: 96, h: 44, text: '' },
  { id: 'cid', kind: 'attribute', x: 356, y: 16, w: 112, h: 44, text: '', keyType: 'key' },
  { id: 'stu', kind: 'entity', x: 8, y: 128, w: 120, h: 56, text: '' },
  { id: 'take', kind: 'relationship', x: 200, y: 116, w: 128, h: 80, text: '' },
  { id: 'crs', kind: 'entity', x: 352, y: 128, w: 120, h: 56, text: '' },
];

export const MIGRATE_TEXT: Record<string, MessageKey> = {
  sid: 'home.sample.studentId',
  snm: 'home.sample.name',
  grd: 'home.sample.grade',
  cid: 'home.sample.courseCode',
  stu: 'home.sample.student',
  take: 'home.sample.enroll',
  crs: 'home.sample.course',
};

const edge = (id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge => ({
  id,
  source,
  target,
  double: false,
  label: '',
  role: '',
  ...extra,
});

const MIGRATE_EDGES: ErdEdge[] = [
  edge('e1', 'stu', 'sid'),
  edge('e2', 'stu', 'snm'),
  edge('e3', 'take', 'grd'),
  edge('e4', 'crs', 'cid'),
  edge('e5', 'stu', 'take', { label: 'M' }),
  edge('e6', 'take', 'crs', { label: 'N' }),
];

const BOUNDS = diagramBounds(MIGRATE_NODES, 12) ?? { x: 0, y: 0, w: 460, h: 200 };
const VIEW = `${BOUNDS.x} ${BOUNDS.y} ${BOUNDS.w} ${BOUNDS.h}`;

const center = (n: ErdNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/** 손으로 그은 듯 살짝 휜 선 */
function wobblyLine(a: { x: number; y: number }, b: { x: number; y: number }, bend: number): string {
  const mx = (a.x + b.x) / 2 + bend;
  const my = (a.y + b.y) / 2 - bend;
  return `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`;
}

/** 공책에 연필로 그린 ERD. 같은 도형을 두 번 겹쳐 긋고 필터로 선을 흔들어 손그림처럼 보이게 한다 */
function SketchErd(props: { label: (id: string) => string }) {
  const filterId = useId().replace(/:/g, '');
  const byId = new Map(MIGRATE_NODES.map((n) => [n.id, n]));
  const node = (id: string) => byId.get(id)!;
  const shape = (n: ErdNode, dx: number, dy: number) => {
    const c = center(n);
    if (n.kind === 'entity') return <rect key={`${n.id}${dx}`} x={n.x + 4 + dx} y={n.y + 4 + dy} width={n.w - 8} height={n.h - 8} rx="2" />;
    if (n.kind === 'relationship')
      return <path key={`${n.id}${dx}`} d={`M${c.x + dx} ${n.y + dy} L${n.x + n.w + dx} ${c.y + dy} L${c.x + dx} ${n.y + n.h + dy} L${n.x + dx} ${c.y + dy} Z`} />;
    return <ellipse key={`${n.id}${dx}`} cx={c.x + dx} cy={c.y + dy} rx={n.w / 2 - 2} ry={n.h / 2 - 3} />;
  };
  // 선은 도형 가장자리 근처에서 끝낸다(손그림이라 정확하지 않아도 된다)
  const lines: Array<[string, string, number]> = [
    ['stu', 'sid', 3],
    ['stu', 'snm', -3],
    ['take', 'grd', 2],
    ['crs', 'cid', -2],
  ];
  return (
    <svg className="home-uc-sketch" viewBox={VIEW} aria-hidden="true" focusable="false">
      <defs>
        <filter id={filterId} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="3.2" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        <g className="home-uc-sketch-lines">
          {lines.map(([a, b, bend]) => {
            const na = node(a);
            const nb = node(b);
            return <path key={`${a}${b}`} d={wobblyLine({ x: center(na).x, y: na.y + 4 }, { x: center(nb).x, y: nb.y + nb.h - 3 }, bend)} />;
          })}
          <path d={wobblyLine({ x: 124, y: 156 }, { x: 200, y: 156 }, 2)} />
          <path d={wobblyLine({ x: 328, y: 156 }, { x: 356, y: 156 }, 1)} />
        </g>
        <g className="home-uc-sketch-shapes">
          {MIGRATE_NODES.map((n) => shape(n, 0, 0))}
        </g>
        <g className="home-uc-sketch-shapes is-second">
          {MIGRATE_NODES.map((n) => shape(n, 1.6, -1.2))}
        </g>
        <g className="home-uc-sketch-text">
          {MIGRATE_NODES.map((n) => {
            const c = center(n);
            return (
              <text key={n.id} x={c.x} y={c.y + 5} textAnchor="middle" textDecoration={n.keyType === 'key' ? 'underline' : undefined}>
                {props.label(n.id)}
              </text>
            );
          })}
          <text x="162" y="148" textAnchor="middle">
            M
          </text>
          <text x="342" y="148" textAnchor="middle">
            N
          </text>
        </g>
      </g>
    </svg>
  );
}

/** modelll 캔버스 부품으로 같은 다이어그램을 깔끔하게 그린 것 */
function CleanErd(props: { label: (id: string) => string }) {
  const nodes = MIGRATE_NODES.map((n) => ({ ...n, text: props.label(n.id) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const siblings = siblingInfo(MIGRATE_EDGES);
  return (
    <svg viewBox={VIEW} aria-hidden="true" focusable="false">
      {MIGRATE_EDGES.map((e) => {
        const source = byId.get(e.source);
        const target = byId.get(e.target);
        if (!source || !target) return null;
        const sib = siblings.get(e.id) ?? { index: 0, count: 1, pair: 1 };
        return <EdgeShape key={e.id} edge={e} geometry={computeEdgeGeometry(e, source, target, sib.index, sib.count, sib.pair)} />;
      })}
      {nodes.map((n) => (
        <NodeShape key={n.id} node={n} />
      ))}
    </svg>
  );
}

export function HomeMigrate() {
  const t = useT();
  const titleId = useId();
  const label = (id: string) => t(MIGRATE_TEXT[id]);
  return (
    <section className="home-uc" aria-labelledby={titleId} data-testid="home-migrate">
      <Reveal>
        <p className="home-uc-eyebrow">{t('home.ai.useCase')}</p>
        <h3 id={titleId} className="home-uc-title">
          {t('home.ai.migrate.title')}
        </h3>
        <p className="home-uc-body">{t('home.ai.migrate.body')}</p>
      </Reveal>

      <Reveal>
        <figure className="home-uc-fig" role="img" aria-label={t('home.ai.migrate.figureLabel')} data-testid="migrate-figure">
          <div className="home-uc-card home-uc-photo">
            <div className="home-uc-bar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <circle cx="9" cy="10" r="1.6" />
                <path d="m21 16-5-5-9 9" />
              </svg>
              <span>{t('home.ai.migrate.from')}</span>
            </div>
            <div className="home-uc-desk">
              <div className="home-uc-paper">
                <i className="home-uc-tape" />
                <SketchErd label={label} />
              </div>
            </div>
          </div>

          <div className="home-uc-ai" aria-hidden="true">
            <span className="home-uc-flow" />
            <span className="home-uc-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.5c.5 4.6 2.9 7 7.5 7.5-4.6.5-7 2.9-7.5 7.5-.5-4.6-2.9-7-7.5-7.5 4.6-.5 7-2.9 7.5-7.5Z" />
                <path d="M19 15.5c.2 1.8 1.1 2.7 2.9 2.9-1.8.2-2.7 1.1-2.9 2.9-.2-1.8-1.1-2.7-2.9-2.9 1.8-.2 2.7-1.1 2.9-2.9Z" />
              </svg>
              AI
            </span>
            <span className="home-uc-flow is-end" />
          </div>

          <div className="home-uc-card home-ai-view">
            <div className="home-ai-view-bar">
              <span className="home-ai-view-title">{t('home.preview.title')}</span>
              <span className="home-pv-saved">{t('status.connected.label')}</span>
            </div>
            <div className="home-ai-canvas home-uc-canvas">
              <CleanErd label={label} />
            </div>
          </div>
        </figure>
      </Reveal>

      <Reveal className="home-uc-prompt">
        <p className="home-uc-prompt-label">{t('home.ai.migrate.promptLabel')}</p>
        <Snippet text={t('home.ai.migrate.prompt')} copyLabel={t('ai.cli.copy')} doneKey="toast.clipboardCopied" testId="home-migrate" />
      </Reveal>
    </section>
  );
}
