import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { App } from './app';
import { AlertsStore } from './core/alerts.store';
import { SettingsStore } from './core/settings.store';
import { ShareService } from './core/share';
import { STORAGE_BACKEND, type StorageBackend } from './core/storage/storage-backend';

import type { Mock } from 'vitest';

@Component({ selector: 'sw-blank', template: '' })
class Blank {}

/** In-memory storage (a plain object: the file may only declare one class). */
const memoryBackend = (data: Map<string, unknown>): StorageBackend => ({
  name: 'memory',
  get: async <T>(key: string) => data.get(key) as T | undefined,
  set: async (key, value) => {
    data.set(key, value);
  },
  remove: async (key) => {
    data.delete(key);
  },
});

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let el: HTMLElement;
  let router: Router;
  let apply: Mock<ShareService['apply']>;
  let arm: Mock<AlertsStore['arm']>;
  const danger = signal<unknown[]>([]);
  const dangerEvents = signal<string[]>([]);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 10, 9, 30, 0));
    danger.set([]);
    dangerEvents.set([]);
    apply = vi.fn<ShareService['apply']>();
    arm = vi.fn<AlertsStore['arm']>(async () => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        { provide: STORAGE_BACKEND, useValue: memoryBackend(new Map()) },
        { provide: AlertsStore, useValue: { danger, dangerEvents, arm } },
        { provide: ShareService, useValue: { apply } },
      ],
    });
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(App);
    el = fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  }

  const go = async (url: string) => {
    await router.navigateByUrl(url);
    await settle();
  };
  const dashboardLink = () => el.querySelector('nav a')!;

  it('shows the header, a ticking clock and the arm button', async () => {
    const clock = el.querySelector('.clock')!;
    const before = clock.textContent;
    await vi.advanceTimersByTimeAsync(1000);
    fixture.detectChanges();
    expect(clock.textContent).not.toBe(before);
    el.querySelector<HTMLButtonElement>('button.arm')!.click();
    expect(arm).toHaveBeenCalledWith();
    TestBed.inject(SettingsStore).soundArmed.set(true);
    fixture.detectChanges();
    expect(el.querySelector('.armed')?.textContent).toContain('Alerts armed');
  });

  it('marks the dashboard tab active on any board', async () => {
    await go('/d/radar');
    expect(dashboardLink().classList).toContain('active');
    await go('/setup');
    expect(dashboardLink().classList).not.toContain('active');
    await go('/');
    expect(dashboardLink().classList).toContain('active');
  });

  it('hides the header in kiosk mode but still offers to arm sounds', async () => {
    await go('/?kiosk=1');
    expect(el.querySelector('header')).toBeNull();
    expect(el.classList).toContain('kiosk');
    el.querySelector<HTMLButtonElement>('button.kiosk-arm')!.click();
    expect(arm).toHaveBeenCalledWith();
    TestBed.inject(SettingsStore).soundArmed.set(true);
    fixture.detectChanges();
    expect(el.querySelector('button.kiosk-arm')).toBeNull();
    for (const off of ['0', 'false']) {
      await go(`/?kiosk=${off}`);
      expect(el.querySelector('header'), off).not.toBeNull();
    }
  });

  it('shows a danger banner for the home location', async () => {
    TestBed.inject(SettingsStore).location.set({
      lat: 31,
      lon: -85,
      label: 'Dothan, AL',
      city: '',
      state: '',
      office: 'TAE',
      radarStation: 'KEOX',
      stationsUrl: 'https://api.weather.gov/x',
    });
    danger.set([{}]);
    dangerEvents.set(['Tornado Warning']);
    fixture.detectChanges();
    expect(el.querySelector('.banner')?.textContent).toContain('Tornado Warning for Dothan, AL.');
  });

  it('applies a share link, strips it from the URL and shows a notice briefly', async () => {
    apply.mockResolvedValue(true);
    await go('/d/storm?cfg=zABC&kiosk=1');
    await settle();
    expect(apply).toHaveBeenCalledWith('zABC');
    expect(router.url).toBe('/d/storm?kiosk=1');
    expect(el.querySelector('.notice')?.textContent).toBe('Shared setup applied.');
    await vi.advanceTimersByTimeAsync(6000);
    fixture.detectChanges();
    expect(el.querySelector('.notice')).toBeNull();
  });

  it('stays quiet when the user declines a share link', async () => {
    apply.mockResolvedValue(false);
    await go('/?cfg=zABC');
    await settle();
    expect(router.url).toBe('/');
    expect(el.querySelector('.notice')).toBeNull();
  });

  it('explains share links that cannot be applied', async () => {
    apply.mockRejectedValue(new Error('Not a Storm Watch share link.'));
    await go('/?cfg=junk');
    await settle();
    expect(el.querySelector('.notice')?.textContent).toBe(
      'Could not apply share link: Not a Storm Watch share link.',
    );
  });

  it('logs when cleaning up the URL fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apply.mockResolvedValue(true);
    const navigate = vi.spyOn(router, 'navigate').mockRejectedValue(new Error('nav'));
    await go('/?cfg=zABC');
    await settle();
    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: { cfg: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    expect(error).toHaveBeenCalledWith('Could not apply share link', expect.any(Error));
  });
});
