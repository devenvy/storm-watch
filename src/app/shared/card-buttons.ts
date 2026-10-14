import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { Expandable } from './expandable';

/** Expand / fullscreen controls for a card that carries the `swExpandable` directive. */
@Component({
  selector: 'sw-card-buttons',
  template: `
    @if (card().expanded()) {
      <button
        type="button"
        title="Fullscreen"
        aria-label="Fullscreen"
        (click)="card().fullscreen()"
      >
        ⛶
      </button>
    }
    <button
      type="button"
      [title]="card().expanded() ? 'Close (Esc)' : 'Expand'"
      [attr.aria-label]="card().expanded() ? 'Close' : 'Expand'"
      (click)="card().toggle()"
    >
      {{ card().expanded() ? '✕' : '⤢' }}
    </button>
  `,
  styleUrl: './card-buttons.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardButtons {
  readonly card = input.required<Expandable>();
}
