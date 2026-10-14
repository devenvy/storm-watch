import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import Hls from 'hls.js';

import { PlayerWidget, statusText } from './player-widget';
import { STORAGE_BACKEND, type StorageBackend } from '../../core/storage/storage-backend';
import { LineupStore } from '../../iptv/lineup.store';

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

describe('statusText', () => {
  it('describes each player state', () => {
    expect(statusText({ state: 'idle' })).toBe('');
    expect(statusText({ state: 'loading' })).toBe('loading…');
    expect(statusText({ state: 'playing' })).toBe('live');
    expect(statusText({ state: 'reconnecting', attempt: 3, reason: 'x' })).toBe(
      'reconnecting (3)…',
    );
    expect(statusText({ state: 'error', message: 'bad' })).toBe('bad');
  });
});

describe('PlayerWidget', () => {
  let lineup: LineupStore;

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(Hls, 'isSupported').mockReturnValue(false);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: STORAGE_BACKEND, useValue: new MemoryBackend() }],
    });
    lineup = TestBed.inject(LineupStore);
  });

  afterEach(() => {
    // Destroy the player while HTMLMediaElement.load is still stubbed (jsdom lacks it).
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  const render = async (inputs: { ch?: string; pinned?: string } = {}) => {
    const fixture = TestBed.createComponent(PlayerWidget);
    fixture.componentRef.setInput('ch', inputs.ch);
    fixture.componentRef.setInput('pinned', inputs.pinned);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };

  it('invites the user to add a source without channels', async () => {
    const { el } = await render({ ch: 'a' });
    expect(el.querySelector('.title')?.textContent).toContain('Live TV');
    expect(el.textContent).toContain('Add an IPTV source');
  });

  it('asks the user to pick a channel', async () => {
    lineup.add({ key: 'a', name: 'Alpha', url: 'http://tv.example/a.m3u8' });
    const { el } = await render();
    expect(el.textContent).toContain('Pick a channel to watch here.');
  });

  it('plays the picked channel with mute and stop controls', async () => {
    lineup.add({ key: 'a', name: 'Alpha', url: 'http://tv.example/a.m3u8' });
    const { fixture, el } = await render({ ch: 'a' });
    expect(el.querySelector('.title')?.textContent).toContain('Alpha');
    expect(el.querySelector('sw-player')).not.toBeNull();
    expect(el.querySelector('.pstat')?.textContent).toBe('HLS not supported in this browser.');
    expect(el.querySelector('[aria-label="Stop"]')).not.toBeNull();
    const mute = el.querySelector<HTMLButtonElement>('[aria-label="Mute"]')!;
    mute.click();
    await fixture.whenStable();
    expect(el.querySelector('[aria-label="Unmute"]')).not.toBeNull();
    expect(el.querySelector('video')!.muted).toBe(true);
  });

  it('prefers its pinned channel and hides the stop control', async () => {
    lineup.add({ key: 'a', name: 'Alpha', url: 'http://tv.example/a.m3u8' });
    lineup.add({ key: 'b', name: 'Beta', url: 'http://tv.example/b.m3u8' });
    const { el } = await render({ ch: 'a', pinned: 'b' });
    expect(el.querySelector('.title')?.textContent).toContain('Beta');
    expect(el.querySelector('[aria-label="Stop"]')).toBeNull();
  });

  it('shows nothing for an unknown channel key', async () => {
    lineup.add({ key: 'a', name: 'Alpha', url: 'http://tv.example/a.m3u8' });
    const { el } = await render({ ch: 'zzz' });
    expect(el.querySelector('sw-player')).toBeNull();
  });
});
