import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AlertsWidget } from './alerts-widget';
import { AlertsStore } from '../../core/alerts.store';
import { STORAGE_BACKEND, type StorageBackend } from '../../core/storage/storage-backend';

import type { NwsAlert } from '../../core/nws.service';

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

const alert = (id: string, extra: Partial<NwsAlert> = {}): NwsAlert => ({
  id,
  event: 'Flood Watch',
  severity: 'Moderate',
  headline: id,
  description: `desc ${id}`,
  instruction: '',
  areaDesc: '',
  senderName: '',
  ends: null,
  expires: '2026-10-10T12:00:00Z',
  ...extra,
});

describe('AlertsWidget', () => {
  let store: AlertsStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: STORAGE_BACKEND, useValue: new MemoryBackend() }],
    });
    store = TestBed.inject(AlertsStore);
    // Let the store's location effect run (and reset its signals) before the tests set them.
    await new Promise((r) => {
      setTimeout(r);
    });
    TestBed.tick();
  });

  const render = async () => {
    const fixture = TestBed.createComponent(AlertsWidget);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  const setFeed = (okAt: Date | null, error: string | null) => {
    store.feeds.update((f) => ({ ...f, alerts: { okAt, error } }));
  };

  it('shows a checking state before the first answer', async () => {
    const el = await render();
    expect(el.textContent).toContain('Alerts · 0');
    expect(el.textContent).toContain('Checking alerts…');
  });

  it('says there are no alerts once the feed answered', async () => {
    setFeed(new Date(), null);
    const el = await render();
    expect(el.textContent).toContain('No active alerts.');
  });

  it('warns when alerts are unavailable', async () => {
    setFeed(null, 'down');
    const el = await render();
    expect(el.querySelector('.err')?.textContent).toContain('Alert feed unreachable');
    expect(el.textContent).toContain('Alerts are unavailable right now.');
  });

  it('lists alerts with emergency labels and instructions', async () => {
    setFeed(new Date(), null);
    store.alerts.set([
      alert('a', {
        event: 'Tornado Warning',
        severity: 'Extreme',
        instruction: 'Take shelter',
        ends: '2026-10-10T13:00:00Z',
        parameters: { tornadoDamageThreat: ['CATASTROPHIC'] },
      }),
      alert('b'),
    ]);
    const el = await render();
    const items = el.querySelectorAll('details.alert');
    expect(items).toHaveLength(2);
    expect(items[0]!.classList).toContain('Extreme');
    expect(items[0]!.querySelector('b')?.textContent).toBe('Tornado Emergency');
    expect(items[0]!.querySelector('.instr')?.textContent).toBe('Take shelter');
    expect(items[1]!.querySelector('.instr')).toBeNull();
    expect(items[1]!.querySelector('pre')?.textContent).toBe('desc b');
  });
});
