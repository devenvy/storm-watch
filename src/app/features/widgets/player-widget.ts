import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LineupStore } from '../../iptv/lineup.store';
import { CardButtons, Expandable } from '../../shared/expandable';
import { Player, type PlayerStatus } from '../../shared/player';

export function statusText(s: PlayerStatus): string {
  switch (s.state) {
    case 'loading': return 'loading…';
    case 'playing': return 'live';
    case 'reconnecting': return `reconnecting (${s.attempt})…`;
    case 'error': return s.message;
    default: return '';
  }
}

/** Plays the widget's pinned channel, or else the channel picked on the board (?ch=). */
@Component({
  selector: 'sw-player-widget',
  imports: [Player, RouterLink, CardButtons],
  template: `
    <h2>
      <span class="title">@if (playing(); as c) { {{ c.name }} } @else { Live TV }</span>
      <span class="meta pstat" [class]="status().state">{{ text() }}</span>
      @if (playing(); as c) {
        <button class="meta icon" [title]="muted() ? 'Unmute' : 'Mute'" [attr.aria-label]="muted() ? 'Unmute' : 'Mute'"
          (click)="muted.set(!muted())">{{ muted() ? '🔇' : '🔊' }}</button>
        <a class="meta icon" queryParamsHandling="preserve" title="Open Watch page" aria-label="Open Watch page" [routerLink]="['/watch', c.key]">↗</a>
        @if (!pinned()) {
          <a class="meta icon" queryParamsHandling="merge" title="Stop" aria-label="Stop"
            [routerLink]="[]" [queryParams]="{ ch: null }">■</a>
        }
      }
      <sw-card-buttons [card]="card" />
    </h2>
    <div class="screen">
      @if (playing(); as c) {
        <sw-player [url]="c.url" [muted]="muted()" (status)="status.set($event)" />
      } @else if (lineup.channels().length) {
        <p class="muted">Pick a channel to watch here.</p>
      } @else {
        <p class="muted"><a routerLink="/setup" fragment="iptv">Add an IPTV source</a> to watch live TV.</p>
      }
    </div>
  `,
  styles: `
    .screen { flex: 1; min-height: 0; background: #000; border-radius: 6px; overflow: hidden; display: grid; place-items: center; }
    .screen sw-player { width: 100%; height: 100%; }
    .screen p { margin: 0; padding: 8px; text-align: center; }
    .pstat { font-size: 11px; } .pstat.error { color: var(--red); } .pstat.playing { color: var(--green); }
    .pstat.reconnecting { color: var(--yellow); }
    .icon { text-decoration: none; font-size: 14px; padding: 0 4px; background: none; border: 0; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
  hostDirectives: [Expandable]
})
export class PlayerWidget {
  protected readonly lineup = inject(LineupStore);
  protected readonly card = inject(Expandable);

  /** Channel key chosen on the board. */
  readonly ch = input<string | undefined>();
  /** Channel key pinned in this widget's settings. */
  readonly pinned = input<string | undefined>();

  protected readonly playing = computed(() => {
    const k = this.pinned() ?? this.ch();
    return k ? this.lineup.byKey(k) ?? null : null;
  });
  protected readonly muted = signal(false);
  protected readonly status = signal<PlayerStatus>({ state: 'idle' });
  protected readonly text = computed(() => statusText(this.status()));
}
