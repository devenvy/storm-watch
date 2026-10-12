import { scoreChannel, suggest } from './scoring';
import { parseM3u } from './sources';

import type { Channel } from './models';

const ctx = { city: 'Dothan', state: 'AL', country: 'US' };
const ch = (name: string, category?: string): Channel => ({
  key: name,
  name,
  url: `http://x/${name}`,
  category,
});

describe('scoreChannel', () => {
  it('ranks a local affiliate in the user city highest', () => {
    const local = scoreChannel(ch('US| CBS 4 WTVY Dothan'), ctx);
    const weather = scoreChannel(ch('US| FOX Weather'), ctx);
    const other = scoreChannel(ch('US| CBS 2 WCBS New York'), ctx);
    expect(local.score).toBeGreaterThan(weather.score);
    expect(weather.score).toBeGreaterThan(other.score);
    expect(local.reasons).toContain('Mentions Dothan');
  });

  it('penalizes channels tagged for another country', () => {
    const uk = scoreChannel(ch('UK| BBC News'), ctx);
    expect(uk.reasons.some((r) => r.startsWith('Other country'))).toBe(true);
    expect(uk.score).toBeLessThan(30);
  });

  it('uses category for local and news signals', () => {
    const s = scoreChannel(ch('WDHN ABC 18', 'USA LOCAL ALABAMA'), ctx);
    expect(s.reasons).toEqual(
      expect.arrayContaining(['Local category', 'Mentions Alabama', 'US station call sign']),
    );
  });

  it('pushes sports/movie channels down', () => {
    expect(scoreChannel(ch('US| FOX Sports 1'), ctx).score).toBeLessThan(
      scoreChannel(ch('US| FOX News'), ctx).score,
    );
  });

  it('recognizes non-English weather channels', () => {
    expect(
      scoreChannel(ch('DE| Wetter.com TV'), { city: 'Berlin', state: '', country: 'DE' }).reasons,
    ).toContain('Weather channel');
  });
});

describe('suggest', () => {
  it('filters below threshold and sorts by score', () => {
    const out = suggest([ch('US| HBO'), ch('US| Weather Channel'), ch('WTVY Dothan News')], ctx);
    expect(out.map((s) => s.channel.name)).toEqual(['WTVY Dothan News', 'US| Weather Channel']);
  });
});

describe('parseM3u', () => {
  it('parses attributes and names containing commas', () => {
    const list = parseM3u(
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="WTVY.us" tvg-logo="http://l/4.png" group-title="US Local",CBS 4, Dothan',
        'http://host/live/1.ts',
        '#EXTINF:-1,Plain',
        '#EXTVLCOPT:http-user-agent=VLC',
        'http://host/live/2.m3u8',
      ].join('\n'),
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      name: 'CBS 4, Dothan',
      epgId: 'WTVY.us',
      category: 'US Local',
      logo: 'http://l/4.png',
    });
    expect(list[1]).toMatchObject({ name: 'Plain', url: 'http://host/live/2.m3u8' });
    expect(list[0].key).not.toEqual(list[1].key);
  });
});
