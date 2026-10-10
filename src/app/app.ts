import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AlertsStore } from './core/alerts.store';
import { SettingsStore } from './core/settings.store';
import { ShareService } from './core/share';

@Component({
  selector: 'sw-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '[class.kiosk]': 'kiosk()' },
})
export class App {
  protected readonly alerts = inject(AlertsStore);
  protected readonly settings = inject(SettingsStore);
  private readonly share = inject(ShareService);
  private readonly router = inject(Router);

  protected readonly clock = signal(new Date());
  /** ?kiosk in the URL hides the header (TVs, signage). */
  protected readonly kiosk = signal(false);
  protected readonly notice = signal<string | null>(null);
  /** Dashboard nav item is active on any board, not only the first. */
  protected readonly onBoard = signal(true);

  constructor() {
    const tick = setInterval(() => this.clock.set(new Date()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));

    this.router.events.pipe(takeUntilDestroyed()).subscribe(e => {
      if (!(e instanceof NavigationEnd)) return;
      const tree = this.router.parseUrl(this.router.url);
      const path = this.router.url.split(/[?#]/)[0];
      this.onBoard.set(path === '/' || path.startsWith('/d/'));
      const params = tree.queryParamMap;
      const k = params.get('kiosk');
      this.kiosk.set(k !== null && k !== '0' && k !== 'false');
      const cfg = params.get('cfg');
      if (cfg) void this.applyShare(cfg);
    });
  }

  /** Apply a share link, then drop the payload from the address bar. */
  private async applyShare(cfg: string): Promise<void> {
    try {
      const applied = await this.share.apply(cfg);
      if (applied) this.notice.set('Shared setup applied.');
    } catch (e) {
      this.notice.set(`Could not apply share link: ${(e as Error).message}`);
    }
    await this.router.navigate([], { queryParams: { cfg: null }, queryParamsHandling: 'merge', replaceUrl: true });
    setTimeout(() => this.notice.set(null), 6000);
  }
}
