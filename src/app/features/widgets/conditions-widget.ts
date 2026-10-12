import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AlertsStore } from '../../core/alerts.store';
import { SettingsStore } from '../../core/settings.store';
import { CardButtons, Expandable } from '../../shared/expandable';
import { compass } from '../../shared/format';

/**
 * Current conditions: the nearest reporting (or pinned) Ambient Weather Network home station, which is
 * usually much closer than the official one, plus the nearest reporting NWS station.
 */
@Component({
  selector: 'sw-conditions-widget',
  imports: [DatePipe, DecimalPipe, CardButtons],
  template: `
    <h2><span class="title">Now @if (alerts.station(); as s) { · {{ s.name }} } @else if (alerts.observation(); as o) { · {{ o.stationName }} }</span>
      @if (alerts.station(); as s) { <span class="meta">{{ s.at | date: 'shortTime' }}</span> }
      @else if (alerts.observation(); as o) { <span class="meta">{{ o.timestamp | date: 'shortTime' }}</span> }
      <sw-card-buttons [card]="card" /></h2>
    <div class="scroll">
      @if (alerts.station(); as s) {
        <p class="src muted">Home station{{ s.place ? ' in ' + s.place : '' }}, {{ s.distanceMi | number: '1.0-1' }} mi away
          @if (settings.pws() === s.id) { · pinned }</p>
        @if (alerts.feeds().pws.error) { <p class="warn small">Home station network unreachable, showing the last readings.</p> }
        <div class="stats">
          <div><b>{{ s.tempF ?? '–' }}°</b><small>feels {{ s.feelsLikeF ?? '–' }}°</small></div>
          <div><b>{{ s.windMph ?? '–' }}</b><small>wind {{ compass(s.windDir) }}</small></div>
          <div><b>{{ s.gustMph ?? '–' }}</b><small>gust · max {{ s.maxGustMph ?? '–' }}</small></div>
          <div><b>{{ s.rainRateIn ?? '–' }}</b><small>rain in/hr</small></div>
          <div><b>{{ s.rainTodayIn ?? '–' }}</b><small>rain today</small></div>
          @if (s.rainEventIn) { <div><b>{{ s.rainEventIn }}</b><small>storm total</small></div> }
          <div><b>{{ s.humidity ?? '–' }}%</b><small>humidity</small></div>
          <div><b>{{ s.pressureInHg ?? '–' }}</b><small>inHg</small></div>
        </div>
      }

      @if (alerts.observation(); as o) {
        @if (alerts.station()) {
          <p class="nws"><b>NWS {{ o.station }}</b>@if (o.distanceMi !== null) { <span class="muted"> ({{ o.distanceMi | number: '1.0-0' }} mi)</span> } {{ o.tempF ?? '–' }}° · wind {{ compass(o.windDir) }} {{ o.windMph ?? '–' }}
            @if (o.gustMph) { G {{ o.gustMph }} } mph · {{ o.pressureInHg ?? '–' }} inHg
            <span class="muted">· {{ o.text }} · {{ o.timestamp | date: 'shortTime' }}</span></p>
        } @else {
          <p class="src muted">NWS station {{ o.station }}@if (o.distanceMi !== null) { , {{ o.distanceMi | number: '1.0-0' }} mi away }</p>
          <div class="stats">
            <div><b>{{ o.tempF ?? '–' }}°</b><small>feels {{ o.feelsLikeF ?? '–' }}°</small></div>
            <div><b>{{ o.windMph ?? '–' }}</b><small>wind {{ compass(o.windDir) }}</small></div>
            <div><b>{{ o.gustMph ?? '–' }}</b><small>gust</small></div>
            <div><b>{{ o.humidity ?? '–' }}%</b><small>humidity</small></div>
            <div><b>{{ o.pressureInHg ?? '–' }}</b><small>inHg</small></div>
          </div>
          @if (o.text) { <p class="muted small">{{ o.text }}</p> }
        }
      } @else if (!alerts.station()) {
        @if (alerts.feeds().observation.error) { <p class="err">Conditions unavailable right now.</p> }
        @else { <p class="muted">Loading conditions…</p> }
      }

      @if (others().length) {
        <details class="nearby">
          <summary class="muted">Nearby home stations ({{ alerts.stations().length }} reporting)</summary>
          <ul>
            @for (s of alerts.stations(); track s.id) {
              <li [class.current]="s.id === alerts.station()?.id">
                <button type="button" [title]="'Use ' + s.name" (click)="pin(s.id)">
                  <span class="nm">{{ s.name }}</span>
                  <span class="muted">{{ s.distanceMi | number: '1.0-1' }} mi</span>
                  <span>{{ s.tempF }}°</span>
                  <span>G {{ s.gustMph ?? '–' }}</span>
                  <span>{{ s.rainTodayIn ?? '–' }}″</span>
                </button>
              </li>
            }
          </ul>
          @if (settings.pws()) { <button type="button" class="link" (click)="pin(null)">Use the nearest station</button> }
        </details>
      } @else if (alerts.feeds().pws.error && !alerts.stations().length) {
        <p class="muted small">Home station network unavailable.</p>
      }
    </div>
  `,
  styles: `
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); gap: 6px; }
    .stats div { background: var(--bg); border-radius: 6px; padding: 6px; text-align: center; }
    .stats b { display: block; font-size: 20px; line-height: 1.2; }
    .stats small { color: var(--muted); font-size: 11px; }
    .src { font-size: 11px; margin: 0 0 4px; }
    .nws { font-size: 12px; margin: 8px 0 0; }
    .small { font-size: 12px; margin: 6px 0 0; }
    .err { color: var(--red); margin: 0; }
    .warn { color: var(--yellow); margin: 0 0 4px; }
    .nearby { margin-top: 8px; font-size: 12px; }
    .nearby summary { cursor: pointer; }
    .nearby ul { list-style: none; margin: 4px 0; padding: 0; }
    .nearby li button { display: grid; grid-template-columns: 1fr auto 3.5em 3.5em 3.5em; gap: 6px; width: 100%;
      background: none; border: 0; padding: 3px 4px; color: inherit; text-align: left; cursor: pointer; border-radius: 4px; }
    .nearby li button:hover, .nearby li.current button { background: var(--bg); }
    .nearby .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .link { background: none; border: 0; padding: 0; color: var(--blue); text-decoration: underline; cursor: pointer; font-size: 12px; }
    :host(.card-expanded) .stats b { font-size: 40px; }
    :host(.card-expanded) .stats small { font-size: 14px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
  hostDirectives: [Expandable]
})
export class ConditionsWidget {
  protected readonly alerts = inject(AlertsStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly card = inject(Expandable);
  protected readonly compass = compass;
  protected readonly others = computed(() => this.alerts.stations().filter(s => s.id !== this.alerts.station()?.id));

  protected pin(id: string | null): void {
    this.settings.pws.set(id);
  }
}
