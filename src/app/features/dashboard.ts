import { CdkDrag, type CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { BoardsStore, MAX_ROWS, type Widget, WIDGET_TYPES, type WidgetType } from '../core/boards.store';
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

/**
 * A user-built dashboard: a 12-column grid sized so `rows` rows fill the screen. Widgets
 * flow in order; edit mode lets you drag to reorder, resize, add and remove them.
 */
@Component({
  selector: 'sw-dashboard',
  imports: [
    RouterLink, CdkDropList, CdkDrag, CdkDragHandle,
    RadarWidget, PlayerWidget, ChannelsWidget, AlertsWidget, ConditionsWidget, TropicalWidget, LinksWidget,
  ],
  template: `
    @if (location(); as loc) {
      @if (!kiosk()) {
        <nav class="bar" aria-label="Dashboards">
          @for (b of store.boards(); track b.id) {
            <a class="tab" [routerLink]="['/d', b.id]" [class.on]="b.id === current().id"
              [attr.aria-current]="b.id === current().id ? 'page' : null">{{ b.name }}</a>
          }
          <span class="spacer"></span>
          @if (editing()) {
            <button (click)="newBoard()">＋ New</button>
            <button (click)="duplicate()">Duplicate</button>
            <a class="btn" routerLink="/setup" fragment="share">Share / TV link</a>
          }
          <button class="edit-toggle" [class.on]="editing()" (click)="editing.set(!editing())">
            {{ editing() ? '✓ Done' : '✎ Edit' }}</button>
        </nav>

        @if (editing()) {
          <div class="editbar">
            <label>Name <input maxlength="40" [value]="current().name" (change)="rename($event)"></label>
            <label>Rows on screen
              <select (change)="setRows($event)">
                @for (n of rowChoices; track n) { <option [value]="n" [selected]="n === current().rows">{{ n }}</option> }
              </select>
            </label>
            <label>Add
              <select #addSel aria-label="Widget type">
                @for (t of widgetTypes; track t.type) { <option [value]="t.type">{{ t.label }}</option> }
              </select>
            </label>
            <button (click)="add(addSel.value)">＋ Add widget</button>
            <span class="spacer"></span>
            <button title="Move tab left" aria-label="Move tab left" (click)="store.moveBoard(current().id, -1)">◀</button>
            <button title="Move tab right" aria-label="Move tab right" (click)="store.moveBoard(current().id, 1)">▶</button>
            <button class="danger" [disabled]="store.boards().length < 2" (click)="removeBoard()">Delete board</button>
            <button class="danger" (click)="resetAll()">Reset all</button>
          </div>
        }
      }

      <div class="viewport">
        <div class="grid" cdkDropList cdkDropListOrientation="mixed"
          [style.--rows]="current().rows" [class.editing]="editable()" [cdkDropListDisabled]="!editable()"
          (cdkDropListDropped)="drop($event)">
          @for (w of current().widgets; track w.id) {
            <div class="cell" cdkDrag [style.--w]="w.w" [style.--h]="w.h" [style.--mh]="mobileRows(w)">
              @switch (w.type) {
                @case ('radar') {
                  <sw-radar-widget [location]="loc" [source]="w.source ?? 'blend'" (sourceChange)="setSource(w, $event)" />
                }
                @case ('player') { <sw-player-widget [ch]="ch()" [pinned]="w.channel" /> }
                @case ('channels') { <sw-channels-widget [ch]="ch()" /> }
                @case ('alerts') { <sw-alerts-widget /> }
                @case ('conditions') { <sw-conditions-widget /> }
                @case ('tropical') { <sw-tropical-widget /> }
                @case ('links') { <sw-links-widget [location]="loc" /> }
              }
              @if (editable()) {
                <div class="overlay">
                  <span class="handle" cdkDragHandle title="Drag to move">⠿ {{ label(w.type) }}</span>
                  <span class="size">
                    <span class="grp">W
                      <button aria-label="Narrower" (click)="store.resize(current().id, w.id, -1, 0)">−</button>
                      {{ w.w }}
                      <button aria-label="Wider" (click)="store.resize(current().id, w.id, 1, 0)">+</button></span>
                    <span class="grp">H
                      <button aria-label="Shorter" (click)="store.resize(current().id, w.id, 0, -1)">−</button>
                      {{ w.h }}
                      <button aria-label="Taller" (click)="store.resize(current().id, w.id, 0, 1)">+</button></span>
                  </span>
                  @if (w.type === 'player') {
                    <select aria-label="Pinned channel" (change)="pin(w, $event)">
                      <option value="" [selected]="!w.channel">Follows channel picker</option>
                      @for (c of lineup.channels(); track c.key) {
                        <option [value]="c.key" [selected]="c.key === w.channel">{{ c.name }}</option>
                      }
                    </select>
                  }
                  <button class="danger" aria-label="Remove widget" (click)="store.removeWidget(current().id, w.id)">✕</button>
                </div>
              }
            </div>
          } @empty {
            <p class="muted empty-board">This dashboard is empty. Use ✎ Edit → Add widget.</p>
          }
        </div>
      </div>
    } @else {
      <section class="panel welcome">
        <h2>Welcome to Storm Watch</h2>
        <p>Set your location to start monitoring alerts and radar.</p>
        <a class="btn" routerLink="/setup">Set up</a>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; gap: 8px; }
    .bar, .editbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; flex: none; }
    .tab { padding: 4px 12px; border-radius: 6px; color: var(--muted); text-decoration: none; border: 1px solid transparent; }
    .tab.on { color: var(--fg); background: #21262d; border-color: var(--line); }
    .tab:hover { color: var(--fg); }
    .spacer { flex: 1; }
    .bar button, .bar .btn, .editbar button { padding: 4px 10px; }
    .edit-toggle.on { border-color: var(--green); color: var(--green); }
    .editbar { background: var(--panel); border: 1px dashed var(--blue); border-radius: 8px; padding: 6px 10px; }
    .editbar label { display: flex; gap: 6px; align-items: center; color: var(--muted); font-size: 13px; }
    .editbar input, .editbar select { padding: 4px 6px; }
    .danger:hover:not(:disabled) { border-color: var(--red); color: var(--red); }

    /* The viewport is a size container so rows can be a fraction of the visible height. */
    .viewport { flex: 1; min-height: 0; overflow: auto; container-type: size; }
    .grid {
      --gap: 10px;
      display: grid; gap: var(--gap); grid-auto-flow: dense;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      grid-auto-rows: max(90px, calc((100cqh - (var(--rows) - 1) * var(--gap)) / var(--rows)));
    }
    .cell { grid-column: span var(--w); grid-row: span var(--h); position: relative; min-width: 0; min-height: 0; display: flex; }
    .cell > :first-child { flex: 1; min-width: 0; }
    .grid.editing .cell { outline: 1px dashed var(--blue); outline-offset: 2px; border-radius: 8px; }

    .overlay {
      position: absolute; inset: auto 6px 6px 6px; z-index: 500;
      display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
      background: rgba(13, 17, 23, .92); border: 1px solid var(--blue); border-radius: 6px; padding: 4px 6px; font-size: 12px;
    }
    .overlay button { padding: 1px 7px; }
    .overlay select { padding: 2px 4px; font-size: 12px; max-width: 160px; }
    .handle { cursor: grab; font-weight: 600; flex: 1; min-width: 80px; user-select: none; }
    .size { display: flex; gap: 8px; }
    .grp { display: inline-flex; gap: 3px; align-items: center; }

    .cdk-drag-preview { opacity: .85; box-shadow: 0 8px 30px rgba(0, 0, 0, .6); }
    .cdk-drag-placeholder { opacity: .3; }
    .cdk-drag-animating, .grid.cdk-drop-list-dragging .cell:not(.cdk-drag-placeholder) { transition: transform 200ms ease; }

    .empty-board { grid-column: 1 / -1; text-align: center; padding: 40px; }
    .welcome { max-width: 520px; margin: 40px auto; text-align: center; }

    /* Phones and narrow windows: one column, page scrolls. */
    @media (max-width: 960px) {
      :host { height: auto; }
      .viewport { container-type: normal; overflow: visible; }
      .grid { grid-template-columns: minmax(0, 1fr); grid-auto-rows: 120px; }
      .cell { grid-column: 1 / -1; grid-row: span var(--mh); }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
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
  readonly kiosk = input(false, { transform: (v: unknown) => v !== undefined && v !== null && v !== 'false' && v !== '0' });

  protected readonly current = computed(() => this.store.byId(this.board()));
  protected readonly editing = signal(false);
  /** Kiosk links never show editing controls. */
  protected readonly editable = computed(() => this.editing() && !this.kiosk());
  protected readonly widgetTypes = WIDGET_TYPES;
  protected readonly rowChoices = Array.from({ length: MAX_ROWS }, (_, i) => i + 1);

  protected label(type: WidgetType): string {
    return WIDGET_TYPES.find(t => t.type === type)?.label ?? type;
  }

  /** Stacked layout height in 120px rows. */
  protected mobileRows(w: Widget): number {
    if (w.type === 'radar' || w.type === 'player') {return Math.max(3, Math.min(w.h, 5));}
    return Math.max(1, Math.min(w.h, 4));
  }

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
    this.store.setRows(this.current().id, +(e.target as HTMLSelectElement).value);
  }

  protected add(type: string): void {
    this.store.addWidget(this.current().id, type as WidgetType);
  }

  protected newBoard(): void {
    const b = this.store.addBoard(`Board ${this.store.boards().length + 1}`);
    this.router.navigate(['/d', b.id]);
  }

  protected duplicate(): void {
    const cur = this.current();
    const b = this.store.addBoard(`${cur.name} copy`, cur);
    this.router.navigate(['/d', b.id]);
  }

  protected removeBoard(): void {
    const cur = this.current();
    if (!confirm(`Delete the "${cur.name}" dashboard?`)) {return;}
    this.store.removeBoard(cur.id);
    this.router.navigate(['/d', this.store.first().id]);
  }

  protected resetAll(): void {
    if (!confirm('Replace all dashboards with the defaults?')) {return;}
    this.store.reset();
    this.router.navigate(['/']);
  }
}
