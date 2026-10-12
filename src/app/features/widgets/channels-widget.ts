import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LineupStore } from '../../iptv/lineup.store';
import { ChannelLogo } from '../../shared/channel-logo';
import { CardButtons, Expandable } from '../../shared/expandable';

@Component({
  selector: 'sw-channels-widget',
  imports: [RouterLink, ChannelLogo, CardButtons],
  template: `
    <h2>
      <span class="title">Channels</span>
      <a routerLink="/setup" fragment="lineup" class="meta">edit</a>
      <sw-card-buttons [card]="card" />
    </h2>
    <div class="scroll tiles">
      @for (c of lineup.channels(); track c.key) {
        <a
          class="tile"
          queryParamsHandling="merge"
          replaceUrl
          [routerLink]="[]"
          [queryParams]="{ ch: c.key }"
          [class.on]="c.key === ch()"
        >
          <sw-logo [src]="c.logo" [name]="c.name" />
          <span
            ><small>{{ $index + 1 }}</small> {{ c.name }}</span
          >
        </a>
      } @empty {
        <p class="muted">
          <a routerLink="/setup" fragment="iptv">Add an IPTV source</a> to build a lineup.
        </p>
      }
    </div>
  `,
  styleUrl: './channels-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel widget' },
  hostDirectives: [Expandable],
})
export class ChannelsWidget {
  protected readonly lineup = inject(LineupStore);
  protected readonly card = inject(Expandable);
  readonly ch = input<string | undefined>();
}
