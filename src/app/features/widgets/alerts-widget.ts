import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AlertsStore } from '../../core/alerts.store';
import { dangerLabel } from '../../core/nws.service';
import { CardButtons, Expandable } from '../../shared/expandable';

@Component({
  selector: 'sw-alerts-widget',
  imports: [DatePipe, CardButtons],
  template: `
    <h2><span class="title">Alerts · {{ alerts.alerts().length }}</span>
      <span class="meta">{{ alerts.updatedAt() | date: 'shortTime' }}</span>
      <sw-card-buttons [card]="card" /></h2>
    @if (alerts.error(); as err) { <p class="err">{{ err }}</p> }
    <div class="scroll">
      @for (a of alerts.alerts(); track a.id) {
        <details class="alert" [class]="a.severity">
          <summary>
            <b>{{ label(a) }}</b>
            <small>until {{ (a.ends ?? a.expires) | date: 'EEE h:mm a' }}</small>
          </summary>
          <pre>{{ a.description }}</pre>
          @if (a.instruction) { <pre class="instr">{{ a.instruction }}</pre> }
        </details>
      } @empty {
        @if (feed().okAt) {
          <p class="muted">No active alerts.</p>
        } @else if (feed().error) {
          <p class="err">Alerts are unavailable right now. Check weather.gov or local media.</p>
        } @else {
          <p class="muted">Checking alerts…</p>
        }
      }
    </div>
  `,
  styles: `
    .alert { border-left: 4px solid var(--yellow); background: var(--bg); border-radius: 4px; padding: 5px 8px; margin-bottom: 6px; }
    .alert.Extreme { border-color: var(--red); } .alert.Severe { border-color: var(--orange); }
    .alert summary { cursor: pointer; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
    .alert summary b { flex: 1; min-width: 0; }
    .alert small { color: var(--muted); }
    .alert pre { white-space: pre-wrap; font: 12px/1.45 ui-monospace, Consolas, monospace; margin: 6px 0 0; }
    .alert .instr { color: var(--yellow); }
    .err { color: var(--red); margin: 0 0 6px; }
    :host(.card-expanded) pre { font-size: 14px; }
    :host(.card-expanded) .alert summary b { font-size: 16px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
  hostDirectives: [Expandable]
})
export class AlertsWidget {
  protected readonly alerts = inject(AlertsStore);
  protected readonly card = inject(Expandable);
  protected readonly feed = computed(() => this.alerts.feeds().alerts);
  protected readonly label = dangerLabel;
}
