import { CdkDrag, type CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import {
  BoardsStore,
  MAX_ROWS,
  type Widget,
  WIDGET_TYPES,
  type WidgetType,
} from '../core/boards.store';
import { SettingsStore } from '../core/settings.store';
import { LineupStore } from '../iptv/lineup.store';
import { AlertsWidget } from './widgets/alerts-widget';
import { ChannelsWidget } from './widgets/channels-widget';
import { ConditionsWidget } from './widgets/conditions-widget';
import { LinksWidget } from './widgets/links-widget';
import { PlayerWidget } from './widgets/player-widget';
import { RadarWidget } from './widgets/radar-widget';
import { TropicalWidget } from './widgets/tropical-widget';

import type { RadarSourceId } from '../core/radar-sources';

/** Stacked (mobile) layout height bounds, in 120px rows. */
const MOBILE_ROWS = {
  media: { min: 3, max: 5 },
  other: { min: 1, max: 4 },
} as const;

function widgetLabel(type: WidgetType): string {
  return WIDGET_TYPES.find((t) => t.type === type)?.label ?? type;
}

/** Stacked layout height in 120px rows. */
function mobileRows(w: Widget): number {
  const { min, max } =
    w.type === 'radar' || w.type === 'player' ? MOBILE_ROWS.media : MOBILE_ROWS.other;
  return Math.max(min, Math.min(w.h, max));
}

/**
 * A user-built dashboard: a 12-column grid sized so `rows` rows fill the screen. Widgets
 * flow in order; edit mode lets you drag to reorder, resize, add and remove them.
 */
@Component({
  selector: 'sw-dashboard',
  imports: [
    RouterLink,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    RadarWidget,
    PlayerWidget,
    ChannelsWidget,
    AlertsWidget,
    ConditionsWidget,
    TropicalWidget,
    LinksWidget,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  protected readonly store = inject(BoardsStore);
  protected readonly lineup = inject(LineupStore);
  protected readonly location = inject(SettingsStore).location;
  private readonly router = inject(Router);

  /** Route param: which dashboard. */
  readonly board = input<string>();
  /** Channel picked on this board (?ch=). */
  readonly ch = input<string>();
  /** ?kiosk: hide editing chrome (for TVs / signage). */
  readonly kiosk = input(false, {
    transform: (v: unknown) => v !== undefined && v !== null && v !== 'false' && v !== '0',
  });

  protected readonly current = computed(() => this.store.byId(this.board()));
  protected readonly editing = signal(false);
  /** Kiosk links never show editing controls. */
  protected readonly editable = computed(() => this.editing() && !this.kiosk());
  protected readonly widgetTypes = WIDGET_TYPES;
  protected readonly rowChoices = Array.from({ length: MAX_ROWS }, (_, i) => i + 1);

  protected readonly label = widgetLabel;
  protected readonly mobileRows = mobileRows;

  protected drop(e: CdkDragDrop<unknown>): void {
    this.store.reorder(this.current().id, e.previousIndex, e.currentIndex);
  }

  protected setSource(w: Widget, source: RadarSourceId): void {
    this.store.setSource(this.current().id, w.id, source);
  }

  protected pin(w: Widget, e: Event): void {
    this.store.setChannel(this.current().id, w.id, (e.target as HTMLSelectElement).value || null);
  }

  protected rename(e: Event): void {
    this.store.renameBoard(this.current().id, (e.target as HTMLInputElement).value.trim());
  }

  protected setRows(e: Event): void {
    this.store.setRows(this.current().id, Number((e.target as HTMLSelectElement).value));
  }

  protected add(type: string): void {
    this.store.addWidget(this.current().id, type as WidgetType);
  }

  protected newBoard(): void {
    const b = this.store.addBoard(`Board ${this.store.boards().length + 1}`);
    this.navigate(['/d', b.id]);
  }

  protected duplicate(): void {
    const cur = this.current();
    const b = this.store.addBoard(`${cur.name} copy`, cur);
    this.navigate(['/d', b.id]);
  }

  protected removeBoard(): void {
    const cur = this.current();
    // eslint-disable-next-line no-alert -- native confirm is the intended guard for destructive actions; there is no in-app dialog
    if (!confirm(`Delete the "${cur.name}" dashboard?`)) {
      return;
    }
    this.store.removeBoard(cur.id);
    this.navigate(['/d', this.store.first().id]);
  }

  protected resetAll(): void {
    // eslint-disable-next-line no-alert -- native confirm is the intended guard for destructive actions; there is no in-app dialog
    if (!confirm('Replace all dashboards with the defaults?')) {
      return;
    }
    this.store.reset();
    this.navigate(['/']);
  }

  private navigate(commands: string[]): void {
    this.router.navigate(commands).catch((err: unknown) => {
      console.error('Navigation failed', err);
    });
  }
}
