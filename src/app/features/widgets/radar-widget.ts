import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';

import { AlertsStore } from '../../core/alerts.store';
import { RADAR_SOURCES, type RadarSourceId } from '../../core/radar-sources';
import { CardButtons, Expandable } from '../../shared/expandable';
import { RadarMap } from '../../shared/radar-map';

import type { HomeLocation } from '../../core/settings.store';

@Component({
  selector: 'sw-radar-widget',
  imports: [RadarMap, CardButtons],
  template: `
    <h2>
      <span class="title">Radar</span>
      <select class="meta src" aria-label="Radar source" (change)="pick($event)">
        @for (s of sources; track s.id) {
          <option [value]="s.id" [selected]="s.id === source()">{{ s.label }}</option>
        }
      </select>
      <sw-card-buttons [card]="card" />
    </h2>
    @if (source() !== 'site-gif') {
      <sw-radar-map
        [center]="[location().lat, location().lon]"
        [shapes]="alerts.shapes()"
        [source]="source()"
        [station]="location().radarStation"
      />
    } @else {
      <img class="site" alt="Local single-site radar loop" [src]="loop()" />
    }
  `,
  styleUrl: './radar-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
  hostDirectives: [Expandable],
})
export class RadarWidget {
  protected readonly alerts = inject(AlertsStore);
  protected readonly card = inject(Expandable);
  protected readonly sources = RADAR_SOURCES;

  readonly location = input.required<HomeLocation>();
  readonly source = model<RadarSourceId>('blend');

  protected readonly loop = computed(
    () =>
      `https://radar.weather.gov/ridge/standard/${this.location().radarStation}_loop.gif?_=${this.alerts.updatedAt()?.getTime() ?? 0}`,
  );

  protected pick(e: Event): void {
    this.source.set((e.target as HTMLSelectElement).value as RadarSourceId);
  }
}
