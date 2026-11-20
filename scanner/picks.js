#!/usr/bin/env node
// Daily picks from the command line.
//
//   node scanner/picks.js --demo                       # fictional data, no key
//   NODE_USE_ENV_PROXY=1 ODDS_API_KEY=... node scanner/picks.js --sports nba,nfl
//
// Options (all optional):
//   --sports nba,nfl,nhl,mlb   sports to scan (default: nba,nfl)
//   --games 4                  max games per sport, soonest first (default 4)
//   --hours 18                 only games starting within this many hours (default 18)
//   --regions us,us_dfs,eu     Odds API regions (us_dfs = pick'em apps, eu = Pinnacle)
//   --markets core|all         core = 3 markets per sport (cheaper), all = every market
//   --legs 3                   pick'em entry size (2-6)
//   --min-ev 2                 minimum EV % for sportsbook bets
//   --json                     print JSON instead of text
//
// Credit cost per run is about: games x markets x regions (the events list is free).
'use strict';
const E = require('./engine.js');
const D = require('./demo.js');

const SPORTS = {
  nba: { key: 'basketball_nba', title: 'NBA', core: ['player_points', 'player_rebounds', 'player_assists'], extra: ['player_threes', 'player_points_rebounds_assists'] },
  nfl: { key: 'americanfootball_nfl', title: 'NFL', core: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds'], extra: ['player_receptions', 'player_pass_tds'] },
  nhl: { key: 'icehockey_nhl', title: 'NHL', core: ['player_shots_on_goal', 'player_points'], extra: ['player_assists'] },
  mlb: { key: 'baseball_mlb', title: 'MLB', core: ['batter_hits', 'batter_total_bases', 'pitcher_strikeouts'], extra: [] }
};
const LABEL = {
  player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: '3PM',
  player_points_rebounds_assists: 'PRA', player_pass_yds: 'Pass Yds', player_rush_yds: 'Rush Yds',
  player_reception_yds: 'Rec Yds', player_receptions: 'Receptions', player_pass_tds: 'Pass TDs',
  player_shots_on_goal: 'SOG', batter_hits: 'Hits', batter_total_bases: 'Total Bases', pitcher_strikeouts: 'Ks'
};
const BOOK = {
  pinnacle: 'Pinnacle', fanduel: 'FanDuel', draftkings: 'DraftKings', betmgm: 'BetMGM', caesars: 'Caesars',
  espnbet: 'ESPN BET', betrivers: 'BetRivers', fanatics: 'Fanatics', prizepicks: 'PrizePicks', underdog: 'Underdog', pick6: 'DK Pick6', betr_us_dfs: 'Betr'
};

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  }
  return o;
}

let creditsLeft = null, creditsUsed = 0;
async function apiGet(path, params, key) {
  const u = new URL('https://api.the-odds-api.com/v4' + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('apiKey', key);
  const res = await fetch(u);
  if (res.headers.get('x-requests-remaining') != null) creditsLeft = res.headers.get('x-requests-remaining');
  creditsUsed += Number(res.headers.get('x-requests-last') || 0);
  if (!res.ok) throw new Error(`Odds API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function fetchLive(o, sports) {
  const key = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY;
  if (!key) throw new Error('Set ODDS_API_KEY (or use --demo).');
  const horizon = Date.now() + Number(o.hours || 18) * 3600e3;
  let rows = [];
  for (const s of sports) {
    const events = (await apiGet(`/sports/${s.key}/events`, {}, key))
      .filter(e => { const t = new Date(e.commence_time).getTime(); return t > Date.now() && t < horizon; })
      .sort((a, b) => a.commence_time.localeCompare(b.commence_time))
      .slice(0, Number(o.games || 4));
    const markets = o.markets === 'all' ? s.core.concat(s.extra) : s.core;
    for (const ev of events) {
      try {
        const odds = await apiGet(`/sports/${s.key}/events/${ev.id}/odds`, {
          regions: o.regions || 'us,us_dfs,eu', markets: markets.join(','), oddsFormat: 'american'
        }, key);
        rows = rows.concat(E.flattenOddsApiEvent(odds, s.title));
      } catch (e) {
        if (/40[13]/.test(e.message)) throw e;
        console.error(`skip ${s.title} ${ev.id}: ${e.message}`);
      }
    }
  }
  return rows;
}

const fmt = E.fmtAmerican;
const pct = x => (x * 100).toFixed(1) + '%';
const time = iso => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: process.env.PICKS_TZ || 'America/New_York', timeZoneName: 'short' });

function render(card, meta) {
  const out = [];
  out.push(`PROPSCOPE PICKS · ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.PICKS_TZ || 'America/New_York' })}${meta.demo ? ' · DEMO DATA' : ''}`);
  out.push('');
  if (card.bets.length) {
    out.push(`+EV BETS (${card.bets.length})`);
    card.bets.forEach((p, i) => {
      out.push(`${i + 1}. ${p.player} ${p.side} ${p.point} ${LABEL[p.market] || p.market} ${fmt(p.bestPrice)} @ ${BOOK[p.bestBook] || p.bestBook}` +
        ` | EV +${pct(p.ev)} | fair ${fmt(p.fairAmerican)} | 1/4 Kelly ${pct(p.kelly / 4)}`);
      out.push(`   ${p.event} · ${time(p.commence)}`);
    });
  } else {
    out.push('+EV BETS: none above the threshold right now.');
  }
  out.push('');
  if (card.pickem) {
    const pk = card.pickem;
    out.push(`PICK'EM ${pk.legs.length}-LEG POWER on ${BOOK[pk.app] || pk.app} (${pk.multiplier}x payout)`);
    pk.legs.forEach(p => out.push(`- ${p.player} ${p.side} ${p.point} ${LABEL[p.market] || p.market} · ${pct(p.fairProb)} fair${p.estimated ? ' (est.)' : ''} · ${p.event}`));
    out.push(`  Hit chance ${pct(pk.hitProb)} · EV ${pk.ev >= 0 ? '+' : ''}${pct(pk.ev)} (break-even ${pct(pk.breakEven)}/leg)`);
  } else {
    out.push("PICK'EM: no entry beats break-even right now.");
  }
  if (!meta.demo) {
    out.push('');
    out.push(`Credits used this run: ${creditsUsed}${creditsLeft != null ? ` · remaining: ${creditsLeft}` : ''}`);
  }
  return out.join('\n');
}

(async () => {
  const o = args();
  const sports = String(o.sports || 'nba,nfl').split(',').map(s => SPORTS[s.trim().toLowerCase()]).filter(Boolean);
  if (!sports.length) throw new Error('No valid --sports (use nba,nfl,nhl,mlb).');
  const rows = o.demo ? D.generate(sports.map(s => s.key), Date.now() % 100000) : await fetchLive(o, sports);
  const props = E.buildProps(rows);
  const card = E.pickDaily(props, { legs: Number(o.legs || 3), minEv: Number(o['min-ev'] || 2) / 100 });
  if (o.json) console.log(JSON.stringify({ ...card, creditsUsed, creditsLeft }, null, 2));
  else console.log(render(card, { demo: !!o.demo }));
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
