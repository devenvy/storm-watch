import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { AlertsStore } from '../../core/alerts.store';
import { RADAR_SOURCES, RadarSourceId } from '../../core/radar-sources';
import { HomeLocation } from '../../core/settings.store';
import { CardButtons, Expandable } from '../../shared/expandable';
import { RadarMap } from '../../shared/radar-map';

@Component({
  selector: 'sw-radar-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RadarMap, CardButtons],
  hostDirectives: [Expandable],
  host: { class: 'panel widget' },
  template: `
    <h2>
      <span class="title">Radar</span>
      <select class="meta src" (change)="pick($event)" aria-label="Radar source">
        @for (s of sources; track s.id) { <option [value]="s.id" [selected]="s.id === source()">{{ s.label }}</option> }
      </select>
      <sw-card-buttons [card]="card" />
    </h2>
    @if (source() !== 'site-gif') {
      <sw-radar-map [center]="[location().lat, location().lon]" [shapes]="alerts.shapes()"
        [source]="source()" [station]="location().radarStation" />
    } @else {
      <img class="site" [src]="loop()" alt="Local single-site radar loop">
    }
  `,
  styles: `
    sw-radar-map { flex: 1; min-height: 0; }
    .site { flex: 1; min-height: 0; width: 100%; object-fit: contain; background: #000; border-radius: 6px; }
    .src { padding: 2px 6px; font-size: 12px; text-transform: none; letter-spacing: 0; max-width: 60%; }
  `,
})
export class RadarWidget {
  protected readonly alerts = inject(AlertsStore);
  protected readonly card = inject(Expandable);
  protected readonly sources = RADAR_SOURCES;

  readonly location = input.required<HomeLocation>();
  readonly source = input<RadarSourceId>('blend');
  readonly sourceChange = output<RadarSourceId>();

  protected readonly loop = computed(() =>
    `https://radar.weather.gov/ridge/standard/${this.location().radarStation}_loop.gif?_=${this.alerts.updatedAt()?.getTime() ?? 0}`);

  protected pick(e: Event): void {
    this.sourceChange.emit((e.target as HTMLSelectElement).value as RadarSourceId);
  }
}
