// Generates realistic-looking but entirely FICTIONAL prop odds so the scanner can be
// explored without an API key. Teams and players are made up.
(function (root) {
  'use strict';

  function rng(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  var SPORTS = {
    basketball_nba: {
      title: 'NBA',
      teams: ['Harbor City Gulls', 'Redrock Coyotes', 'Northgate Owls', 'Lakeside Pilots', 'Ironwood Bears', 'Sunvale Comets'],
      markets: { player_points: [12, 31], player_rebounds: [3.5, 12.5], player_assists: [2.5, 10.5], player_threes: [0.5, 4.5], player_points_rebounds_assists: [20, 45] },
      first: ['Marcus', 'Devin', 'Jalen', 'Tyrese', 'Andre', 'Isaiah', 'Kobe', 'Darius', 'Malik', 'Trey', 'Cam', 'Jordan'],
      last: ['Whitfield', 'Okoro-Bass', 'Lindqvist', 'Harrow', 'Pemberton', 'Castellano', 'Ruiz', 'Achterberg', 'Dunmore', 'Vance', 'Mbeki', 'Sorensen']
    },
    americanfootball_nfl: {
      title: 'NFL',
      teams: ['Bayport Mariners', 'Granite Peak Rams', 'Copper Valley Hawks', 'Eastshore Foxes'],
      markets: { player_pass_yds: [195, 285], player_rush_yds: [35, 95], player_reception_yds: [28, 88], player_receptions: [2.5, 7.5], player_pass_tds: [0.5, 2.5] },
      first: ['Caleb', 'Brock', 'Zane', 'Tavon', 'Rashad', 'Wyatt', 'Colby', 'Deshawn'],
      last: ['Hollis', 'Merriweather', 'Strand', 'Abernathy', 'Kowalczyk', 'Branson', 'Fairley', 'Ogunleye']
    },
    icehockey_nhl: {
      title: 'NHL',
      teams: ['Frostburg Lynx', 'Pine Harbor Moose', 'Steelport Blades', 'Glacier Bay Orcas'],
      markets: { player_shots_on_goal: [1.5, 4.5], player_points: [0.5, 1.5], player_assists: [0.5, 0.5] },
      first: ['Nils', 'Mikko', 'Tanner', 'Evgeni', 'Brayden', 'Luc'],
      last: ['Halvorsen', 'Rautio', 'Beaulieu', 'Kuznetsov', 'McAllister', 'Dufresne']
    }
  };

  var SPORTSBOOKS = ['pinnacle', 'fanduel', 'draftkings', 'betmgm', 'caesars', 'espnbet', 'betrivers', 'fanatics'];
  var DFS = ['prizepicks', 'underdog'];

  function toAmerican(p) {
    return p >= 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
  }

  function generate(sportKeys, seed) {
    var r = rng(seed || Date.now() % 100000);
    var rows = [];
    var now = Date.now();
    sportKeys.forEach(function (sk) {
      var s = SPORTS[sk];
      if (!s) return;
      for (var gi = 0; gi + 1 < s.teams.length; gi += 2) {
        var eventId = sk + '-' + gi;
        var event = s.teams[gi] + ' @ ' + s.teams[gi + 1];
        var commence = new Date(now + (2 + gi * 1.5 + r() * 3) * 3600e3).toISOString();
        for (var pi = 0; pi < 5; pi++) {
          var player = s.first[Math.floor(r() * s.first.length)] + ' ' + s.last[Math.floor(r() * s.last.length)];
          Object.keys(s.markets).forEach(function (mk) {
            if (r() < 0.25) return;
            var range = s.markets[mk];
            var point = Math.floor(range[0] + r() * (range[1] - range[0])) + 0.5;
            var trueOver = 0.42 + r() * 0.16;
            SPORTSBOOKS.forEach(function (bk) {
              if (bk !== 'pinnacle' && r() < 0.2) return;
              var vig = bk === 'pinnacle' ? 0.025 : 0.04 + r() * 0.03;
              var noise = bk === 'pinnacle' ? 0 : (r() - 0.5) * 0.09; // soft books are noisy
              var po = Math.min(0.85, Math.max(0.15, trueOver + noise));
              var pOver = po * (1 + vig), pUnder = (1 - po) * (1 + vig);
              rows.push({ eventId: eventId, event: event, commence: commence, sport: s.title, market: mk, player: player, point: point, side: 'Over', book: bk, price: toAmerican(Math.min(0.95, pOver)) });
              rows.push({ eventId: eventId, event: event, commence: commence, sport: s.title, market: mk, player: player, point: point, side: 'Under', book: bk, price: toAmerican(Math.min(0.95, pUnder)) });
            });
            DFS.forEach(function (bk) {
              if (r() < 0.3) return;
              // pick'em apps sometimes hang a line that is off the market by a half/full point
              // (only on bigger stats, and by a realistic half/full point or 1-2 for yardage-type props)
              var step = point >= 15 ? 1 + Math.floor(r() * 2) : point >= 4 ? 1 : 0;
              var shift = r() < 0.3 ? (r() < 0.5 ? -1 : 1) * step : 0;
              var p = Math.max(0.5, point + shift);
              rows.push({ eventId: eventId, event: event, commence: commence, sport: s.title, market: mk, player: player, point: p, side: 'Over', book: bk, price: null });
              rows.push({ eventId: eventId, event: event, commence: commence, sport: s.title, market: mk, player: player, point: p, side: 'Under', book: bk, price: null });
            });
          });
        }
      }
    });
    return rows;
  }

  var api = { generate: generate, SPORTS: SPORTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScannerDemo = api;
})(this);
