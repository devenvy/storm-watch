import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LineupStore } from '../../iptv/lineup.store';
import { ChannelLogo } from '../../shared/channel-logo';
import { CardButtons, Expandable } from '../../shared/expandable';

@Component({
  selector: 'sw-channels-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ChannelLogo, CardButtons],
  hostDirectives: [Expandable],
  host: { class: 'panel widget' },
  template: `
    <h2><span class="title">Channels</span> <a routerLink="/setup" fragment="lineup" class="meta">edit</a>
      <sw-card-buttons [card]="card" /></h2>
    <div class="scroll tiles">
      @for (c of lineup.channels(); track c.key; let i = $index) {
        <a class="tile" [routerLink]="[]" [queryParams]="{ ch: c.key }" queryParamsHandling="merge" replaceUrl
          [class.on]="c.key === ch()">
          <sw-logo [src]="c.logo" [name]="c.name" />
          <span><small>{{ i + 1 }}</small> {{ c.name }}</span>
        </a>
      } @empty {
        <p class="muted"><a routerLink="/setup" fragment="iptv">Add an IPTV source</a> to build a lineup.</p>
      }
    </div>
  `,
  styles: `
    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; align-content: start; }
    .tile { display: flex; align-items: center; gap: 8px; padding: 6px; background: var(--bg); border: 1px solid var(--line);
      border-radius: 6px; color: var(--fg); text-decoration: none; }
    .tile:hover, .tile:focus { border-color: var(--blue); }
    .tile.on { border-color: var(--blue); background: #1f3a5f; }
    .tile span { min-width: 0; overflow-wrap: anywhere; }
    .tile small { color: var(--muted); }
    :host(.card-expanded) .tiles { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  `,
})
export class ChannelsWidget {
  protected readonly lineup = inject(LineupStore);
  protected readonly card = inject(Expandable);
  readonly ch = input<string | undefined>();
}
