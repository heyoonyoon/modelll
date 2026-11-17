import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { WebSocket } from 'ws';
import type { Persistence } from './persistence';
import { SyncHub } from './sync';

/** 보내는 것은 버리고 받는 것만 흉내 내는 웹소켓 */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  send(_data: Uint8Array, _opts: unknown, cb?: (err?: Error) => void): void {
    cb?.();
  }
  close(): void {}
  terminate(): void {}
  ping(): void {}
}

describe('SyncHub의 마지막 움직임', () => {
  let hub: SyncHub;
  let socket: FakeSocket;
  let client: awarenessProtocol.Awareness;

  /** 브라우저가 자기 awareness 상태를 서버에 올리는 것과 같은 메시지를 보낸다 */
  function push(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(client, [client.clientID]));
    socket.emit('message', Buffer.from(encoding.toUint8Array(encoder)), true);
  }
  const lastMove = () => hub.connInfo(socket, 'room-move')?.lastMove;
  /**
   * 서버가 30초 무소식인 상태를 지우는 것과 같은 일을 한다. 뒤에 깔린 탭은 생존 신호가 1분에 한 번으로 늦어져 이렇게 된다.
   * y-protocols는 시각을 가짜 타이머가 바꾸지 못하는 방식으로 읽어서 시간을 돌려 재현할 수 없다.
   */
  function dropByTimeout(): void {
    const rooms = (hub as unknown as { rooms: Map<string, { awareness: awarenessProtocol.Awareness }> }).rooms;
    const awareness = rooms.get('room-move')!.awareness;
    expect(awareness.getStates().has(client.clientID)).toBe(true);
    awarenessProtocol.removeAwarenessStates(awareness, [client.clientID], 'timeout');
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const persistence = { load: async () => null, touch: async () => {}, save: async () => {} } as unknown as Persistence;
    hub = new SyncHub(persistence);
    socket = new FakeSocket();
    client = new awarenessProtocol.Awareness(new Y.Doc());
    client.setLocalState({ user: { name: '가' }, cursor: null, selection: [], editing: null });
    hub.handleConnection(socket as unknown as WebSocket, 'room-move');
    await vi.advanceTimersByTimeAsync(0);
    push();
  });

  afterEach(() => {
    client.destroy();
    vi.useRealTimers();
  });

  it('처음 올린 상태와 내용이 같은 생존 신호는 움직임이 아니다', () => {
    expect(lastMove()).toBe(0);
    client.setLocalState(client.getLocalState());
    push();
    expect(lastMove()).toBe(0);
  });

  it('서버가 무소식으로 상태를 지운 뒤 늦게 온 생존 신호도 움직임이 아니다', async () => {
    await vi.advanceTimersByTimeAsync(40_000);
    dropByTimeout();
    client.setLocalState(client.getLocalState());
    push();
    expect(lastMove()).toBe(0);
  });

  it('커서가 바뀌면 그 시각을 남기고, 그 뒤의 늦은 생존 신호로는 바뀌지 않는다', async () => {
    await vi.advanceTimersByTimeAsync(5_000);
    client.setLocalState({ ...client.getLocalState(), cursor: { x: 10, y: 20 } });
    push();
    const moved = Date.now();
    expect(lastMove()).toBe(moved);

    await vi.advanceTimersByTimeAsync(40_000);
    dropByTimeout();
    client.setLocalState(client.getLocalState());
    push();
    expect(lastMove()).toBe(moved);
    dropByTimeout();

    // 지워진 뒤라도 내용이 실제로 달라졌으면 움직임이다
    client.setLocalState({ ...client.getLocalState(), cursor: null });
    push();
    expect(lastMove()).toBe(Date.now());
    expect(lastMove()).toBeGreaterThan(moved);
  });
});
