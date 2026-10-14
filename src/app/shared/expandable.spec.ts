import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CardButtons, Expandable } from './expandable';

@Component({
  selector: 'sw-host',
  imports: [Expandable, CardButtons],
  template: `<div #card="card" swExpandable><sw-card-buttons [card]="card" /></div>`,
})
class Host {
  readonly unused = signal(0);
}

describe('Expandable and CardButtons', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const render = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const card = el.querySelector<HTMLElement>('[swExpandable]')!;
    const buttons = () => card.querySelectorAll<HTMLButtonElement>('button');
    return { fixture, card, buttons };
  };

  it('expands, closes with the button and with Escape', async () => {
    const { fixture, card, buttons } = await render();
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]!.title).toBe('Expand');
    buttons()[0]!.click();
    await fixture.whenStable();
    expect(card.classList).toContain('card-expanded');
    expect(buttons()).toHaveLength(2);
    expect(buttons()[1]!.getAttribute('aria-label')).toBe('Close');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(card.classList).not.toContain('card-expanded');

    buttons()[0]!.click();
    await fixture.whenStable();
    buttons()[1]!.click();
    await fixture.whenStable();
    expect(card.classList).not.toContain('card-expanded');
  });

  it('requests fullscreen for the card, or exits it', async () => {
    const { fixture, card, buttons } = await render();
    buttons()[0]!.click();
    await fixture.whenStable();

    const request = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('denied'));
    Object.assign(card, { requestFullscreen: request });
    buttons()[0]!.click();
    expect(request).toHaveBeenCalledWith();

    const exit = vi.fn<() => Promise<void>>().mockResolvedValue();
    // jsdom has no Fullscreen API: define it on the document for this test only.
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: card });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    try {
      buttons()[0]!.click();
      expect(exit).toHaveBeenCalledWith();
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement');
      Reflect.deleteProperty(document, 'exitFullscreen');
    }
  });

  it('does nothing where elements cannot go fullscreen', async () => {
    const { fixture, card, buttons } = await render();
    buttons()[0]!.click();
    await fixture.whenStable();
    Object.assign(card, { requestFullscreen: undefined });
    expect(() => {
      buttons()[0]!.click();
    }).not.toThrow();
  });
});
