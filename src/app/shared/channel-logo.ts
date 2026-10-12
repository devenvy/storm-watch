import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';

/** Fixed-size channel logo; falls back to initials when missing or broken. */
@Component({
  selector: 'sw-logo',
  template: `
    @if (src() && !failed()) {
      <img alt="" loading="lazy" [src]="src()" (error)="failed.set(true)" />
    } @else {
      <span aria-hidden="true">{{ initials() }}</span>
    }
  `,
  styles: `
    :host {
      width: 32px;
      height: 32px;
      flex: none;
      display: grid;
      place-items: center;
      border-radius: 4px;
      overflow: hidden;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    span {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      background: #21262d;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChannelLogo {
  readonly src = input<string | undefined>();
  readonly name = input('');

  /** Reset when the source changes (e.g. list rows reused for a different channel). */
  protected readonly failed = linkedSignal({ source: this.src, computation: () => false });

  protected readonly initials = computed(() => {
    // Skip provider prefixes like "Tubi:", "US|", "Amazon US:" before taking initials.
    const name = this.name().replace(/^.*[:|]\s*/, '') || this.name();
    return name
      .split(/\s+/)
      .filter((w) => /^[A-Za-z0-9]/.test(w))
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  });
}
