import { type ComponentFixture, TestBed } from '@angular/core/testing';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

import { Player, type PlayerStatus } from './player';

import type { MockInstance } from 'vitest';

type Listener = (...args: unknown[]) => void;

/** Stand-in for an mpegts.js player that records its event handlers. */
function fakeTsPlayer() {
  const handlers = new Map<string, Listener>();
  return {
    handlers,
    on: vi.fn((event: string, fn: Listener) => {
      handlers.set(event, fn);
    }),
    attachMediaElement: vi.fn<(v: HTMLMediaElement) => void>(),
    load: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    unload: vi.fn<() => void>(),
    detachMediaElement: vi.fn<() => void>(),
    destroy: vi.fn<() => void>(),
  };
}

describe('Player', () => {
  let fixture: ComponentFixture<Player>;
  let statuses: PlayerStatus[];
  let play: MockInstance<HTMLMediaElement['play']>;
  let paused: boolean;
  let currentTime: number;
  let hlsHandler: Listener | undefined;

  const video = () => (fixture.nativeElement as HTMLElement).querySelector('video')!;
  const last = () => statuses.at(-1);
  /** Run effects and let pending promises (format probe, play()) settle. */
  const settle = async () => {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
  };
  const load = async (url: string | null) => {
    fixture.componentRef.setInput('url', url);
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    paused = false;
    currentTime = 0;
    hlsHandler = undefined;
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused);
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(
      () => currentTime,
    );
    vi.spyOn(Hls, 'isSupported').mockReturnValue(true);
    vi.spyOn(Hls.prototype, 'loadSource').mockImplementation(() => undefined);
    vi.spyOn(Hls.prototype, 'attachMedia').mockImplementation(() => undefined);
    vi.spyOn(Hls.prototype, 'recoverMediaError').mockImplementation(() => undefined);
    vi.spyOn(Hls.prototype, 'swapAudioCodec').mockImplementation(() => undefined);
    vi.spyOn(Hls.prototype, 'on').mockImplementation((_event, fn) => {
      hlsHandler = fn as Listener;
    });
    vi.spyOn(mpegts, 'isSupported').mockReturnValue(true);

    statuses = [];
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(Player);
    fixture.componentInstance.status.subscribe((s) => {
      statuses.push(s);
    });
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const fatal = (type: string, details = 'x') => {
    hlsHandler?.('hlsError', { fatal: true, type, details });
  };

  it('is idle without a URL', async () => {
    await load(null);
    expect(last()).toEqual({ state: 'idle' });
  });

  it('plays HLS through hls.js and reports playback', async () => {
    await load('http://tv.example/a.m3u8');
    expect(statuses).toContainEqual({ state: 'loading' });
    expect(Hls.prototype.loadSource).toHaveBeenCalledWith('http://tv.example/a.m3u8');
    expect(Hls.prototype.attachMedia).toHaveBeenCalledWith(video());
    expect(play).toHaveBeenCalledWith();
    video().onplaying?.(new Event('playing'));
    expect(last()).toEqual({ state: 'playing', detail: undefined });
  });

  it('recovers media errors in place twice, then reconnects with backoff', async () => {
    await load('http://tv.example/b.m3u8?token=1');
    hlsHandler?.('hlsError', { fatal: false, type: Hls.ErrorTypes.MEDIA_ERROR });
    expect(Hls.prototype.recoverMediaError).not.toHaveBeenCalled();
    fatal(Hls.ErrorTypes.MEDIA_ERROR);
    expect(Hls.prototype.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(Hls.prototype.swapAudioCodec).not.toHaveBeenCalled();
    fatal(Hls.ErrorTypes.MEDIA_ERROR);
    expect(Hls.prototype.swapAudioCodec).toHaveBeenCalledTimes(1);
    expect(Hls.prototype.recoverMediaError).toHaveBeenCalledTimes(2);

    fatal(Hls.ErrorTypes.MEDIA_ERROR, 'bufferStalledError');
    expect(last()).toEqual({
      state: 'reconnecting',
      attempt: 1,
      reason: 'mediaError: bufferStalledError',
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(Hls.prototype.loadSource).toHaveBeenCalledTimes(2);
    // Retries do not flash "loading" again.
    expect(last()?.state).toBe('reconnecting');

    fatal(Hls.ErrorTypes.NETWORK_ERROR, 'manifestLoadError');
    expect(last()).toMatchObject({ attempt: 2, reason: 'networkError: manifestLoadError' });
    await vi.advanceTimersByTimeAsync(1999);
    expect(Hls.prototype.loadSource).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(Hls.prototype.loadSource).toHaveBeenCalledTimes(3);
  });

  it('falls back to native HLS playback', async () => {
    vi.spyOn(Hls, 'isSupported').mockReturnValue(false);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    await load('http://tv.example/native.m3u8');
    expect(video().src).toBe('http://tv.example/native.m3u8');
    video().onerror?.(new Event('error'));
    expect(last()).toMatchObject({ state: 'reconnecting', reason: 'native HLS error' });
  });

  it('reports browsers that cannot play HLS', async () => {
    vi.spyOn(Hls, 'isSupported').mockReturnValue(false);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    await load('http://tv.example/none.m3u8');
    expect(last()).toEqual({ state: 'error', message: 'HLS not supported in this browser.' });
    expect(play).not.toHaveBeenCalled();
  });

  it('plays MPEG-TS through mpegts.js with codec details', async () => {
    const p = fakeTsPlayer();
    const create = vi.spyOn(mpegts, 'createPlayer').mockReturnValue(p as unknown as mpegts.Player);
    await load('http://tv.example/c.ts');
    expect(create).toHaveBeenCalledWith(
      { type: 'mpegts', isLive: true, url: 'http://tv.example/c.ts' },
      expect.objectContaining({ enableWorker: true }),
    );
    expect(p.attachMediaElement).toHaveBeenCalledWith(video());
    p.handlers.get(mpegts.Events.MEDIA_INFO)?.({ videoCodec: 'avc1', audioCodec: 'mp4a' });
    video().onplaying?.(new Event('playing'));
    expect(last()).toEqual({ state: 'playing', detail: 'avc1 / mp4a' });

    p.handlers.get(mpegts.Events.MEDIA_INFO)?.({});
    video().onplaying?.(new Event('playing'));
    expect(last()).toEqual({ state: 'playing', detail: '? / ?' });

    p.handlers.get(mpegts.Events.ERROR)?.('NetworkError', 'Exception');
    expect(last()).toMatchObject({ reason: 'NetworkError: Exception' });
    expect(p.destroy).toHaveBeenCalledWith();
  });

  it('ignores errors while tearing down an mpegts.js player', async () => {
    const p = fakeTsPlayer();
    p.unload.mockImplementation(() => {
      throw new Error('gone');
    });
    vi.spyOn(mpegts, 'createPlayer').mockReturnValue(p as unknown as mpegts.Player);
    await load('http://tv.example/d.ts');
    await load(null);
    expect(last()).toEqual({ state: 'idle' });
  });

  it('reports browsers without MSE', async () => {
    vi.spyOn(mpegts, 'isSupported').mockReturnValue(false);
    await load('http://tv.example/e.ts');
    expect(last()).toEqual({
      state: 'error',
      message: 'This browser cannot play MPEG-TS (no MSE).',
    });
  });

  it('asks the user to press play when autoplay is blocked', async () => {
    play.mockRejectedValue(new Error('NotAllowedError'));
    await load('http://tv.example/f.m3u8');
    expect(last()).toEqual({ state: 'error', message: 'Autoplay blocked: press play.' });
  });

  it('reports unexpected start failures', async () => {
    vi.spyOn(Hls.prototype, 'loadSource').mockImplementation(() => {
      throw new Error('boom');
    });
    await load('http://tv.example/g.m3u8');
    expect(last()).toEqual({ state: 'error', message: 'boom' });

    vi.spyOn(Hls.prototype, 'loadSource').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- verifies non-Error values are reported too
      throw 'raw';
    });
    await load('http://tv.example/h.m3u8');
    expect(last()).toEqual({ state: 'error', message: 'raw' });
  });

  it('reconnects when the stream ends', async () => {
    await load('http://tv.example/i.m3u8');
    video().onended?.(new Event('ended'));
    expect(last()).toMatchObject({ state: 'reconnecting', reason: 'stream ended' });
  });

  describe('watchdog', () => {
    it('reloads a stream whose picture stopped advancing', async () => {
      await load('http://tv.example/j.m3u8');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(last()?.state).not.toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(4_000);
      expect(last()).toMatchObject({ state: 'reconnecting', reason: 'playback stalled' });
    });

    it('leaves a paused stream alone', async () => {
      paused = true;
      await load('http://tv.example/k.m3u8');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(statuses.map((s) => s.state)).not.toContain('reconnecting');
    });

    it('resets the backoff after a healthy stretch of playback', async () => {
      await load('http://tv.example/l.m3u8');
      fatal(Hls.ErrorTypes.NETWORK_ERROR);
      await vi.advanceTimersByTimeAsync(1000);
      video().onplaying?.(new Event('playing'));
      for (let t = 0; t < 32_000; t += 2000) {
        currentTime += 2;
        await vi.advanceTimersByTimeAsync(2000);
      }
      fatal(Hls.ErrorTypes.NETWORK_ERROR);
      expect(last()).toMatchObject({ state: 'reconnecting', attempt: 1 });
    });
  });

  describe('format detection', () => {
    const stubProbe = (response: Response | Error) => {
      const spy = vi.fn<typeof fetch>(async () => {
        if (response instanceof Error) {
          throw response;
        }
        return response;
      });
      vi.stubGlobal('fetch', spy);
      return spy;
    };

    it('detects HLS from the content type and remembers it', async () => {
      const spy = stubProbe(
        new Response('', { headers: { 'Content-Type': 'application/vnd.apple.mpegURL' } }),
      );
      await load('http://tv.example/live/1');
      expect(Hls.prototype.loadSource).toHaveBeenCalledWith('http://tv.example/live/1');
      await load(null);
      await load('http://tv.example/live/1');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(Hls.prototype.loadSource).toHaveBeenCalledTimes(2);
    });

    it('detects HLS from a playlist header', async () => {
      stubProbe(new Response('#EXTM3U\n#EXT-X-VERSION:3\n'));
      await load('http://tv.example/live/2');
      expect(Hls.prototype.loadSource).toHaveBeenCalledWith('http://tv.example/live/2');
    });

    it('treats other bodies as MPEG-TS', async () => {
      const p = fakeTsPlayer();
      vi.spyOn(mpegts, 'createPlayer').mockReturnValue(p as unknown as mpegts.Player);
      stubProbe(new Response(new Uint8Array([0x47, 0x40, 0x00])));
      await load('http://tv.example/live/3');
      expect(p.load).toHaveBeenCalledWith();
    });

    it('treats an empty or failed probe as MPEG-TS and retries it next time', async () => {
      const p = fakeTsPlayer();
      const create = vi
        .spyOn(mpegts, 'createPlayer')
        .mockReturnValue(p as unknown as mpegts.Player);
      const spy = stubProbe(new Response(null, { status: 404 }));
      await load('http://tv.example/live/4');
      expect(create).toHaveBeenCalledTimes(1);
      await load(null);
      await load('http://tv.example/live/4');
      expect(spy).toHaveBeenCalledTimes(2);

      stubProbe(new TypeError('Failed to fetch'));
      await load('http://tv.example/live/5');
      expect(create).toHaveBeenCalledTimes(3);
    });

    it('ignores a probe that finishes after the channel changed', async () => {
      let answer!: (r: Response) => void;
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(
          async () =>
            new Promise<Response>((r) => {
              answer = r;
            }),
        ),
      );
      await load('http://tv.example/live/6');
      await load('http://tv.example/m.m3u8');
      answer(new Response('#EXTM3U'));
      await settle();
      expect(Hls.prototype.loadSource).toHaveBeenCalledTimes(1);
      expect(Hls.prototype.loadSource).toHaveBeenCalledWith('http://tv.example/m.m3u8');
    });
  });
});
