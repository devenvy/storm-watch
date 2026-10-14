import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ChannelsWidget } from './channels-widget';
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

describe('ChannelsWidget', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: STORAGE_BACKEND, useValue: new MemoryBackend() }],
    });
  });

  it('invites the user to add a source when the lineup is empty', async () => {
    const fixture = TestBed.createComponent(ChannelsWidget);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Add an IPTV source');
  });

  it('lists lineup channels as tiles and highlights the picked one', async () => {
    const lineup = TestBed.inject(LineupStore);
    lineup.add({ key: 'a', name: 'Alpha News', url: 'http://tv.example/a' });
    lineup.add({ key: 'b', name: 'Beta', url: 'http://tv.example/b' });
    const fixture = TestBed.createComponent(ChannelsWidget);
    fixture.componentRef.setInput('ch', 'b');
    await fixture.whenStable();
    const tiles = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
      'a.tile',
    );
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.textContent).toContain('1 Alpha News');
    expect(tiles[0]!.getAttribute('href')).toContain('ch=a');
    expect(tiles[1]!.classList).toContain('on');
    expect(tiles[0]!.classList).not.toContain('on');
  });
});
