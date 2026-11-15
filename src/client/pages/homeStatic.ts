/**
 * 스크립트를 돌리지 않고 HTML만 읽는 로봇(GPTBot, ClaudeBot, PerplexityBot 같은 AI 검색 로봇과 링크 미리보기)에게 줄 첫 화면 글.
 * 빌드할 때 vite.config.ts가 이 글을 index.html의 #root 안에 넣고, 구조화 데이터(JSON-LD)도 여기서 만든다.
 *
 * - 첫 화면(Home.tsx)과 같은 내용이다. 문장은 영어 사전(en.ts)의 첫 화면 문장을 그대로 쓰므로 화면 문구가 바뀌면 같이 바뀐다.
 *   사전에 없는 것은 표기 목록(HomeNotation의 영어 이름)과 자주 묻는 질문뿐이다.
 * - 스크립트가 켜진 브라우저에서는 index.html의 스타일이 이 글을 숨기고, React가 #root를 그리면서 지운다(createRoot는 안의 내용을 비운다).
 *   그래서 사람에게는 비치지 않고, 스크립트가 꺼진 브라우저에서만 보인다(index.html의 noscript 스타일).
 * - 자주 묻는 질문(HOME_FAQ)은 FAQPage 구조화 데이터와 public/llms-full.txt에도 같은 글로 들어간다(homeStatic.test.ts가 맞춰 본다).
 *
 * 브라우저 코드에서는 가져오지 않는다(빌드 설정과 테스트만 쓴다).
 */
import { APP_NAME } from '../../shared/app';
import { formatMessage, type MessageParams } from '../i18n/format';
import type { Dictionary, MessageKey } from '../i18n/locales/ko';

export const SITE_URL = 'https://modelll.app/';
export const REPO_URL = 'https://github.com/heyoonyoon/modelll';
export const NPM_URL = 'https://www.npmjs.com/package/modelll';
export const MCP_URL = 'https://modelll.app/mcp';

/** 스크립트를 돌리지 않는 로봇이 읽는 제목(60자 아래)과 설명(160자 아래). 화면이 뜨면 제목은 home.pageTitle로 바뀐다 */
export const PAGE_TITLE = `Real-time ERD Tool: Chen, IE (Crow's Foot) & AI | ${APP_NAME}`;
export const PAGE_DESCRIPTION =
  'Free real-time ERD tool for Chen and IE (crow’s foot) diagrams. Edit with your team, let AI like ChatGPT or Claude work via MCP or CLI, and get SQL.';
/** 링크 미리보기(og, twitter)에 쓰는 설명. 길이 제한이 덜해 DBMS 이름까지 적는다 */
export const SHARE_DESCRIPTION =
  'A real-time ERD tool for your team: draw Chen or IE (crow’s foot) diagrams together, connect ChatGPT or Claude through MCP or the CLI, and generate SQL for MySQL, PostgreSQL, or Oracle. Free, no sign-up.';

/** 자주 묻는 질문. 사실만 적는다(기능이 바뀌면 여기와 llms-full.txt를 같이 고친다) */
export const HOME_FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: `What is ${APP_NAME}?`,
    a: `${APP_NAME} is a free online database design tool that runs in the browser. It covers all three steps of database modeling in one place: a conceptual ER diagram in Chen notation, a logical relational model with a live IE (crow's foot) diagram, and physical CREATE TABLE SQL for MySQL, PostgreSQL, and Oracle. Your team edits the same diagram in real time, and AI assistants such as ChatGPT and Claude can create and edit it too.`,
  },
  {
    q: `Is ${APP_NAME} free? Do I need an account?`,
    a: `Yes, it is free and there is no sign-up. Create a diagram, pick a name and a color when you enter, and start drawing. ${APP_NAME} is open source under the MIT license.`,
  },
  {
    q: 'How do I draw an ER diagram together with my team in real time?',
    a: 'Create a diagram and share its link. A link is the room: anyone who has it joins right away and edits the same canvas, with everyone’s pointers and selections shown live. Up to 15 people can be in one room.',
  },
  {
    q: 'Does it support Chen notation?',
    a: 'Yes. Entities, weak entities, relationships, identifying relationships, attributes, key and partial key attributes, multivalued and composite attributes, cardinality, total and partial participation, and disjoint or overlapping specialization are all drawn in Chen notation. A checks list points out problems such as an entity without a key, a missing cardinality, or a weak entity without an identifying relationship.',
  },
  {
    q: 'Can I turn an ER diagram into SQL for MySQL, PostgreSQL, or Oracle?',
    a: `Yes, through the relational model. You write the relational model as text, such as Student (Student ID, Name, Dept code), underline primary keys, and add a Foreign Key line for each foreign key. ${APP_NAME} draws it live as an IE diagram, where you set column types, NOT NULL, and UNIQUE, and then generates CREATE TABLE statements for MySQL, PostgreSQL, or Oracle. Nothing is converted from the ER diagram behind your back, and types you have not set are flagged instead of guessed. Copy the SQL or download it as a .sql file.`,
  },
  {
    q: 'Does it draw IE (crow’s foot) diagrams?',
    a: 'Yes. The relational model you write is drawn as an IE diagram with crow’s foot line ends (exactly one, one or many, zero or one, zero or many) and identifying or non-identifying relationship lines. The IE diagram is editable: set each column’s type and NULL right on it.',
  },
  {
    q: `Can ChatGPT or Claude create an ER diagram in ${APP_NAME}?`,
    a: `Yes. A diagram can be read and written as plain text with no coordinates, so an AI assistant can add and change entities and relationships itself while everyone in the room watches the changes appear. Connect a chat assistant such as claude.ai, ChatGPT, or Cursor to the remote MCP server at ${MCP_URL}, or let an assistant that can run commands, such as Claude Code, Cursor, or Codex, use the command-line tool with npx -y ${APP_NAME}.`,
  },
  {
    q: `How do I connect the ${APP_NAME} MCP server?`,
    a: `Add ${MCP_URL} as a remote MCP server or connector in a client that supports it. It uses Streamable HTTP with no sign-in and nothing to install. In Claude Code, run: claude mcp add --transport http ${APP_NAME} ${MCP_URL}. The server offers tools to create, read, update, and validate diagrams, print the text format, and return the relational model as SQL.`,
  },
  {
    q: 'Can I import an existing ERD from draw.io, ERDCloud, or another tool?',
    a: `Yes, with an AI assistant. Save the ERD as an image (a screenshot, an exported PNG, or a photo of a hand drawing), attach it to your assistant with the prompt shown on the page, and it reads the entities, relationships, attributes, and cardinalities and redraws them in ${APP_NAME}.`,
  },
  {
    q: `How is ${APP_NAME} different from other ERD tools such as ERDCloud, draw.io, or dbdiagram.io?`,
    a: `Many ERD tools draw only crow’s foot tables, and general drawing tools make you build Chen shapes such as double diamonds and dashed underlines by hand. ${APP_NAME} draws Chen notation as taught in database courses, keeps the conceptual ER diagram, the relational model, the IE diagram, and SQL side by side in one place, lets your team edit together through a link with no sign-up, and lets AI assistants edit the same diagram through MCP or a CLI.`,
  },
  {
    q: 'How can I export or keep my diagram?',
    a: 'Export the ER diagram as PNG or SVG, copy it to the clipboard, or save a JSON backup. A diagram that nobody opens for 30 days is deleted automatically, so save a JSON backup of anything you want to keep.',
  },
  {
    q: 'Which languages does the interface support?',
    a: 'The interface is available in 10 languages: English, Korean, Japanese, Simplified Chinese, Traditional Chinese, Spanish, French, German, Brazilian Portuguese, and Vietnamese.',
  },
];

/** 첫 화면의 표기 소개(HomeNotation)에 나오는 항목. 영어 이름과 모양 */
const NOTATION: ReadonlyArray<{ title: string; items: ReadonlyArray<string> }> = [
  {
    title: 'ER diagram (Chen notation)',
    items: [
      'Entity type: a rectangle',
      'Weak entity type: a double rectangle',
      'Relationship type: a diamond',
      'Identifying relationship type: a double diamond',
      'Attribute: an ellipse',
      'Key attribute (identifier): an underlined name',
      'Partial key: a dashed underline',
      'Multivalued attribute: a double ellipse',
      'Partial and total participation: a single line and a double line',
      'Disjoint and overlapping specialization: a small circle with d or o',
    ],
  },
  {
    title: 'Relational model',
    items: [
      'Table: Student (Student ID, Name, Dept code), with primary key columns underlined',
      'Composite primary key: Enrolls (Student ID, Course code, Grade) with two underlined columns',
      'Foreign key: Foreign Key (Dept code) references Department (Dept code), on the line under its table',
      'Without a column list, a foreign key refers to the primary key',
    ],
  },
  {
    title: 'IE diagram (crow’s foot)',
    items: [
      'Line ends: exactly one, one or many, zero or one, zero or many',
      'Line ends with the minimum not set: one, many',
      'Identifying and non-identifying relationship lines',
      'Tables with key, name, type, and NULL cells',
    ],
  },
  {
    title: 'SQL',
    items: [
      'Dialects: MySQL, PostgreSQL, Oracle',
      'CREATE TABLE, PRIMARY KEY, FOREIGN KEY, NOT NULL, and UNIQUE',
      'A placeholder for columns whose type is not set',
    ],
  },
];

/** 마침표로 끝나지 않는 화면 문장(사실 목록의 본문 등)을 문단으로 쓸 때 마침표를 붙인다 */
function sentence(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 첫 화면의 HTML. dict는 영어 사전이다 */
export function renderHomeStatic(dict: Dictionary): string {
  const t = (key: MessageKey, params?: MessageParams) => esc(formatMessage(dict, 'en', key, params));
  // HomeStages.relationExample과 같은 예
  const relation = `${formatMessage(dict, 'en', 'home.sample.student')} (${['home.sample.studentId', 'home.sample.name', 'home.sample.deptCode']
    .map((k) => formatMessage(dict, 'en', k))
    .join(', ')})`;
  const stages = (['conceptual', 'logical', 'physical'] as const)
    .map(
      (id) => `<li>
<h3>${t(`home.stage.${id}.name`)}: ${t(`home.stage.${id}.title`)}</h3>
<p>${t(`home.stage.${id}.body`, { relation })}</p>
</li>`,
    )
    .join('\n');
  const facts = (['signup', 'link', 'opensource', 'expiry'] as const)
    .map((id) => `<h3>${t(`home.fact.${id}.title`)}</h3>\n<p>${esc(sentence(formatMessage(dict, 'en', `home.fact.${id}.body`)))}</p>`)
    .join('\n');
  const notation = NOTATION.map((g) => `<h3>${esc(g.title)}</h3>\n<ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('\n');
  const faq = HOME_FAQ.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join('\n');

  return `<div class="home-static">
<header>
<p><a href="/"><strong>${esc(APP_NAME)}</strong></a> · <a href="${REPO_URL}">GitHub</a> · <a href="${NPM_URL}">npm</a></p>
<nav aria-label="Sections"><a href="#stages">ERD to SQL</a> · <a href="#ai">AI and MCP</a> · <a href="#notation">Notation</a> · <a href="#faq">FAQ</a></nav>
</header>
<main>
<h1>${t('home.hero.title1')} ${t('home.hero.title2')} ${t('home.hero.title3')}</h1>
<p>${t('home.hero.lead')}</p>
<p>${esc(APP_NAME)} is a free online ER diagram tool. The editor runs in your browser and needs JavaScript.</p>
<section id="stages">
<h2>${t('home.story.lead', { name: APP_NAME })}</h2>
<ol>
${stages}
</ol>
</section>
<section id="ai">
<h2>${t('home.ai.title')}</h2>
<p>${t('home.ai.body')}</p>
<h3>${t('home.ai.ways')}</h3>
<h4>${t('ai.cli.title')}</h4>
<p>${t('ai.cli.descHome')}</p>
<pre><code>${t('ai.cli.promptHome')}</code></pre>
<h4>${t('ai.mcp.title')}</h4>
<p>${t('ai.mcp.desc')}</p>
<pre><code>${esc(MCP_URL)}</code></pre>
<h3>${t('home.ai.useCase')}: ${t('home.ai.migrate.title')}</h3>
<p>${t('home.ai.migrate.body')}</p>
<p>${t('home.ai.migrate.promptLabel')}:</p>
<pre><code>${t('home.ai.migrate.prompt')}</code></pre>
</section>
<section>
<h2>${t('home.facts.label')}</h2>
${facts}
</section>
<section id="notation">
<h2>${t('home.notation.title')}</h2>
<p>${esc(sentence(formatMessage(dict, 'en', 'home.notation.sub')))}</p>
${notation}
</section>
<section id="faq">
<h2>Frequently asked questions</h2>
${faq}
</section>
</main>
<footer>
<p>${esc(APP_NAME)} is open source under the MIT license: <a href="${REPO_URL}">${REPO_URL}</a>. Command-line tool: <a href="${NPM_URL}">${NPM_URL}</a>. For AI tools: <a href="/llms.txt">llms.txt</a>.</p>
</footer>
</div>`;
}

/** index.html에 넣는 구조화 데이터(schema.org JSON-LD). pageTitle은 index.html의 제목과 같은 값이다 */
export function structuredData(pageTitle: string, description: string): object {
  const org = `${SITE_URL}#organization`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}#website`,
        name: APP_NAME,
        url: SITE_URL,
        description,
        publisher: { '@id': org },
        inLanguage: ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt-BR', 'vi'],
      },
      {
        // 사람 이름은 넣지 않는다
        '@type': 'Organization',
        '@id': org,
        name: APP_NAME,
        url: SITE_URL,
        logo: { '@type': 'ImageObject', url: `${SITE_URL}icon-512.png`, width: 512, height: 512 },
        sameAs: [REPO_URL, NPM_URL],
      },
      {
        '@type': 'WebPage',
        '@id': `${SITE_URL}#webpage`,
        url: SITE_URL,
        name: pageTitle,
        description,
        inLanguage: 'en',
        isPartOf: { '@id': `${SITE_URL}#website` },
        about: { '@id': `${SITE_URL}#app` },
        primaryImageOfPage: { '@type': 'ImageObject', url: `${SITE_URL}og.png`, width: 1200, height: 630 },
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}#app`,
        name: APP_NAME,
        alternateName: `${APP_NAME} ER diagram tool`,
        url: SITE_URL,
        description: `A free online ER diagram tool for the three steps of database design. Draw a Chen-notation ER diagram with your team in real time (conceptual), write the relational model and see it as an IE (crow's foot) diagram (logical), and generate CREATE TABLE SQL for MySQL, PostgreSQL, or Oracle (physical). AI assistants such as ChatGPT and Claude can create and edit the same diagram through a remote MCP server or a command-line tool.`,
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'Database design, ER diagram tool',
        operatingSystem: 'Web',
        browserRequirements: 'Requires JavaScript and a modern browser',
        isAccessibleForFree: true,
        license: 'https://opensource.org/licenses/MIT',
        image: `${SITE_URL}og.png`,
        screenshot: `${SITE_URL}og.png`,
        publisher: { '@id': org },
        sameAs: [REPO_URL, NPM_URL],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: [
          'Real-time collaborative ER diagram editing through a shared link, with shared cursors and selections, up to 15 people per room',
          'Chen notation shapes, including weak entities, identifying relationships, multivalued and composite attributes, partial keys, total participation, and specialization',
          'Notation checks for missing keys, missing cardinalities, and weak entities without an identifying relationship',
          "Relational model written in plain text, with underlined primary keys and Foreign Key lines, drawn live as an editable IE (crow's foot) diagram",
          'CREATE TABLE SQL for MySQL, PostgreSQL, and Oracle from the types, NOT NULL, and UNIQUE you set, without guessing unset types',
          `Remote MCP server at ${MCP_URL} so AI assistants such as ChatGPT and Claude can create and edit diagrams`,
          `Command-line tool (npx -y ${APP_NAME}) for AI coding assistants such as Claude Code, Cursor, and Codex`,
          'Import an existing ERD from an image, such as a draw.io or ERDCloud screenshot or a hand drawing, with an AI assistant',
          'Export to PNG, SVG, the clipboard, and JSON',
          'No sign-up, free, open source, and the interface is available in 10 languages',
        ],
      },
      {
        '@type': 'SoftwareSourceCode',
        '@id': `${SITE_URL}#source`,
        name: APP_NAME,
        codeRepository: REPO_URL,
        programmingLanguage: 'TypeScript',
        license: 'https://opensource.org/licenses/MIT',
        targetProduct: { '@id': `${SITE_URL}#app` },
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}#faq`,
        isPartOf: { '@id': `${SITE_URL}#webpage` },
        mainEntity: HOME_FAQ.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };
}

/** script 태그 안에 넣을 수 있게 JSON을 만든다(</script> 같은 글이 태그를 끊지 않게 <를 바꾼다) */
export function jsonLdScript(data: object): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}
