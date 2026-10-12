import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';

const MAX_INITIALS = 2;

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
  styleUrl: './channel-logo.scss',
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
      .slice(0, MAX_INITIALS)
      .map((w) => w.charAt(0).toUpperCase())
      .join('');
  });
}
