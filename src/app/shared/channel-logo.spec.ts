import { TestBed } from '@angular/core/testing';

import { ChannelLogo } from './channel-logo';

describe('ChannelLogo', () => {
  const render = async (src: string | undefined, name: string) => {
    const fixture = TestBed.createComponent(ChannelLogo);
    fixture.componentRef.setInput('src', src);
    fixture.componentRef.setInput('name', name);
    await fixture.whenStable();
    return fixture;
  };

  it('shows initials without a logo, skipping provider prefixes and symbols', async () => {
    const f = await render(undefined, 'US| fox 10 news');
    expect((f.nativeElement as HTMLElement).textContent.trim()).toBe('F1');
    f.componentRef.setInput('name', 'Amazon US: & weather channel');
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).textContent.trim()).toBe('WC');
    f.componentRef.setInput('name', 'Local:');
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).textContent.trim()).toBe('L');
  });

  it('falls back to initials when the image fails, until the source changes', async () => {
    const f = await render('https://logo.example/a.png', 'Alpha Beta');
    const el = f.nativeElement as HTMLElement;
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://logo.example/a.png');
    img.dispatchEvent(new Event('error'));
    await f.whenStable();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent.trim()).toBe('AB');
    f.componentRef.setInput('src', 'https://logo.example/b.png');
    await f.whenStable();
    expect(el.querySelector('img')).not.toBeNull();
  });
});
