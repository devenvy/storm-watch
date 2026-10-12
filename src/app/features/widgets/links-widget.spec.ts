import { TestBed } from '@angular/core/testing';

import { LinksWidget } from './links-widget';

describe('LinksWidget', () => {
  it('links to the local NWS office', async () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(LinksWidget);
    fixture.componentRef.setInput('location', { office: 'TAE' });
    await fixture.whenStable();
    const first = (fixture.nativeElement as HTMLElement).querySelector('a')!;
    expect(first.getAttribute('href')).toBe('https://www.weather.gov/tae');
    expect(first.textContent).toBe('NWS TAE');
  });
});
