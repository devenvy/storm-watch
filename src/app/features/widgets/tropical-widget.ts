import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AlertsStore } from '../../core/alerts.store';
import { CardButtons, Expandable } from '../../shared/expandable';
import { compass, ktToMph } from '../../shared/format';

@Component({
  selector: 'sw-tropical-widget',
  imports: [CardButtons, DatePipe],
  template: `
    <h2><span class="title">Tropical · {{ alerts.storms().length }}</span><sw-card-buttons [card]="card" /></h2>
    <div class="scroll list">
      @for (s of alerts.storms(); track s.id) {
        <a class="storm" target="_blank" rel="noopener" title="Open NHC advisory" [href]="s.advisoryUrl">
          <img [src]="s.coneImage" [alt]="s.name + ' forecast cone'">
          <span>
            <b>{{ s.name }}</b>
            <small>{{ s.classification }} · {{ mph(s.intensityKt) }} mph@if (s.pressureMb) { · {{ s.pressureMb }} mb }</small>
            @if (s.movementMph !== null) { <small>moving {{ compass(s.movementDir) }} {{ s.movementMph }} mph</small> }
            <small>{{ s.advisory }}</small>
          </span>
        </a>
      } @empty {
        @if (feed().error && !feed().okAt) {
          <p class="err">Tropical data unavailable right now.
            <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener">NHC</a></p>
        } @else if (!feed().okAt) {
          <p class="muted">Checking NHC…</p>
        } @else {
          <p class="muted">No active tropical cyclones.
            <a href="https://www.nhc.noaa.gov/gtwo.php" target="_blank" rel="noopener">Outlook</a></p>
        }
      }
      @if (feed().error && feed().okAt) { <p class="muted small">Update failed; showing data from {{ feed().okAt | date: 'shortTime' }}.</p> }
    </div>
  `,
  styles: `
    .list { display: flex; flex-direction: column; gap: 6px; }
    .storm { display: flex; gap: 10px; align-items: center; color: var(--fg); text-decoration: none; }
    .storm img { width: 120px; height: 80px; object-fit: cover; border-radius: 4px; background: #000; flex: none; }
    .storm span { display: flex; flex-direction: column; min-width: 0; }
    .storm small { color: var(--muted); }
    .err { color: var(--red); margin: 0; }
    .small { font-size: 12px; margin: 0; }
    :host(.card-expanded) .storm { flex-direction: column; align-items: stretch; flex: 1; min-height: 0; }
    :host(.card-expanded) .storm img { width: 100%; height: auto; flex: 1; min-height: 0; object-fit: contain; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
  hostDirectives: [Expandable]
})
export class TropicalWidget {
  protected readonly alerts = inject(AlertsStore);
  protected readonly card = inject(Expandable);
  protected readonly compass = compass;
  protected readonly mph = ktToMph;
  protected readonly feed = computed(() => this.alerts.feeds().storms);
}
