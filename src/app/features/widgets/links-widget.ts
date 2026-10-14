import { LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { HomeLocation } from '../../core/settings.store';

@Component({
  selector: 'sw-links-widget',
  imports: [LowerCasePipe],
  template: `
    <h2><span class="title">Links</span></h2>
    <div class="scroll links">
      <a
        target="_blank"
        rel="noopener"
        [href]="'https://www.weather.gov/' + (location().office | lowercase)"
        >NWS {{ location().office }}</a
      >
      <a href="https://www.spc.noaa.gov/products/watch/" target="_blank" rel="noopener"
        >SPC watches</a
      >
      <a href="https://www.spc.noaa.gov/products/md/" target="_blank" rel="noopener"
        >SPC discussions</a
      >
      <a href="https://www.spc.noaa.gov/products/outlook/" target="_blank" rel="noopener"
        >SPC outlooks</a
      >
      <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener">NHC</a>
      <a href="https://water.noaa.gov/" target="_blank" rel="noopener">River gauges</a>
      <a href="https://poweroutage.us/" target="_blank" rel="noopener">Power outages</a>
    </div>
  `,
  styleUrl: './links-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
})
export class LinksWidget {
  readonly location = input.required<HomeLocation>();
}
