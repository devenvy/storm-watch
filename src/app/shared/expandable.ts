import { ChangeDetectionStrategy, Component, Directive, ElementRef, inject, input, signal } from '@angular/core';

/**
 * Lets a card pop out to a large overlay (and optionally true fullscreen). The card is
 * enlarged in place rather than cloned, so live video and map state carry over.
 */
@Directive({
  selector: '[swExpandable]',
  exportAs: 'card',
  host: {
    '[class.card-expanded]': 'expanded()',
    '(document:keydown.escape)': 'expanded.set(false)',
  },
})
export class Expandable {
  readonly expanded = signal(false);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  toggle(): void {
    this.expanded.update(v => !v);
  }

  fullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.el.nativeElement.requestFullscreen?.();
  }
}

@Component({
  selector: 'sw-card-buttons',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (card().expanded()) {
      <button (click)="card().fullscreen()" title="Fullscreen" aria-label="Fullscreen">⛶</button>
    }
    <button (click)="card().toggle()" [title]="card().expanded() ? 'Close (Esc)' : 'Expand'"
      [attr.aria-label]="card().expanded() ? 'Close' : 'Expand'">{{ card().expanded() ? '✕' : '⤢' }}</button>
  `,
  styles: `
    :host { display: inline-flex; gap: 4px; text-transform: none; letter-spacing: 0; }
    button { padding: 1px 7px; font-size: 13px; line-height: 1.4; }
  `,
})
export class CardButtons {
  readonly card = input.required<Expandable>();
}
