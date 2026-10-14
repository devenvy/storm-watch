import { Directive, ElementRef, inject, signal } from '@angular/core';

export { CardButtons } from './card-buttons';

/** Fullscreen was denied or already exited; the card stays enlarged either way. */
function ignoreFullscreenError(): void {
  // Nothing to recover: the overlay state does not depend on true fullscreen.
}

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
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly expanded = signal(false);

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  fullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(ignoreFullscreenError);
    } else {
      // Not every browser can fullscreen arbitrary elements (e.g. iPhone Safari).
      const el: Partial<Pick<HTMLElement, 'requestFullscreen'>> = this.el.nativeElement;
      el.requestFullscreen?.().catch(ignoreFullscreenError);
    }
  }
}
