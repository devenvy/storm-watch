import { computed, inject, Injectable } from '@angular/core';

import { RADAR_SOURCES, type RadarSourceId } from './radar-sources';
import { Persist } from './storage/persist';

export type WidgetType = 'radar' | 'player' | 'alerts' | 'conditions' | 'tropical' | 'channels' | 'links';

export const WIDGET_TYPES: { type: WidgetType; label: string }[] = [
  { type: 'radar', label: 'Radar' },
  { type: 'player', label: 'Live TV' },
  { type: 'channels', label: 'Channels' },
  { type: 'alerts', label: 'Alerts' },
  { type: 'conditions', label: 'Current conditions' },
  { type: 'tropical', label: 'Tropical storms' },
  { type: 'links', label: 'Links' },
];

export interface Widget {
  id: string;
  type: WidgetType;
  /** Columns spanned out of GRID_COLS. */
  w: number;
  /** Rows spanned out of the board's row count. */
  h: number;
  /** Radar widgets: which source to show. */
  source?: RadarSourceId;
  /** Player widgets: a fixed channel key; otherwise it plays the channel picked on the board. */
  channel?: string;
}

export interface Board {
  id: string;
  name: string;
  /** Rows that fit one screen; widgets beyond them scroll. */
  rows: number;
  widgets: Widget[];
}

export const GRID_COLS = 12;
export const MAX_ROWS = 12;

const uid = () => Math.random().toString(36).slice(2, 9);
const w = (type: WidgetType, width: number, height: number, extra: Partial<Widget> = {}): Widget =>
  ({ id: uid(), type, w: width, h: height, ...extra });

export function defaultBoards(): Board[] {
  return [
    {
      id: 'storm', name: 'Storm', rows: 6,
      widgets: [
        w('radar', 5, 6, { source: 'blend' }), w('player', 4, 3), w('alerts', 3, 4),
        w('channels', 4, 3), w('conditions', 3, 1), w('tropical', 3, 1),
      ],
    },
    {
      id: 'radar', name: 'Radar', rows: 6,
      widgets: [w('radar', 6, 6, { source: 'blend' }), w('radar', 6, 6, { source: 'site-vel' })],
    },
    {
      id: 'no-tv', name: 'No TV', rows: 6,
      widgets: [
        w('radar', 8, 6, { source: 'blend' }), w('alerts', 4, 3), w('conditions', 4, 1),
        w('tropical', 4, 1), w('links', 4, 1),
      ],
    },
  ];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
const isType = (t: unknown): t is WidgetType => WIDGET_TYPES.some(x => x.type === t);
const isSource = (s: unknown): s is RadarSourceId => RADAR_SOURCES.some(x => x.id === s);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'board';

/** Validates untrusted board data (storage, share links) and drops anything malformed. */
export function sanitizeBoards(input: unknown): Board[] | null {
  if (!Array.isArray(input)) {return null;}
  const ids = new Set<string>();
  const boards: Board[] = [];
  for (const b of input.slice(0, 20)) {
    if (!b || typeof b !== 'object' || !Array.isArray(b.widgets)) {continue;}
    let id = slug(String(b.id ?? b.name ?? 'board'));
    while (ids.has(id)) {id += '-2';}
    ids.add(id);
    const rows = clamp(Number(b.rows) || 6, 1, MAX_ROWS);
    boards.push({
      id,
      name: String(b.name ?? id).slice(0, 40),
      rows,
      widgets: (b.widgets as unknown[]).slice(0, 30).flatMap(x => {
        const v = x as Partial<Widget>;
        if (!v || !isType(v.type)) {return [];}
        return [{
          id: uid(),
          type: v.type,
          w: clamp(Number(v.w) || 4, 1, GRID_COLS),
          h: clamp(Number(v.h) || 2, 1, MAX_ROWS),
          ...(isSource(v.source) ? { source: v.source } : {}),
          ...(typeof v.channel === 'string' && v.channel.length < 100 ? { channel: v.channel } : {}),
        }];
      }),
    });
  }
  return boards.length ? boards : null;
}

/** User-editable dashboards, persisted through the storage backend. */
@Injectable({ providedIn: 'root' })
export class BoardsStore {
  private readonly persist = inject(Persist);
  readonly boards = this.persist.signal<Board[]>('sw.boards', defaultBoards(), sanitizeBoards);

  readonly first = computed(() => this.boards()[0]);

  byId(id: string | undefined): Board {
    const all = this.boards();
    return all.find(b => b.id === id) ?? all[0];
  }

  private updateBoard(id: string, fn: (b: Board) => Board): void {
    this.boards.update(all => all.map(b => (b.id === id ? fn(b) : b)));
  }

  private updateWidget(boardId: string, widgetId: string, fn: (x: Widget) => Widget): void {
    this.updateBoard(boardId, b => ({ ...b, widgets: b.widgets.map(x => (x.id === widgetId ? fn(x) : x)) }));
  }

  addBoard(name: string, copyOf?: Board): Board {
    let id = slug(name);
    const taken = new Set(this.boards().map(b => b.id));
    for (let i = 2; taken.has(id); i++) {id = `${slug(name)}-${i}`;}
    const board: Board = copyOf
      ? { ...copyOf, id, name, widgets: copyOf.widgets.map(x => ({ ...x, id: uid() })) }
      : { id, name, rows: 6, widgets: [w('radar', 8, 6, { source: 'blend' }), w('alerts', 4, 6)] };
    this.boards.update(all => [...all, board]);
    return board;
  }

  removeBoard(id: string): void {
    this.boards.update(all => (all.length > 1 ? all.filter(b => b.id !== id) : all));
  }

  renameBoard(id: string, name: string): void {
    this.updateBoard(id, b => ({ ...b, name: name.slice(0, 40) || b.name }));
  }

  setRows(id: string, rows: number): void {
    this.updateBoard(id, b => ({ ...b, rows: clamp(rows, 1, MAX_ROWS) }));
  }

  moveBoard(id: string, delta: number): void {
    this.boards.update(all => {
      const list = [...all];
      const i = list.findIndex(b => b.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) {return all;}
      [list[i], list[j]] = [list[j], list[i]];
      return list;
    });
  }

  addWidget(boardId: string, type: WidgetType): void {
    const sizes: Record<WidgetType, [number, number]> = {
      radar: [6, 4], player: [4, 3], channels: [4, 2], alerts: [3, 3], conditions: [3, 1], tropical: [3, 2], links: [3, 1],
    };
    const [width, height] = sizes[type];
    this.updateBoard(boardId, b => ({
      ...b, widgets: [...b.widgets, w(type, width, height, type === 'radar' ? { source: 'blend' } : {})],
    }));
  }

  removeWidget(boardId: string, widgetId: string): void {
    this.updateBoard(boardId, b => ({ ...b, widgets: b.widgets.filter(x => x.id !== widgetId) }));
  }

  /** Move a widget to a new position in the board's flow order. */
  reorder(boardId: string, from: number, to: number): void {
    this.updateBoard(boardId, b => {
      const list = [...b.widgets];
      const [item] = list.splice(from, 1);
      if (!item) {return b;}
      list.splice(clamp(to, 0, list.length), 0, item);
      return { ...b, widgets: list };
    });
  }

  resize(boardId: string, widgetId: string, dw: number, dh: number): void {
    this.updateWidget(boardId, widgetId, x => ({
      ...x, w: clamp(x.w + dw, 1, GRID_COLS), h: clamp(x.h + dh, 1, MAX_ROWS),
    }));
  }

  setSource(boardId: string, widgetId: string, source: RadarSourceId): void {
    this.updateWidget(boardId, widgetId, x => ({ ...x, source }));
  }

  setChannel(boardId: string, widgetId: string, channel: string | null): void {
    this.updateWidget(boardId, widgetId, x => {
      const next = { ...x };
      if (channel) {next.channel = channel;}
      else {delete next.channel;}
      return next;
    });
  }

  reset(): void {
    this.boards.set(defaultBoards());
  }
}
