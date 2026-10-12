import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AlertsStore } from '../../core/alerts.store';
import { dangerLabel } from '../../core/nws.service';
import { CardButtons, Expandable } from '../../shared/expandable';

@Component({
  selector: 'sw-alerts-widget',
  imports: [DatePipe, CardButtons],
  template: `
    <h2>
      <span class="title">Alerts · {{ alerts.alerts().length }}</span>
      <span class="meta">{{ alerts.updatedAt() | date: 'shortTime' }}</span>
      <sw-card-buttons [card]="card" />
    </h2>
    @if (alerts.error(); as err) {
      <p class="err">{{ err }}</p>
    }
    <div class="scroll">
      @for (a of alerts.alerts(); track a.id) {
        <details class="alert" [class]="a.severity">
          <summary>
            <b>{{ label(a) }}</b>
            <small>until {{ a.ends ?? a.expires | date: 'EEE h:mm a' }}</small>
          </summary>
          <pre>{{ a.description }}</pre>
          @if (a.instruction) {
            <pre class="instr">{{ a.instruction }}</pre>
          }
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
  styleUrl: './alerts-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
  hostDirectives: [Expandable],
})
export class AlertsWidget {
  protected readonly alerts = inject(AlertsStore);
  protected readonly card = inject(Expandable);
  protected readonly feed = computed(() => this.alerts.feeds().alerts);
  protected readonly label = dangerLabel;
}
