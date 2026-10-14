import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AlertsStore } from '../core/alerts.store';
import { LineupStore } from '../iptv/lineup.store';
import { type NowPlaying, xtreamNowPlaying } from '../iptv/sources';
import { ChannelLogo } from '../shared/channel-logo';
import { Player, type PlayerStatus } from '../shared/player';

function logFullscreenError(err: unknown): void {
  console.error('Fullscreen request failed', err);
}

/** Full-screen-friendly player with lineup flipping (arrows, number keys, remote d-pad). */
@Component({
  selector: 'sw-watch',
  imports: [Player, RouterLink, DatePipe, ChannelLogo],
  template: `
    <div class="layout">
      <div class="stage">
        <sw-player [url]="channel()?.url ?? null" (status)="status.set($event)" />
        <div class="info">
          <b>{{ channel()?.name ?? 'No channel' }}</b>
          @if (now(); as n) {
            <span
              >· {{ n.title }}
              <small
                >({{ n.start | date: 'shortTime' }}–{{ n.end | date: 'shortTime' }})</small
              ></span
            >
          }
          <span class="status" [class]="status().state">{{ statusText() }}</span>
        </div>
        @if (alerts.danger().length) {
          <div class="warn">⚠ {{ alerts.dangerEvents().join(' · ') }} for your location</div>
        }
      </div>
      <nav class="list">
        @for (c of lineup.channels(); track c.key) {
          <a
            replaceUrl
            queryParamsHandling="preserve"
            [routerLink]="['/watch', c.key]"
            [class.active]="c.key === key()"
          >
            <sw-logo [src]="c.logo" [name]="c.name" />
            <span
              ><small>{{ $index + 1 }}</small> {{ c.name }}</span
            >
          </a>
        } @empty {
          <p class="muted">
            Lineup is empty. <a routerLink="/setup" fragment="iptv">Set up IPTV</a>.
          </p>
        }
        <p class="hint">↑/↓ change channel · 1–9 jump · F fullscreen</p>
      </nav>
    </div>
  `,
  styleUrl: './watch.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:keydown)': 'onKey($event)' },
})
export class Watch {
  protected readonly lineup = inject(LineupStore);
  protected readonly alerts = inject(AlertsStore);
  private readonly router = inject(Router);

  /** Route param, bound via withComponentInputBinding. */
  readonly key = input<string>();

  protected readonly status = signal<PlayerStatus>({ state: 'idle' });
  protected readonly now = signal<NowPlaying | null>(null);
  protected readonly channel = computed(() => {
    const k = this.key();
    return (k ? this.lineup.byKey(k) : undefined) ?? this.lineup.defaultChannel();
  });
  protected readonly statusText = computed(() => {
    const s = this.status();
    switch (s.state) {
      case 'loading':
        return 'Loading…';
      case 'playing':
        return s.detail ? `Live · ${s.detail}` : 'Live';
      case 'reconnecting':
        return `Reconnecting (attempt ${s.attempt}): ${s.reason}`;
      case 'error':
        return s.message;
      case 'idle':
      default:
        return '';
    }
  });

  constructor() {
    effect(() => {
      const ch = this.channel();
      const src = this.lineup.source();
      this.now.set(null);
      if (typeof ch?.streamId === 'number' && src?.kind === 'xtream') {
        xtreamNowPlaying(src, ch.streamId)
          .then((n) => this.now.set(n))
          .catch(() => this.now.set(null));
      }
    });
  }

  protected onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      return;
    }
    const cur = this.channel();
    if (!cur) {
      return;
    }
    let next = null;
    if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'ChannelUp') {
      next = this.lineup.neighbor(cur.key, -1);
    } else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'ChannelDown') {
      next = this.lineup.neighbor(cur.key, 1);
    } else if (/^[1-9]$/.test(e.key)) {
      next = this.lineup.channels()[Number(e.key) - 1] ?? null;
    } else if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(logFullscreenError);
      } else {
        document.querySelector('sw-player video')?.requestFullscreen().catch(logFullscreenError);
      }
      return;
    }
    if (next) {
      e.preventDefault();
      this.router
        .navigate(['/watch', next.key], {
          replaceUrl: true,
          queryParamsHandling: 'preserve',
        })
        .catch((err: unknown) => {
          console.error('Navigation failed', err);
        });
    }
  }
}
