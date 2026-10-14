import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LineupStore } from '../../iptv/lineup.store';
import { CardButtons, Expandable } from '../../shared/expandable';
import { Player, type PlayerStatus } from '../../shared/player';

export function statusText(s: PlayerStatus): string {
  switch (s.state) {
    case 'loading':
      return 'loading…';
    case 'playing':
      return 'live';
    case 'reconnecting':
      return `reconnecting (${s.attempt})…`;
    case 'error':
      return s.message;
    case 'idle':
    default:
      return '';
  }
}

/** Plays the widget's pinned channel, or else the channel picked on the board (?ch=). */
@Component({
  selector: 'sw-player-widget',
  imports: [Player, RouterLink, CardButtons],
  templateUrl: './player-widget.html',
  styleUrl: './player-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
  hostDirectives: [Expandable],
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
    return k ? (this.lineup.byKey(k) ?? null) : null;
  });
  protected readonly muted = signal(false);
  protected readonly status = signal<PlayerStatus>({ state: 'idle' });
  protected readonly text = computed(() => statusText(this.status()));
}
