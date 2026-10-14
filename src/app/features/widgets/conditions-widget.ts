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
  templateUrl: './conditions-widget.html',
  styleUrl: './conditions-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
  hostDirectives: [Expandable],
})
export class ConditionsWidget {
  protected readonly alerts = inject(AlertsStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly card = inject(Expandable);
  protected readonly compass = compass;
  protected readonly others = computed(() =>
    this.alerts.stations().filter((s) => s.id !== this.alerts.station()?.id),
  );

  protected pin(id: string | null): void {
    this.settings.pws.set(id);
  }
}
