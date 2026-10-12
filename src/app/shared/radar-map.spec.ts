import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { RadarMap } from './radar-map';
import { type RadarFrame, type RadarSet, RadarSources } from '../core/radar-sources';

import type { WarningShape } from '../core/nws.service';
import type { Mock } from 'vitest';

const NOW = new Date(2026, 9, 10, 12, 0).getTime();
const MIN = 60_000;

const frame = (minutes: number, kind: RadarFrame['kind'] = 'past'): RadarFrame => ({
  time: new Date(NOW + minutes * MIN),
  url: `https://tiles.example/${minutes}/{z}/{x}/{y}.png`,
  kind,
});

/** 3 observed frames (newest at index 2), then 2 forecast frames. */
const blended = (): RadarSet => ({
  frames: [frame(-20), frame(-10), frame(0), frame(75, 'forecast'), frame(120, 'forecast')],
  startIndex: 2,
  note: 'HRRR model run',
});

function observeNothing(): ResizeObserver {
  const noop = () => undefined;
  return { observe: noop, unobserve: noop, disconnect: noop };
}

describe('RadarMap', () => {
  let fixture: ComponentFixture<RadarMap>;
  let load: Mock<RadarSources['load']>;
  let el: HTMLElement;

  const settle = async () => {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  };
  const text = (sel: string) => el.querySelector(sel)?.textContent.trim() ?? '';
  const button = (label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  const slider = () => el.querySelector<HTMLInputElement>('input[type=range]')!;
  const key = async (k: string, target: Element = el) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    await settle();
    return e;
  };

  const create = async (set: RadarSet | Error = blended(), shapes: WarningShape[] = []) => {
    load = vi.fn<RadarSources['load']>(async () => {
      if (set instanceof Error) {
        throw set;
      }
      return set;
    });
    TestBed.configureTestingModule({
      providers: [{ provide: RadarSources, useValue: { load } }],
    });
    fixture = TestBed.createComponent(RadarMap);
    fixture.componentRef.setInput('center', [31, -85]);
    fixture.componentRef.setInput('station', 'KEOX');
    fixture.componentRef.setInput('shapes', shapes);
    el = fixture.nativeElement as HTMLElement;
    await settle();
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal('ResizeObserver', vi.fn(observeNothing));
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads the source for the station and shows the newest observed frame', async () => {
    await create();
    expect(load).toHaveBeenCalledWith('blend', 'KEOX');
    expect(slider().max).toBe('4');
    expect(slider().value).toBe('2');
    expect(text('.time small')).toBe('now');
    expect(text('.note')).toBe('HRRR model run');
    expect(el.querySelector('.badge')).toBeNull();
    expect(el.querySelectorAll('.tick')).toHaveLength(5);
    // "Now" marker sits at the newest observed frame: 2 of 4.
    expect(el.querySelector<HTMLElement>('.nowline')!.style.left).toBe('50%');
  });

  it('steps through frames with the buttons and labels relative times', async () => {
    await create();
    button('Previous frame').click();
    await settle();
    expect(text('.time small')).toBe('−10 min');
    button('First frame').click();
    await settle();
    expect(slider().value).toBe('0');
    button('Previous frame').click();
    await settle();
    expect(slider().value).toBe('0');
    button('Last frame').click();
    await settle();
    expect(text('.time small')).toBe('+2 h');
    expect(text('.badge')).toBe('FORECAST · model');
    button('Next frame').click();
    await settle();
    expect(slider().value).toBe('4');
    el.querySelectorAll<HTMLButtonElement>('.tick')[3]!.click();
    await settle();
    expect(text('.time small')).toBe('+1 h 15 m');
    button('Latest observed frame').click();
    await settle();
    expect(slider().value).toBe('2');
  });

  it('scrubs with the slider', async () => {
    await create();
    slider().value = '1';
    slider().dispatchEvent(new Event('input'));
    await settle();
    expect(text('.time small')).toBe('−10 min');
  });

  it('handles the keyboard, except inside the speed menu', async () => {
    await create();
    expect((await key('ArrowLeft')).defaultPrevented).toBe(true);
    expect(slider().value).toBe('1');
    await key('ArrowRight');
    await key('ArrowRight');
    expect(slider().value).toBe('3');
    await key('ArrowLeft', el.querySelector('select')!);
    expect(slider().value).toBe('3');
    expect((await key('x')).defaultPrevented).toBe(false);
    await key(' ');
    expect(button('Pause')).not.toBeNull();
    await key(' ');
    expect(button('Play')).not.toBeNull();
  });

  it('plays the loop, lingering on the boundary frames', async () => {
    await create();
    button('Play').click();
    await settle();
    // Index 2 is the newest observed frame: held 2.5 × 800 ms.
    await vi.advanceTimersByTimeAsync(1999);
    expect(slider().value).toBe('2');
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(slider().value).toBe('3');
    await vi.advanceTimersByTimeAsync(800);
    await settle();
    expect(slider().value).toBe('4');

    const speed = el.querySelector('select')!;
    speed.value = 'fast';
    speed.dispatchEvent(new Event('change'));
    await settle();
    // The last frame is held too, then playback wraps to the first.
    await vi.advanceTimersByTimeAsync(875);
    await settle();
    expect(slider().value).toBe('0');
  });

  it('ignores unknown playback speeds', async () => {
    await create();
    const speed = el.querySelector('select')!;
    const option = document.createElement('option');
    option.value = 'warp';
    speed.appendChild(option);
    speed.value = 'warp';
    speed.dispatchEvent(new Event('change'));
    button('Play').click();
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(slider().value).toBe('3');
  });

  it('does not play a single frame', async () => {
    await create({ frames: [frame(0)], startIndex: 0 });
    button('Play').click();
    await settle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(slider().value).toBe('0');
    expect(el.querySelector('.nowline')).toBeNull();
  });

  it('shows source errors', async () => {
    await create(new Error('502 upstream'));
    expect(text('.badge.err')).toBe('Radar source unavailable: 502 upstream');
  });

  it('reloads when the source changes and on a timer, keeping a scrubbed position', async () => {
    await create();
    fixture.componentRef.setInput('source', 'mosaic');
    await settle();
    expect(load).toHaveBeenLastCalledWith('mosaic', 'KEOX');

    // Scrub back one frame; the periodic refresh brings a newer set containing that frame.
    button('Previous frame').click();
    await settle();
    load.mockResolvedValue({
      frames: [frame(-10), frame(0), frame(5)],
      startIndex: 2,
    });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    await settle();
    expect(load).toHaveBeenCalledTimes(3);
    expect(slider().value).toBe('0');

    // Following "latest": the refresh jumps to the newest observed frame.
    button('Latest observed frame').click();
    await settle();
    load.mockResolvedValue({ frames: [frame(0), frame(5), frame(10)], startIndex: 2 });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    await settle();
    expect(slider().value).toBe('2');

    // A scrubbed frame that is gone falls back to the newest observed frame.
    button('First frame').click();
    await settle();
    load.mockResolvedValue({ frames: [frame(20), frame(25)], startIndex: 1 });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    await settle();
    expect(slider().value).toBe('1');
  });

  it('logs failed periodic reloads only for the latest request', async () => {
    await create();
    let fail!: (e: Error) => void;
    load.mockImplementationOnce(
      async () =>
        new Promise<RadarSet>((_, reject) => {
          fail = reject;
        }),
    );
    fixture.componentRef.setInput('source', 'hrrr');
    await settle();
    fixture.componentRef.setInput('source', 'rainviewer');
    await settle();
    fail(new Error('stale'));
    await settle();
    expect(el.querySelector('.badge.err')).toBeNull();
    expect(el.querySelector('.badge.loading')).toBeNull();
  });

  it('draws warning polygons with text-only popups', async () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-85, 31],
          [-84.9, 31],
          [-84.9, 31.1],
          [-85, 31],
        ],
      ],
    };
    await create(blended(), [
      { event: 'Tornado Warning', headline: '<img src=x onerror=alert(1)>', geometry },
      { event: 'Special Marine Warning', headline: null as unknown as string, geometry },
    ]);
    const strokes = () =>
      [...el.querySelectorAll('path.leaflet-interactive')].map((p) => p.getAttribute('stroke'));
    // The home marker is white too; unknown warning types fall back to white.
    expect(strokes().sort((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual([
      '#ff2d2d',
      '#fff',
      '#fff',
    ]);
    fixture.componentRef.setInput('shapes', []);
    await settle();
    expect(strokes()).toEqual(['#fff']);
  });

  it('recenters on the home location', async () => {
    await create();
    fixture.componentRef.setInput('center', [32, -86]);
    await settle();
    el.querySelector<HTMLButtonElement>('.legend button')!.click();
    await settle();
    expect(el.querySelector('.leaflet-container')).not.toBeNull();
  });

  it('ignores a load that finishes after the map was destroyed', async () => {
    await create();
    let answer!: (s: RadarSet) => void;
    load.mockImplementationOnce(
      async () =>
        new Promise<RadarSet>((r) => {
          answer = r;
        }),
    );
    fixture.componentRef.setInput('source', 'hrrr');
    await settle();
    fixture.destroy();
    answer(blended());
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
