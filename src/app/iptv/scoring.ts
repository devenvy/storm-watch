import type { Channel } from './models';

export interface ScoreContext {
  city: string;
  /** Two-letter US state code, or empty outside the US. */
  state: string;
  /** ISO country code, e.g. 'US'. */
  country: string;
}

export interface Suggestion {
  channel: Channel;
  score: number;
  reasons: string[];
}

const WEATHER = /\b(weather|wx|wetter|m[ée]t[ée]o|meteo|tiempo|clima|tempo|weer|pogoda|v[äa]der|s[äa]a)\b/i;
const NEWS = /\b(news|nachrichten|noticias|notizie|nieuws|journal|info|actualit[ée]s?|noticiero|telediario|nyheter|uutiset)\b/i;
const LOCAL = /\b(local|locals|regional|affiliates?)\b/i;
const NETWORK = /\b(CBS|NBC|ABC|FOX|PBS|CW)\b/;
const JUNK = /\b(ppv|vod|movies?|cinema|sports?|music|kids|xxx|adult|24\/7|replay|radio)\b/i;
const CALLSIGN = /\b[KW][A-Z]{2,3}(?:-?(?:TV|DT|HD))?\b/;
/** Leading country tag: "US| ", "[UK] ", "CA: ", "(DE) ", "USA - ". */
const COUNTRY_TAG = /^\s*[[(]?\s*([A-Z]{2,3})\s*[\])|:-]/;

const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ['US', 'USA'], GB: ['UK', 'GB'], CA: ['CA', 'CAN'], AU: ['AU', 'AUS'],
  DE: ['DE', 'GER'], FR: ['FR', 'FRA'], ES: ['ES', 'ESP'], IT: ['IT', 'ITA'],
  NL: ['NL'], IE: ['IE', 'IRE'], NZ: ['NZ'], MX: ['MX', 'MEX'],
};

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

function countryOf(text: string): string | null {
  const tag = text.match(COUNTRY_TAG)?.[1];
  if (!tag) {return null;}
  for (const [iso, aliases] of Object.entries(COUNTRY_ALIASES)) {if (aliases.includes(tag)) {return iso;}}
  return tag;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function scoreChannel(ch: Channel, ctx: ScoreContext): Suggestion {
  const name = ch.name;
  const cat = ch.category ?? '';
  const both = `${name} ${cat}`;
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => { score += n; reasons.push(why); };

  if (ctx.city.length >= 3 && new RegExp(`\\b${escapeRe(ctx.city)}\\b`, 'i').test(both)) {add(60, `Mentions ${ctx.city}`);}
  const stateName = STATES[ctx.state];
  if (stateName && new RegExp(`\\b${escapeRe(stateName)}\\b`, 'i').test(both)) {add(20, `Mentions ${stateName}`);}
  if (WEATHER.test(name)) {add(55, 'Weather channel');}
  else if (WEATHER.test(cat)) {add(30, 'Weather category');}
  if (NEWS.test(name)) {add(20, 'News channel');}
  else if (NEWS.test(cat)) {add(15, 'News category');}
  if (LOCAL.test(cat)) {add(20, 'Local category');}
  if (ctx.country === 'US' && CALLSIGN.test(name)) {add(10, 'US station call sign');}
  if (NETWORK.test(name)) {add(5, 'Broadcast network');}

  const tagged = countryOf(name) ?? countryOf(cat);
  if (tagged && tagged === ctx.country) {add(10, 'Your country');}
  else if (tagged) { score -= 50; reasons.push(`Other country (${tagged})`); }
  if (JUNK.test(both)) { score -= 35; reasons.push('Likely not live news'); }

  return { channel: ch, score, reasons };
}

export function suggest(channels: Channel[], ctx: ScoreContext, limit = 60, min = 30): Suggestion[] {
  return channels
    .map(c => scoreChannel(c, ctx))
    .filter(s => s.score >= min)
    .sort((a, b) => b.score - a.score || a.channel.name.localeCompare(b.channel.name))
    .slice(0, limit);
}
