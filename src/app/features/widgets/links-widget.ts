import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HomeLocation } from '../../core/settings.store';

@Component({
  selector: 'sw-links-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
  template: `
    <h2><span class="title">Links</span></h2>
    <div class="scroll links">
      <a [href]="'https://www.weather.gov/' + location().office.toLowerCase()" target="_blank" rel="noopener">NWS {{ location().office }}</a>
      <a href="https://www.spc.noaa.gov/products/watch/" target="_blank" rel="noopener">SPC watches</a>
      <a href="https://www.spc.noaa.gov/products/md/" target="_blank" rel="noopener">SPC discussions</a>
      <a href="https://www.spc.noaa.gov/products/outlook/" target="_blank" rel="noopener">SPC outlooks</a>
      <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener">NHC</a>
      <a href="https://water.noaa.gov/" target="_blank" rel="noopener">River gauges</a>
      <a href="https://poweroutage.us/" target="_blank" rel="noopener">Power outages</a>
    </div>
  `,
  styles: `.links { display: flex; gap: 6px 14px; flex-wrap: wrap; align-content: start; }`,
})
export class LinksWidget {
  readonly location = input.required<HomeLocation>();
}
