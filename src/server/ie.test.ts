import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { toMarkup } from '../shared/relational/markup';
import { columnKey } from '../shared/relational/settings';
import { readColumnSettings, readIePositions, readRelationalSource, readRoomDialect, setColumnSetting } from '../shared/relational/ydoc';
import { createErdServer, type ErdServer, type ErdServerOptions } from './server';

async function waitFor(cond: () => boolean | Promise<boolean>, what: string, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeout) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

const MODEL = 'entity 학과 { 학과코드 key }\n';

const DIAGRAM = {
  dialect: 'oracle',
  tables: [
    { name: '학과', x: 0, y: 0, columns: [{ name: '학과코드', pk: true, type: 'CHAR(4)' }, { name: '학과명', type: 'VARCHAR(50)', notNull: true, unique: true }] },
    { name: '학생', columns: [{ name: '학번', pk: true, type: 'VARCHAR(20)' }, { name: '학과코드', notNull: false }] },
  ],
  relationships: [{ child: '학생', columns: ['학과코드'], parent: '학과' }],
};

describe('IE 그림 API', () => {
  let dataDir: string;
  let server: ErdServer | null = null;
  let port = 0;
  const providers: WebsocketProvider[] = [];

  async function boot(extra: ErdServerOptions = {}): Promise<void> {
    server = createErdServer({ port: 0, host: '127.0.0.1', dataDir, saveDebounceMs: 20, log: () => {}, ...extra });
    port = (await server.start()).port;
  }

  const api = (urlPath: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${urlPath}`, init);
  const putModel = (roomId: string, text: string) => api(`/api/rooms/${roomId}/model`, { method: 'PUT', body: text });
  const putIe = (roomId: string, body: unknown, contentType = 'application/json') =>
    api(`/api/rooms/${roomId}/ie`, { method: 'PUT', headers: { 'Content-Type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  async function join(roomId: string): Promise<Y.Doc> {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/ws`, roomId, doc, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    });
    providers.push(provider);
    await waitFor(() => provider.synced, '동기화');
    return doc;
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd-ie-'));
  });

  afterEach(async () => {
    for (const p of providers.splice(0)) {
      p.destroy();
      p.doc.destroy();
    }
    await server?.stop();
    server = null;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('없는 방은 404, 잘못된 방 id는 400. 방을 만들지 않는다', async () => {
    await boot();
    const get = await api('/api/rooms/nobody/ie');
    expect(get.status).toBe(404);
    expect(await get.json()).toEqual({ ok: false, error: 'not-found' });
    expect((await putIe('nobody', DIAGRAM)).status).toBe(404);
    expect((await api('/api/rooms/bad.id/ie')).status).toBe(400);
    expect((await putIe('bad.id', DIAGRAM)).status).toBe(400);
    expect(await fs.readdir(dataDir)).toEqual([]);
  });

  it('쓴 문서가 방에 있는 사람에게 한 번에 보이고, 다시 읽으면 같은 문서와 읽기 전용 값이 온다', async () => {
    await boot();
    expect((await putModel('room-ie', MODEL)).status).toBe(200);
    const doc = await join('room-ie');
    const empty = await (await api('/api/rooms/room-ie/ie')).json();
    expect(empty).toEqual({ room: 'room-ie', title: '', dialect: null, tables: [], relationships: [], problems: [] });

    let updates = 0;
    doc.on('update', () => updates++);
    const res = await putIe('room-ie', DIAGRAM, 'text/plain');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, room: 'room-ie', changed: true, tables: 2, columns: 4, relationships: 1, warnings: [] });

    await waitFor(() => readRoomDialect(doc) === 'oracle', '실시간 반영');
    expect(updates).toBe(1);
    expect(toMarkup(readRelationalSource(doc))).toBe('학과 (_학과코드_, 학과명)\n학생 (_학번_, 학과코드)\nForeign Key (학과코드) references 학과 (학과코드)\n');
    expect(readColumnSettings(doc)[columnKey('학생', '학과코드')]).toEqual({ notNull: false });
    expect(readIePositions(doc)).toEqual({ 학과: { x: 0, y: 0 } });

    const got = await (await api('/api/rooms/room-ie/ie')).json();
    expect(got.tables[1].columns[1]).toEqual({ name: '학과코드', notNull: false, fk: true, inheritedType: 'CHAR(4)' });
    expect(got.relationships).toEqual([{ child: '학생', columns: ['학과코드'], parent: '학과', parentColumns: ['학과코드'], identifying: false, cardinality: '1:N' }]);
    // SQL에도 그대로 쓰인다
    const sql = await (await api('/api/rooms/room-ie/sql')).text();
    expect(sql).toContain('"학과명" VARCHAR2(50 CHAR) NOT NULL,');
    expect(sql).toContain('UNIQUE ("학과명")');

    // 읽은 문서를 그대로 보내면 바뀌지 않는다
    const again = await putIe('room-ie', got);
    expect((await again.json()).changed).toBe(false);

    // 방에서 사람이 고친 설정도 읽힌다
    setColumnSetting(doc, '학생', '학번', { type: 'NUMBER(8)' });
    await waitFor(async () => (await (await api('/api/rooms/room-ie/ie')).json()).tables[1].columns[0].type === 'NUMBER(8)', '설정 반영');
  });

  it('틀린 문서는 아무것도 쓰지 않고 문제를 모두 돌려준다', async () => {
    await boot();
    expect((await putModel('room-bad', MODEL)).status).toBe(200);
    expect((await putIe('room-bad', DIAGRAM)).status).toBe(200);
    const before = await (await api('/api/rooms/room-bad/ie')).json();

    const notJson = await putIe('room-bad', '{"tables": [');
    expect(notJson.status).toBe(400);
    expect((await notJson.json()).error).toBe('bad-request');

    const bad = await putIe('room-bad', {
      tables: [{ name: 'T', columns: [{ name: 'a', type: 'INT); DROP TABLE x; --' }] }, { name: 't', columns: [] }],
      relationships: [{ child: 'T', columns: ['a'], parent: 'Nope' }],
    });
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error).toBe('invalid');
    expect(body.errors).toEqual([expect.stringMatching(/^tables\[0\]\.columns\[0\]\.type: /), expect.stringMatching(/^tables\[1\]\.name: duplicate table/)]);
    expect(body.message).toBe(body.errors[0]);
    expect(await (await api('/api/rooms/room-bad/ie')).json()).toEqual(before);

    // 본문 크기 제한(256 KB)
    const big = await putIe('room-bad', { tables: [{ name: 'x'.repeat(300 * 1024), columns: [] }] });
    expect(big.status).toBe(413);
  });

  it('relational push는 그대로 동작하고, 그 뒤 IE 문서로 읽힌다', async () => {
    await boot();
    expect((await putModel('room-rel', MODEL)).status).toBe(200);
    const res = await api('/api/rooms/room-rel/relational', { method: 'PUT', body: 'A (_id_)\nB (_id_, a_id)\nForeign Key (a_id) references A\n' });
    expect(res.status).toBe(200);
    const got = await (await api('/api/rooms/room-rel/ie')).json();
    expect(got.tables.map((t: { name: string }) => t.name)).toEqual(['A', 'B']);
    expect(got.relationships[0]).toMatchObject({ child: 'B', parent: 'A', parentColumns: ['id'] });
  });
});
