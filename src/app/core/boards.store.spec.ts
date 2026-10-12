import { TestBed } from '@angular/core/testing';

import { BoardsStore, defaultBoards, sanitizeBoards } from './boards.store';
import { Persist } from './storage/persist';
import { STORAGE_BACKEND, type StorageBackend } from './storage/storage-backend';

class MemoryBackend implements StorageBackend {
  readonly name = 'memory';
  readonly data = new Map<string, unknown>();
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T) {
    this.data.set(key, value);
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}

describe('sanitizeBoards', () => {
  it('derives unique ids from ids or names and keeps valid channels and sources', () => {
    const boards = sanitizeBoards([
      { name: 'Storm Board', widgets: [] },
      { name: 'Storm Board', widgets: [] },
      { id: 7, widgets: [{ type: 'player', channel: 'x1' }] },
      { id: '!!!', widgets: [{ type: 'radar', source: 'site-vel', w: 'a', h: -3 }] },
      { widgets: [null, { type: 'player', channel: 'c'.repeat(100) }] },
      'junk',
      { name: 'no widgets' },
    ]);
    expect(boards!.map((b) => b.id)).toEqual([
      'storm-board',
      'storm-board-2',
      '7',
      'board',
      'board-2',
    ]);
    expect(boards![0]!.rows).toBe(6);
    expect(boards![2]!.name).toBe('7');
    expect(boards![2]!.widgets[0]).toMatchObject({ type: 'player', channel: 'x1', w: 4, h: 2 });
    expect(boards![3]!.widgets[0]).toMatchObject({ source: 'site-vel', w: 4, h: 1 });
    expect(boards![4]!.widgets).toHaveLength(1);
    expect(boards![4]!.widgets[0]!.channel).toBeUndefined();
  });

  it('returns null when nothing valid remains', () => {
    expect(sanitizeBoards([])).toBeNull();
    expect(sanitizeBoards([{ name: 'x' }])).toBeNull();
  });

  it('caps the number of boards and widgets', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `b${i}`,
      widgets: Array.from({ length: 40 }, () => ({ type: 'links' })),
    }));
    const boards = sanitizeBoards(many)!;
    expect(boards).toHaveLength(20);
    expect(boards[0]!.widgets).toHaveLength(30);
  });
});

describe('BoardsStore', () => {
  let store: BoardsStore;
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_BACKEND, useValue: backend }],
    });
    store = TestBed.inject(BoardsStore);
  });

  const ids = () => store.boards().map((b) => b.id);
  const board = (id: string) => store.boards().find((b) => b.id === id)!;

  it('starts with the default boards', () => {
    expect(ids()).toEqual(defaultBoards().map((b) => b.id));
    expect(store.first().id).toBe('storm');
  });

  it('looks boards up by id, falling back to the first', () => {
    expect(store.byId('radar').name).toBe('Radar');
    expect(store.byId('nope').id).toBe('storm');
    expect(store.byId(undefined).id).toBe('storm');
  });

  it('adds boards with unique slugs and copies widgets with fresh ids', () => {
    const a = store.addBoard('Radar');
    expect(a.id).toBe('radar-2');
    expect(a.widgets.map((x) => x.type)).toEqual(['radar', 'alerts']);
    const b = store.addBoard('Radar');
    expect(b.id).toBe('radar-3');

    const src = board('storm');
    const copy = store.addBoard('Storm copy', src);
    expect(copy.id).toBe('storm-copy');
    expect(copy.widgets.map((x) => x.type)).toEqual(src.widgets.map((x) => x.type));
    expect(copy.widgets[0]!.id).not.toBe(src.widgets[0]!.id);
    expect(ids()).toHaveLength(6);
  });

  it('removes boards but never the last one', () => {
    store.removeBoard('radar');
    store.removeBoard('no-tv');
    expect(ids()).toEqual(['storm']);
    store.removeBoard('storm');
    expect(ids()).toEqual(['storm']);
  });

  it('renames boards, ignoring empty names and truncating long ones', () => {
    store.renameBoard('storm', 'Severe');
    expect(board('storm').name).toBe('Severe');
    store.renameBoard('storm', '');
    expect(board('storm').name).toBe('Severe');
    store.renameBoard('storm', 'x'.repeat(50));
    expect(board('storm').name).toHaveLength(40);
  });

  it('clamps the row count', () => {
    store.setRows('storm', 0);
    expect(board('storm').rows).toBe(1);
    store.setRows('storm', 40);
    expect(board('storm').rows).toBe(12);
  });

  it('moves boards within bounds only', () => {
    store.moveBoard('radar', -1);
    expect(ids()).toEqual(['radar', 'storm', 'no-tv']);
    const before = store.boards();
    store.moveBoard('radar', -1);
    store.moveBoard('no-tv', 1);
    store.moveBoard('missing', 1);
    expect(store.boards()).toBe(before);
  });

  it('adds widgets with type-specific sizes', () => {
    store.addWidget('radar', 'radar');
    store.addWidget('radar', 'tropical');
    const ws = board('radar').widgets;
    expect(ws.at(-2)).toMatchObject({ type: 'radar', w: 6, h: 4, source: 'blend' });
    expect(ws.at(-1)).toMatchObject({ type: 'tropical', w: 3, h: 2 });
    expect(ws.at(-1)!.source).toBeUndefined();
  });

  it('removes, reorders and resizes widgets', () => {
    const [w0, w1] = board('radar').widgets;
    store.reorder('radar', 0, 5);
    expect(board('radar').widgets.map((x) => x.id)).toEqual([w1!.id, w0!.id]);
    const before = board('radar');
    store.reorder('radar', 9, 0);
    expect(board('radar')).toBe(before);

    store.resize('radar', w0!.id, 10, -10);
    expect(board('radar').widgets.find((x) => x.id === w0!.id)).toMatchObject({ w: 12, h: 1 });

    store.removeWidget('radar', w0!.id);
    expect(board('radar').widgets.map((x) => x.id)).toEqual([w1!.id]);
  });

  it('sets the radar source and pins or unpins a channel', () => {
    const w0 = board('storm').widgets[1]!;
    store.setSource('storm', w0.id, 'hrrr');
    store.setChannel('storm', w0.id, 'x1');
    expect(board('storm').widgets[1]).toMatchObject({ source: 'hrrr', channel: 'x1' });
    store.setChannel('storm', w0.id, null);
    expect('channel' in board('storm').widgets[1]!).toBe(false);
  });

  it('resets to the defaults', () => {
    store.removeBoard('radar');
    store.reset();
    expect(ids()).toEqual(['storm', 'radar', 'no-tv']);
  });

  it('persists changes after hydration', async () => {
    await TestBed.inject(Persist).ready();
    store.renameBoard('storm', 'Saved');
    TestBed.tick();
    await Promise.resolve();
    expect((backend.data.get('sw.boards') as { name: string }[])[0]!.name).toBe('Saved');
  });
});
