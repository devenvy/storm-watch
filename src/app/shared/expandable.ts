import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';

/**
 * Lets a card pop out to a large overlay (and optionally true fullscreen). The card is
 * enlarged in place rather than cloned, so live video and map state carry over.
 */
@Directive({
  selector: '[swExpandable]',
  host: {
    '[class.card-expanded]': 'expanded()',
    '(document:keydown.escape)': 'expanded.set(false)',
  },
  exportAs: 'card',
})
export class Expandable {
  readonly expanded = signal(false);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  fullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      this.el.nativeElement.requestFullscreen?.();
    }
  }
}

@Component({
  selector: 'sw-card-buttons',
  template: `
    @if (card().expanded()) {
      <button title="Fullscreen" aria-label="Fullscreen" (click)="card().fullscreen()">⛶</button>
    }
    <button
      [title]="card().expanded() ? 'Close (Esc)' : 'Expand'"
      [attr.aria-label]="card().expanded() ? 'Close' : 'Expand'"
      (click)="card().toggle()"
    >
      {{ card().expanded() ? '✕' : '⤢' }}
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
      gap: 4px;
      text-transform: none;
      letter-spacing: 0;
    }
    button {
      padding: 1px 7px;
      font-size: 13px;
      line-height: 1.4;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardButtons {
  readonly card = input.required<Expandable>();
}
