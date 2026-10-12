import {
  ChangeDetectionStrategy,
  Component,
  effect,
  type ElementRef,
  input,
  type OnDestroy,
  output,
  viewChild,
} from '@angular/core';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

export type PlayerStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'playing'; detail?: string }
  | { state: 'reconnecting'; attempt: number; reason: string }
  | { state: 'error'; message: string };

const STALL_MS = 10_000;
const WATCHDOG_MS = 2_000;
/** Playback this long without trouble resets the retry backoff. */
const HEALTHY_MS = 30_000;
const MAX_BACKOFF_MS = 15_000;

type StreamKind = 'hls' | 'ts';
const kinds = new Map<string, StreamKind>();

/**
 * HLS or MPEG-TS? Decided by extension when there is one; otherwise by peeking at the
 * response (content type, or a playlist's #EXTM3U header) and closing it straight away.
 */
async function streamKind(url: string): Promise<StreamKind> {
  if (/\.m3u8(\?|$)/i.test(url)) {
    return 'hls';
  }
  if (/\.ts(\?|$)/i.test(url)) {
    return 'ts';
  }
  const known = kinds.get(url);
  if (known) {
    return known;
  }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    let kind: StreamKind = 'ts';
    if (/mpegurl/i.test(r.headers.get('content-type') ?? '')) {
      kind = 'hls';
    } else {
      const reader = r.body?.getReader();
      const first = await reader?.read();
      if (
        first?.value &&
        new TextDecoder().decode(first.value.subarray(0, 16)).startsWith('#EXTM3U')
      ) {
        kind = 'hls';
      }
      await reader?.cancel();
    }
    // Only remember real answers; a failed probe is retried on the next (re)connect.
    if (r.ok) {
      kinds.set(url, kind);
    }
    return kind;
  } catch {
    // Unreachable or no CORS: fall back to MPEG-TS and let the player report errors.
    return 'ts';
  }
}

/**
 * Plays HLS (hls.js / native) or MPEG-TS (mpegts.js) entirely client-side, and keeps
 * a live stream alive: network errors reconnect with backoff, media errors are
 * recovered in place, and a watchdog reloads the stream if playback stalls.
 */
@Component({
  selector: 'sw-player',
  template: `<video #video controls autoplay playsinline [muted]="muted()"></video>`,
  styles: `
    :host {
      display: block;
      background: #000;
    }
    video {
      width: 100%;
      height: 100%;
      display: block;
      background: #000;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Player implements OnDestroy {
  readonly url = input<string | null>(null);
  readonly muted = input(false);
  readonly status = output<PlayerStatus>();

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private hls: Hls | null = null;
  private ts: mpegts.Player | null = null;
  private attempt = 0;
  private mediaRecoveries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private lastTime = -1;
  private lastProgress = 0;
  private healthySince = 0;
  /** Incremented per start/teardown so async work from an old start is ignored. */
  private run = 0;

  constructor() {
    effect(() => {
      const url = this.url();
      this.attempt = 0;
      void this.start(url);
    });
  }

  private teardown(): void {
    this.run++;
    clearTimeout(this.retryTimer);
    clearInterval(this.watchdog);
    this.hls?.destroy();
    this.hls = null;
    if (this.ts) {
      try {
        this.ts.pause();
        this.ts.unload();
        this.ts.detachMediaElement();
        this.ts.destroy();
      } catch {
        /* already gone */
      }
      this.ts = null;
    }
    const v = this.video().nativeElement;
    v.onplaying = v.onended = v.onerror = null;
    v.removeAttribute('src');
    v.load();
  }

  /** Tear down and reconnect after an exponential backoff. */
  private reconnect(reason: string): void {
    const url = this.url();
    if (!url) {
      return;
    }
    this.teardown();
    this.attempt++;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.attempt - 1));
    this.status.emit({ state: 'reconnecting', attempt: this.attempt, reason });
    this.retryTimer = setTimeout(() => void this.start(url), delay);
  }

  private async start(url: string | null): Promise<void> {
    this.teardown();
    const run = ++this.run;
    this.mediaRecoveries = 0;
    if (!url) {
      this.status.emit({ state: 'idle' });
      return;
    }
    const v = this.video().nativeElement;
    if (location.protocol === 'https:' && url.startsWith('http:')) {
      this.status.emit({
        state: 'error',
        message: 'Stream is http on an https page (mixed content).',
      });
      return;
    }
    if (!this.attempt) {
      this.status.emit({ state: 'loading' });
    }
    const kind = await streamKind(url);
    // The channel changed (or the player was destroyed) while we were detecting the format.
    if (run !== this.run) {
      return;
    }

    let detail: string | undefined;
    v.onplaying = () => {
      this.healthySince = Date.now();
      this.status.emit({ state: 'playing', detail });
    };
    v.onended = () => this.reconnect('stream ended');

    if (kind === 'hls') {
      if (Hls.isSupported()) {
        const hls = (this.hls = new Hls({
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          maxBufferLength: 30,
          backBufferLength: 30,
          manifestLoadingMaxRetry: 4,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 6,
        }));
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (!d.fatal) {
            return;
          }
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && this.mediaRecoveries < 2) {
            // First try a plain recovery, then one with codec swap, before a full reload.
            if (this.mediaRecoveries++ === 1) {
              hls.swapAudioCodec();
            }
            hls.recoverMediaError();
            return;
          }
          this.reconnect(`${d.type}: ${d.details}`);
        });
        hls.loadSource(url);
        hls.attachMedia(v);
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = url;
        v.onerror = () => this.reconnect('native HLS error');
      } else {
        this.status.emit({ state: 'error', message: 'HLS not supported in this browser.' });
        return;
      }
    } else if (mpegts.isSupported()) {
      const p = (this.ts = mpegts.createPlayer(
        { type: 'mpegts', isLive: true, url },
        {
          enableWorker: true,
          liveBufferLatencyChasing: true,
          lazyLoad: false,
          autoCleanupSourceBuffer: true,
        },
      ));
      p.on(mpegts.Events.ERROR, (type: string, d: string) => this.reconnect(`${type}: ${d}`));
      p.on(mpegts.Events.MEDIA_INFO, (mi: { videoCodec?: string; audioCodec?: string }) => {
        detail = `${mi.videoCodec ?? '?'} / ${mi.audioCodec ?? '?'}`;
      });
      p.attachMediaElement(v);
      p.load();
    } else {
      this.status.emit({ state: 'error', message: 'This browser cannot play MPEG-TS (no MSE).' });
      return;
    }

    v.play()?.catch(() =>
      this.status.emit({ state: 'error', message: 'Autoplay blocked: press play.' }),
    );
    this.startWatchdog();
  }

  /** Reload when the picture stops advancing even though nothing reported an error. */
  private startWatchdog(): void {
    const v = this.video().nativeElement;
    this.lastTime = -1;
    this.lastProgress = Date.now();
    this.watchdog = setInterval(() => {
      if (v.paused) {
        this.lastProgress = Date.now();
        return;
      }
      if (v.currentTime !== this.lastTime) {
        this.lastTime = v.currentTime;
        this.lastProgress = Date.now();
        if (this.attempt && this.healthySince && Date.now() - this.healthySince > HEALTHY_MS) {
          this.attempt = 0;
        }
        return;
      }
      if (Date.now() - this.lastProgress > STALL_MS) {
        this.reconnect('playback stalled');
      }
    }, WATCHDOG_MS);
  }

  ngOnDestroy(): void {
    this.teardown();
  }
}
