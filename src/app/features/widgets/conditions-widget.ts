import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AlertsStore } from '../../core/alerts.store';
import { CardButtons, Expandable } from '../../shared/expandable';
import { compass } from '../../shared/format';

@Component({
  selector: 'sw-conditions-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, CardButtons],
  hostDirectives: [Expandable],
  host: { class: 'panel widget' },
  template: `
    <h2><span class="title">Now @if (alerts.observation(); as o) { · {{ o.stationName }} }</span>
      @if (alerts.observation(); as o) { <span class="meta">{{ o.timestamp | date: 'shortTime' }}</span> }
      <sw-card-buttons [card]="card" /></h2>
    @if (alerts.observation(); as o) {
      <div class="scroll">
        <div class="stats">
          <div><b>{{ o.tempF ?? '–' }}°</b><small>feels {{ o.feelsLikeF ?? '–' }}°</small></div>
          <div><b>{{ o.windMph ?? '–' }}</b><small>wind {{ compass(o.windDir) }}</small></div>
          <div><b>{{ o.gustMph ?? '–' }}</b><small>gust</small></div>
          <div><b>{{ o.humidity ?? '–' }}%</b><small>humidity</small></div>
          <div><b>{{ o.pressureInHg ?? '–' }}</b><small>inHg</small></div>
        </div>
        @if (o.text) { <p class="muted small">{{ o.text }}</p> }
      </div>
    } @else if (alerts.feeds().observation.error) {
      <p class="err">Conditions unavailable right now.</p>
    } @else {
      <p class="muted">Loading conditions…</p>
    }
  `,
  styles: `
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); gap: 6px; }
    .stats div { background: var(--bg); border-radius: 6px; padding: 6px; text-align: center; }
    .stats b { display: block; font-size: 20px; line-height: 1.2; }
    .stats small { color: var(--muted); font-size: 11px; }
    .small { font-size: 12px; margin: 6px 0 0; }
    .err { color: var(--red); margin: 0; }
    :host(.card-expanded) .stats b { font-size: 40px; }
    :host(.card-expanded) .stats small { font-size: 14px; }
  `,
})
export class ConditionsWidget {
  protected readonly alerts = inject(AlertsStore);
  protected readonly card = inject(Expandable);
  protected readonly compass = compass;
}
