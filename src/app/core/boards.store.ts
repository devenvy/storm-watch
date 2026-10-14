import { computed, inject, Injectable } from '@angular/core';

import { RADAR_SOURCES, type RadarSourceId } from './radar-sources';
import { Persist } from './storage/persist';

export type WidgetType =
  'radar' | 'player' | 'alerts' | 'conditions' | 'tropical' | 'channels' | 'links';

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

const GRID_COLS = 12;
export const MAX_ROWS = 12;

/** Limits applied to untrusted board data. */
const MAX_BOARDS = 20;
const MAX_WIDGETS = 30;
const MAX_NAME_LENGTH = 40;
const MAX_SLUG_LENGTH = 30;
const MAX_CHANNEL_LENGTH = 100;
const DEFAULT_ROWS = 6;
/** Size given to a stored widget whose size is missing or invalid. */
const DEFAULT_SIZE = { w: 4, h: 2 };

/** Random ids: base-36 digits of Math.random(), skipping the leading "0.". */
const UID_RADIX = 36;
const UID_START = 2;
const UID_LENGTH = 7;

const uid = () =>
  Math.random()
    .toString(UID_RADIX)
    .slice(UID_START, UID_START + UID_LENGTH);
const w = (spec: Omit<Widget, 'id'>): Widget => ({ id: uid(), ...spec });

export function defaultBoards(): Board[] {
  return [
    {
      id: 'storm',
      name: 'Storm',
      rows: 6,
      widgets: [
        w({ type: 'radar', w: 5, h: 6, source: 'blend' }),
        w({ type: 'player', w: 4, h: 3 }),
        w({ type: 'alerts', w: 3, h: 4 }),
        w({ type: 'channels', w: 4, h: 3 }),
        w({ type: 'conditions', w: 3, h: 1 }),
        w({ type: 'tropical', w: 3, h: 1 }),
      ],
    },
    {
      id: 'radar',
      name: 'Radar',
      rows: 6,
      widgets: [
        w({ type: 'radar', w: 6, h: 6, source: 'blend' }),
        w({ type: 'radar', w: 6, h: 6, source: 'site-vel' }),
      ],
    },
    {
      id: 'no-tv',
      name: 'No TV',
      rows: 6,
      widgets: [
        w({ type: 'radar', w: 8, h: 6, source: 'blend' }),
        w({ type: 'alerts', w: 4, h: 3 }),
        w({ type: 'conditions', w: 4, h: 1 }),
        w({ type: 'tropical', w: 4, h: 1 }),
        w({ type: 'links', w: 4, h: 1 }),
      ],
    },
  ];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
const isType = (t: unknown): t is WidgetType => WIDGET_TYPES.some((x) => x.type === t);
const isSource = (s: unknown): s is RadarSourceId => RADAR_SOURCES.some((x) => x.id === s);
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_SLUG_LENGTH) || 'board';

/** Board-shaped storage/share data: an object with a widgets array; every other field still untrusted. */
interface RawBoard {
  // Not checked at runtime: String() below coerces whatever is actually stored.
  id?: string | number;
  name?: string | number;
  rows?: unknown;
  widgets: unknown[];
}
const isRawBoard = (b: unknown): b is RawBoard =>
  typeof b === 'object' && b !== null && Array.isArray((b as { widgets?: unknown }).widgets);

/** Validates untrusted board data (storage, share links) and drops anything malformed. */
export function sanitizeBoards(input: unknown): Board[] | null {
  if (!Array.isArray(input)) {
    return null;
  }
  const ids = new Set<string>();
  const boards: Board[] = [];
  for (const b of input.slice(0, MAX_BOARDS).filter(isRawBoard)) {
    let id = slug(String(b.id ?? b.name ?? 'board'));
    while (ids.has(id)) {
      id += '-2';
    }
    ids.add(id);
    const rows = clamp(Number(b.rows) || DEFAULT_ROWS, 1, MAX_ROWS);
    boards.push({
      id,
      name: String(b.name ?? id).slice(0, MAX_NAME_LENGTH),
      rows,
      widgets: b.widgets.slice(0, MAX_WIDGETS).flatMap((x) => {
        const v = x as Partial<Widget> | null | undefined;
        if (!v || !isType(v.type)) {
          return [];
        }
        return [
          {
            id: uid(),
            type: v.type,
            w: clamp(Number(v.w) || DEFAULT_SIZE.w, 1, GRID_COLS),
            h: clamp(Number(v.h) || DEFAULT_SIZE.h, 1, MAX_ROWS),
            ...(isSource(v.source) ? { source: v.source } : {}),
            ...(typeof v.channel === 'string' && v.channel.length < MAX_CHANNEL_LENGTH
              ? { channel: v.channel }
              : {}),
          },
        ];
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

  /** Never empty: sanitizeBoards falls back to defaults and removal keeps the last board. */
  readonly first = computed(() => this.boards()[0]!);

  byId(id: string | undefined): Board {
    const all = this.boards();
    return all.find((b) => b.id === id) ?? all[0]!;
  }

  private updateBoard(id: string, fn: (b: Board) => Board): void {
    this.boards.update((all) => all.map((b) => (b.id === id ? fn(b) : b)));
  }

  private updateWidget(boardId: string, widgetId: string, fn: (x: Widget) => Widget): void {
    this.updateBoard(boardId, (b) => ({
      ...b,
      widgets: b.widgets.map((x) => (x.id === widgetId ? fn(x) : x)),
    }));
  }

  addBoard(name: string, copyOf?: Board): Board {
    let id = slug(name);
    const taken = new Set(this.boards().map((b) => b.id));
    for (let i = 2; taken.has(id); i++) {
      id = `${slug(name)}-${i}`;
    }
    const board: Board = copyOf
      ? { ...copyOf, id, name, widgets: copyOf.widgets.map((x) => ({ ...x, id: uid() })) }
      : {
          id,
          name,
          rows: 6,
          widgets: [
            w({ type: 'radar', w: 8, h: 6, source: 'blend' }),
            w({ type: 'alerts', w: 4, h: 6 }),
          ],
        };
    this.boards.update((all) => [...all, board]);
    return board;
  }

  removeBoard(id: string): void {
    this.boards.update((all) => (all.length > 1 ? all.filter((b) => b.id !== id) : all));
  }

  renameBoard(id: string, name: string): void {
    this.updateBoard(id, (b) => ({ ...b, name: name.slice(0, MAX_NAME_LENGTH) || b.name }));
  }

  setRows(id: string, rows: number): void {
    this.updateBoard(id, (b) => ({ ...b, rows: clamp(rows, 1, MAX_ROWS) }));
  }

  moveBoard(id: string, delta: number): void {
    this.boards.update((all) => {
      const list = [...all];
      const i = list.findIndex((b) => b.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) {
        return all;
      }
      [list[i], list[j]] = [list[j]!, list[i]!];
      return list;
    });
  }

  addWidget(boardId: string, type: WidgetType): void {
    const sizes: Record<WidgetType, { w: number; h: number }> = {
      radar: { w: 6, h: 4 },
      player: { w: 4, h: 3 },
      channels: { w: 4, h: 2 },
      alerts: { w: 3, h: 3 },
      conditions: { w: 3, h: 1 },
      tropical: { w: 3, h: 2 },
      links: { w: 3, h: 1 },
    };
    this.updateBoard(boardId, (b) => ({
      ...b,
      widgets: [
        ...b.widgets,
        w({ type, ...sizes[type], ...(type === 'radar' ? { source: 'blend' } : {}) }),
      ],
    }));
  }

  removeWidget(boardId: string, widgetId: string): void {
    this.updateBoard(boardId, (b) => ({
      ...b,
      widgets: b.widgets.filter((x) => x.id !== widgetId),
    }));
  }

  /** Move a widget to a new position in the board's flow order. */
  reorder(boardId: string, from: number, to: number): void {
    this.updateBoard(boardId, (b) => {
      const list = [...b.widgets];
      const [item] = list.splice(from, 1);
      if (!item) {
        return b;
      }
      list.splice(clamp(to, 0, list.length), 0, item);
      return { ...b, widgets: list };
    });
  }

  resize(boardId: string, widgetId: string, dw: number, dh: number): void {
    this.updateWidget(boardId, widgetId, (x) => ({
      ...x,
      w: clamp(x.w + dw, 1, GRID_COLS),
      h: clamp(x.h + dh, 1, MAX_ROWS),
    }));
  }

  setSource(boardId: string, widgetId: string, source: RadarSourceId): void {
    this.updateWidget(boardId, widgetId, (x) => ({ ...x, source }));
  }

  setChannel(boardId: string, widgetId: string, channel: string | null): void {
    this.updateWidget(boardId, widgetId, (x) => {
      const next = { ...x };
      if (channel) {
        next.channel = channel;
      } else {
        delete next.channel;
      }
      return next;
    });
  }

  reset(): void {
    this.boards.set(defaultBoards());
  }
}
