import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';

import { Watch } from './watch';
import { AlertsStore } from '../core/alerts.store';
import { STORAGE_BACKEND, type StorageBackend } from '../core/storage/storage-backend';
import { LineupStore } from '../iptv/lineup.store';
import { Player, type PlayerStatus } from '../shared/player';

import type { MockInstance } from 'vitest';

class MemoryBackend implements StorageBackend {
  readonly name = 'memory';
  async get<T>() {
    return undefined as T | undefined;
  }
  async set() {
    /* no-op */
  }
  async remove() {
    /* no-op */
  }
}

describe('Watch', () => {
  let fixture: ComponentFixture<Watch>;
  let el: HTMLElement;
  let lineup: LineupStore;
  let navigate: MockInstance<Router['navigate']>;
  const danger = signal<unknown[]>([]);
  const dangerEvents = signal<string[]>([]);

  beforeEach(() => {
    danger.set([]);
    dangerEvents.set([]);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('no network in tests')),
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: STORAGE_BACKEND, useValue: new MemoryBackend() },
        { provide: AlertsStore, useValue: { danger, dangerEvents } },
      ],
    });
    lineup = TestBed.inject(LineupStore);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    ['a', 'b', 'c'].forEach((k, i) => {
      lineup.add({ key: k, name: k.toUpperCase(), url: `http://tv.example/${k}.ts`, streamId: i });
    });
  });

  afterEach(() => {
    // Destroy the player while HTMLMediaElement.load is still stubbed (jsdom lacks it).
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const render = async (key?: string) => {
    fixture = TestBed.createComponent(Watch);
    fixture.componentRef.setInput('key', key);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  };
  const press = (key: string, target: EventTarget = window) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  const emit = async (s: PlayerStatus) => {
    fixture.debugElement.query(By.directive(Player)).triggerEventHandler('status', s);
    await fixture.whenStable();
    return el.querySelector('.status')?.textContent;
  };

  it('plays the default channel without a key and lists the lineup', async () => {
    lineup.setDefault('b');
    await render();
    expect(el.querySelector('.info b')?.textContent).toBe('B');
    expect(el.querySelectorAll('nav.list a')).toHaveLength(3);
    expect(el.querySelector('nav.list a.active')).toBeNull();
  });

  it('plays the channel from the route and marks it active', async () => {
    await render('c');
    expect(el.querySelector('.info b')?.textContent).toBe('C');
    expect(el.querySelector('nav.list a.active')?.textContent).toContain('3 C');
  });

  it('describes the player status', async () => {
    await render('a');
    expect(await emit({ state: 'loading' })).toBe('Loading…');
    expect(await emit({ state: 'playing' })).toBe('Live');
    expect(await emit({ state: 'playing', detail: 'avc1 / mp4a' })).toBe('Live · avc1 / mp4a');
    expect(await emit({ state: 'reconnecting', attempt: 2, reason: 'stalled' })).toBe(
      'Reconnecting (attempt 2): stalled',
    );
    expect(await emit({ state: 'error', message: 'nope' })).toBe('nope');
    expect(await emit({ state: 'idle' })).toBe('');
  });

  it('warns about danger alerts', async () => {
    danger.set([{}]);
    dangerEvents.set(['Tornado Warning', 'Flash Flood Emergency']);
    await render('a');
    expect(el.querySelector('.warn')?.textContent).toContain(
      'Tornado Warning · Flash Flood Emergency for your location',
    );
  });

  it('shows what is on for Xtream channels', async () => {
    const b64 = (s: string) => btoa(s);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            epg_listings: [
              {
                title: b64('Evening News'),
                description: '',
                start_timestamp: 1_760_000_000,
                stop_timestamp: 1_760_003_600,
              },
            ],
          }),
        ),
      ),
    );
    lineup.source.set({
      kind: 'xtream',
      server: 'http://tv.example',
      username: 'u',
      password: 'p',
      format: 'ts',
    });
    await render('b');
    await fixture.whenStable();
    expect(el.querySelector('.info span')?.textContent).toContain('Evening News');
  });

  it('clears now-playing when the lookup fails', async () => {
    lineup.source.set({
      kind: 'xtream',
      server: 'http://tv.example',
      username: 'u',
      password: 'p',
      format: 'ts',
    });
    await render('b');
    await fixture.whenStable();
    expect(el.querySelector('.info span:not(.status)')).toBeNull();
  });

  it('shows an empty lineup', async () => {
    ['a', 'b', 'c'].forEach((k) => {
      lineup.remove(k);
    });
    await render();
    expect(el.querySelector('.info b')?.textContent).toBe('No channel');
    expect(el.textContent).toContain('Lineup is empty.');
    press('ArrowDown');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('flips channels with arrows, remote keys and digits', async () => {
    await render('a');
    const e = press('ArrowDown');
    expect(e.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenLastCalledWith(['/watch', 'b'], {
      replaceUrl: true,
      queryParamsHandling: 'preserve',
    });
    press('ArrowUp');
    expect(navigate).toHaveBeenLastCalledWith(['/watch', 'c'], expect.anything());
    press('PageDown');
    press('ChannelDown');
    expect(navigate).toHaveBeenLastCalledWith(['/watch', 'b'], expect.anything());
    press('PageUp');
    press('ChannelUp');
    expect(navigate).toHaveBeenLastCalledWith(['/watch', 'c'], expect.anything());
    press('2');
    expect(navigate).toHaveBeenLastCalledWith(['/watch', 'b'], expect.anything());
    expect(navigate).toHaveBeenCalledTimes(7);

    expect(press('9').defaultPrevented).toBe(false);
    expect(press('x').defaultPrevented).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(7);
  });

  it('ignores keys typed into inputs', async () => {
    await render('a');
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      press('ArrowDown', input);
    } finally {
      input.remove();
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('logs failed navigation', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    navigate.mockRejectedValue(new Error('nav'));
    await render('a');
    press('ArrowDown');
    await fixture.whenStable();
    expect(error).toHaveBeenCalledWith('Navigation failed', expect.any(Error));
  });

  it('toggles fullscreen on the video with F', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await render('a');
    const video = el.querySelector('video')!;
    document.body.appendChild(el);
    const request = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('denied'));
    Object.assign(video, { requestFullscreen: request });
    press('f');
    expect(request).toHaveBeenCalledWith();
    await fixture.whenStable();
    expect(error).toHaveBeenCalledWith('Fullscreen request failed', expect.any(Error));

    const exit = vi.fn<() => Promise<void>>().mockResolvedValue();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: video });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    try {
      press('F');
      expect(exit).toHaveBeenCalledWith();
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement');
      Reflect.deleteProperty(document, 'exitFullscreen');
      el.remove();
    }
    expect(navigate).not.toHaveBeenCalled();
  });
});
