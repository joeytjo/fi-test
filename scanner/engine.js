// Prop scanner math + data normalisation. Works in the browser (window.ScannerEngine)
// and in Node (module.exports) so it can be unit-tested.
(function (root) {
  'use strict';

  // ---------- odds conversions ----------
  function americanToDecimal(a) {
    a = Number(a);
    return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
  }
  function decimalToAmerican(d) {
    if (d >= 2) return Math.round((d - 1) * 100);
    return Math.round(-100 / (d - 1));
  }
  function impliedProb(american) {
    return 1 / americanToDecimal(american);
  }
  function probToAmerican(p) {
    return decimalToAmerican(1 / p);
  }
  function fmtAmerican(a) {
    a = Math.round(a);
    return a > 0 ? '+' + a : String(a);
  }

  // Remove the bookmaker margin from a two-way market.
  // method: 'multiplicative' (default), 'additive', or 'power'
  function devig(overAmerican, underAmerican, method) {
    var po = impliedProb(overAmerican);
    var pu = impliedProb(underAmerican);
    method = method || 'multiplicative';
    if (method === 'additive') {
      var excess = (po + pu - 1) / 2;
      return { over: po - excess, under: pu - excess };
    }
    if (method === 'power') {
      // find k such that po^k + pu^k = 1
      var lo = 0.5, hi = 2;
      for (var i = 0; i < 60; i++) {
        var k = (lo + hi) / 2;
        var s = Math.pow(po, k) + Math.pow(pu, k);
        if (s > 1) lo = k; else hi = k;
      }
      var kk = (lo + hi) / 2;
      return { over: Math.pow(po, kk), under: Math.pow(pu, kk) };
    }
    var sum = po + pu;
    return { over: po / sum, under: pu / sum };
  }

  // Expected value as a fraction of stake.
  function ev(fairProb, american) {
    return fairProb * americanToDecimal(american) - 1;
  }

  // Full Kelly fraction (of bankroll). Returns 0 when there is no edge.
  function kelly(fairProb, american) {
    var b = americanToDecimal(american) - 1;
    var f = (b * fairProb - (1 - fairProb)) / b;
    return f > 0 ? f : 0;
  }

  // ---------- pick'em (DFS) payouts ----------
  // Default payout multipliers for "power" (all legs must hit) entries.
  // These are user-editable in the UI because apps change them often.
  var DEFAULT_POWER_PAYOUTS = { 2: 3, 3: 5, 4: 10, 5: 20, 6: 37.5 };

  // Break-even per-leg win probability for an N-leg power entry.
  function breakEvenPerLeg(legs, multiplier) {
    return Math.pow(1 / multiplier, 1 / legs);
  }

  // ---------- parlay ----------
  // legs: [{ fairProb, american }] for sportsbook parlays (payout = product of decimals)
  function parlay(legs, opts) {
    opts = opts || {};
    var fair = 1, dec = 1;
    legs.forEach(function (l) {
      fair *= l.fairProb;
      dec *= americanToDecimal(l.american);
    });
    if (opts.multiplier) dec = opts.multiplier; // pick'em fixed payout
    return {
      fairProb: fair,
      decimal: dec,
      american: decimalToAmerican(dec),
      fairAmerican: legs.length ? probToAmerican(fair) : 0,
      ev: fair * dec - 1
    };
  }

  // ---------- normal distribution helpers (for alt-line estimates) ----------
  function normCdf(x) {
    // Abramowitz-Stegun 7.1.26
    var t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }
  function normInv(p) {
    // Acklam's approximation
    var a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    var b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    var c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    var d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    var pl = 0.02425, q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  // Estimate P(over) at line `to` given fair P(over) at line `from`, using a normal
  // approximation whose spread grows with the size of the stat.
  function shiftLine(pOverAtFrom, from, to) {
    var sigma = Math.max(0.8, 1.15 * Math.sqrt(Math.max(from, 0.5)));
    var p = Math.min(0.995, Math.max(0.005, pOverAtFrom));
    var mu = from + sigma * normInv(p);
    return 1 - normCdf((to - mu) / sigma);
  }

  // ---------- normalisation ----------
  // Input rows (flat): { eventId, event, commence, sport, market, player, point, side, book, price }
  //   price may be null for pick'em apps that post a line without odds.
  // Output: one row per (event, market, player, point, side) with every book's price,
  // a de-vigged fair probability, the best sportsbook price + EV, and the pick'em apps
  // offering that exact line.
  function buildProps(rows, opts) {
    opts = opts || {};
    var sharpBooks = opts.sharpBooks || ['pinnacle', 'circasports', 'fanduel'];
    var method = opts.devigMethod || 'multiplicative';
    var dfsBooks = opts.dfsBooks || ['prizepicks', 'underdog', 'pick6', 'betr_us_dfs', 'dabble_au'];
    var isDfs = function (bk) { return dfsBooks.indexOf(bk) !== -1; };

    var lines = {};
    rows.forEach(function (r) {
      var key = [r.eventId, r.market, r.player, r.point].join('|');
      var g = lines[key];
      if (!g) {
        g = lines[key] = {
          key: key, eventId: r.eventId, event: r.event, commence: r.commence,
          sport: r.sport, market: r.market, player: r.player, point: Number(r.point),
          books: {}
        };
      }
      var b = g.books[r.book] || (g.books[r.book] = {});
      b[r.side === 'Under' ? 'under' : 'over'] = r.price == null ? null : Number(r.price);
    });

    // pass 1: fair price for every line that has two-sided sportsbook odds
    Object.keys(lines).forEach(function (key) {
      var g = lines[key];
      var fairs = [], source = [];
      function collect(filter) {
        Object.keys(g.books).forEach(function (bk) {
          var b = g.books[bk];
          if (b.over == null || b.under == null || isDfs(bk) || !filter(bk)) return;
          fairs.push(devig(b.over, b.under, method));
          source.push(bk);
        });
      }
      collect(function (bk) { return sharpBooks.indexOf(bk) !== -1; });
      if (!fairs.length) collect(function () { return true; });
      if (fairs.length) {
        g.fairOver = fairs.reduce(function (s, f) { return s + f.over; }, 0) / fairs.length;
        g.sharpSource = source;
        g.estimated = false;
      }
    });

    // pass 2: lines without a fair price (typically pick'em-only lines) are estimated
    // from the nearest priced line for the same player + market.
    var byPlayer = {};
    Object.keys(lines).forEach(function (key) {
      var g = lines[key];
      var pk = [g.eventId, g.market, g.player].join('|');
      (byPlayer[pk] || (byPlayer[pk] = [])).push(g);
    });
    Object.keys(byPlayer).forEach(function (pk) {
      var group = byPlayer[pk];
      var priced = group.filter(function (g) { return g.fairOver != null && !g.estimated; });
      if (!priced.length) return;
      group.forEach(function (g) {
        if (g.fairOver != null) return;
        var ref = priced.slice().sort(function (a, b) { return Math.abs(a.point - g.point) - Math.abs(b.point - g.point); })[0];
        g.fairOver = shiftLine(ref.fairOver, ref.point, g.point);
        g.sharpSource = ref.sharpSource;
        g.estimated = true;
        g.refPoint = ref.point;
      });
    });

    var out = [];
    Object.keys(lines).forEach(function (key) {
      var g = lines[key];
      if (g.fairOver == null) return;
      ['over', 'under'].forEach(function (side) {
        var fp = side === 'over' ? g.fairOver : 1 - g.fairOver;
        var best = null, prices = {}, dfs = [];
        Object.keys(g.books).forEach(function (bk) {
          if (!(side in g.books[bk])) return;
          var p = g.books[bk][side];
          if (isDfs(bk)) { dfs.push(bk); return; }
          if (p == null) return;
          prices[bk] = p;
          if (!best || americanToDecimal(p) > americanToDecimal(best.price)) best = { book: bk, price: p };
        });
        if (!best && !dfs.length) return;
        out.push({
          id: key + '|' + side,
          eventId: g.eventId, event: g.event, commence: g.commence, sport: g.sport,
          market: g.market, player: g.player, point: g.point,
          side: side === 'over' ? 'Over' : 'Under',
          fairProb: fp,
          fairAmerican: probToAmerican(fp),
          bestBook: best ? best.book : null,
          bestPrice: best ? best.price : null,
          ev: best ? ev(fp, best.price) : null,
          kelly: best ? kelly(fp, best.price) : 0,
          prices: prices,
          dfsBooks: dfs,
          sharpSource: g.sharpSource,
          estimated: g.estimated,
          refPoint: g.refPoint,
          bookCount: Object.keys(prices).length + dfs.length
        });
      });
    });
    return out;
  }

  // ---------- daily picks ----------
  // Chooses a short, diversified card from scanned props:
  //  - bets:   top +EV sportsbook bets (one per player, at most `perGame` per game)
  //  - pickem: the best `legs`-leg power-play entry (distinct players and games)
  function pickDaily(props, opts) {
    opts = opts || {};
    var maxBets = opts.maxBets || 8;
    var minEv = opts.minEv == null ? 0.02 : opts.minEv;
    var perGame = opts.perGame || 2;
    var exactOnly = opts.exactOnly !== false; // estimated lines are excluded from bets by default
    var legs = opts.legs || 3;
    var payouts = opts.payouts || DEFAULT_POWER_PAYOUTS;
    var now = opts.now || Date.now();
    var upcoming = function (p) { return !p.commence || new Date(p.commence).getTime() > now; };

    // very large edges are almost always stale or mis-posted lines, so they are left out
    var maxEv = opts.maxEv == null ? 0.25 : opts.maxEv;
    var minBooks = opts.minBooks || 3;
    var players = {}, games = {}, bets = [];
    props.filter(function (p) {
      return upcoming(p) && p.ev != null && p.ev >= minEv && p.ev <= maxEv && !(exactOnly && p.estimated) && p.bookCount >= minBooks;
    })
      .sort(function (a, b) { return b.ev - a.ev; })
      .forEach(function (p) {
        // one bet per player (props) or per market (game lines, e.g. not both Over 2.5 and Over 3)
        var who = p.player || p.eventId + '|' + p.market;
        if (bets.length >= maxBets || players[who] || (games[p.eventId] || 0) >= perGame) return;
        players[who] = 1;
        games[p.eventId] = (games[p.eventId] || 0) + 1;
        bets.push(p);
      });

    var be = breakEvenPerLeg(legs, payouts[legs]);
    var candidates = props.filter(function (p) { return upcoming(p) && p.dfsBooks && p.dfsBooks.length && p.fairProb > be; })
      .sort(function (a, b) { return b.fairProb - a.fairProb; });
    // an entry can only combine picks from one app's board, so build the best entry per app
    var apps = {};
    candidates.forEach(function (p) { p.dfsBooks.forEach(function (a) { apps[a] = 1; }); });
    var pickem = null;
    Object.keys(apps).forEach(function (app) {
      var entry = [], ep = {}, eg = {};
      candidates.forEach(function (p) {
        if (entry.length >= legs || p.dfsBooks.indexOf(app) === -1 || ep[p.player] || eg[p.eventId]) return;
        ep[p.player] = 1; eg[p.eventId] = 1;
        entry.push(p);
      });
      if (entry.length !== legs) return;
      var res = parlay(entry.map(function (p) { return { fairProb: p.fairProb, american: 100 }; }), { multiplier: payouts[legs] });
      if (!pickem || res.ev > pickem.ev) {
        pickem = { app: app, legs: entry, multiplier: payouts[legs], breakEven: be, hitProb: res.fairProb, ev: res.ev };
      }
    });
    return { bets: bets, pickem: pickem };
  }

  // ---------- game markets (match result, totals, handicaps) ----------
  // Remove the margin from a market with any number of outcomes (e.g. 3-way soccer result).
  function devigN(prices) {
    var imp = prices.map(impliedProb);
    var sum = imp.reduce(function (s, x) { return s + x; }, 0);
    return imp.map(function (x) { return x / sum; });
  }

  // Flatten a The Odds API /odds response (game markets) into rows for buildGameMarkets.
  // `line` keys outcomes that belong together: the total for totals, the home handicap for spreads.
  function flattenOddsApiGame(evt, sportTitle) {
    var rows = [];
    var name = evt.home_team + ' vs ' + evt.away_team;
    (evt.bookmakers || []).forEach(function (bm) {
      (bm.markets || []).forEach(function (m) {
        (m.outcomes || []).forEach(function (o) {
          var line = '';
          if (m.key === 'totals') line = String(o.point);
          if (m.key === 'spreads') line = String(o.name === evt.home_team ? o.point : -o.point);
          rows.push({
            eventId: evt.id, event: name, commence: evt.commence_time,
            sport: sportTitle || evt.sport_title || evt.sport_key, home: evt.home_team, away: evt.away_team,
            market: m.key, line: line, outcome: o.name, point: o.point == null ? null : o.point,
            book: bm.key, price: o.price
          });
        });
      });
    });
    return rows;
  }

  function buildGameMarkets(rows, opts) {
    opts = opts || {};
    var sharpBooks = opts.sharpBooks || ['pinnacle'];
    var exclude = opts.excludeBooks || ['betfair_ex_eu', 'betfair_ex_uk', 'betfair_ex_au', 'matchbook', 'smarkets'];
    var groups = {};
    rows.forEach(function (r) {
      if (exclude.indexOf(r.book) !== -1 || r.price == null) return;
      var key = [r.eventId, r.market, r.line].join('|');
      var g = groups[key] || (groups[key] = { key: key, r: r, books: {}, outcomes: {} });
      (g.books[r.book] || (g.books[r.book] = {}))[r.outcome] = Number(r.price);
      g.outcomes[r.outcome] = r.point;
    });
    var out = [];
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      var names = Object.keys(g.outcomes);
      if (names.length < 2) return;
      var complete = function (bk) { return names.every(function (n) { return g.books[bk][n] != null; }); };
      var src = Object.keys(g.books).filter(function (bk) { return sharpBooks.indexOf(bk) !== -1 && complete(bk); });
      var consensus = false;
      if (!src.length) {
        src = Object.keys(g.books).filter(complete);
        consensus = true;
        if (src.length < 3) return; // too thin to trust a consensus price
      }
      var fair = names.map(function () { return 0; });
      src.forEach(function (bk) {
        devigN(names.map(function (n) { return g.books[bk][n]; })).forEach(function (p, i) { fair[i] += p / src.length; });
      });
      names.forEach(function (n, i) {
        var best = null, prices = {};
        Object.keys(g.books).forEach(function (bk) {
          var p = g.books[bk][n];
          if (p == null) return;
          prices[bk] = p;
          if (!best || americanToDecimal(p) > americanToDecimal(best.price)) best = { book: bk, price: p };
        });
        var r = g.r;
        out.push({
          id: key + '|' + n, kind: 'game',
          eventId: r.eventId, event: r.event, commence: r.commence, sport: r.sport,
          market: r.market, line: r.line, outcome: n, point: g.outcomes[n], home: r.home, away: r.away,
          fairProb: fair[i], fairAmerican: probToAmerican(fair[i]),
          bestBook: best.book, bestPrice: best.price,
          ev: ev(fair[i], best.price), kelly: kelly(fair[i], best.price),
          prices: prices, sharpSource: src, consensus: consensus,
          bookCount: Object.keys(prices).length, dfsBooks: []
        });
      });
    });
    return out;
  }

  // Human-readable selection for a game-market row, e.g. "Arsenal to win", "Over 2.5 goals".
  function describeGameBet(p) {
    if (p.market === 'h2h') return p.outcome === 'Draw' ? 'Draw' : p.outcome + ' to win';
    if (p.market === 'totals') return p.outcome + ' ' + p.point + ' goals';
    if (p.market === 'spreads') return p.outcome + ' ' + (p.point > 0 ? '+' : '') + p.point + ' (handicap)';
    return p.outcome + ' (' + p.market + ')';
  }

  // Flatten a The Odds API event-odds response into rows for buildProps.
  function flattenOddsApiEvent(evt, sportTitle) {
    var rows = [];
    var name = evt.away_team + ' @ ' + evt.home_team;
    (evt.bookmakers || []).forEach(function (bm) {
      (bm.markets || []).forEach(function (m) {
        (m.outcomes || []).forEach(function (o) {
          if (o.point == null || !o.description) return;
          if (o.name !== 'Over' && o.name !== 'Under') return;
          rows.push({
            eventId: evt.id, event: name, commence: evt.commence_time,
            sport: sportTitle || evt.sport_title || evt.sport_key,
            market: m.key, player: o.description, point: o.point,
            side: o.name, book: bm.key, price: o.price
          });
        });
      });
    });
    return rows;
  }

  var api = {
    americanToDecimal: americanToDecimal,
    decimalToAmerican: decimalToAmerican,
    impliedProb: impliedProb,
    probToAmerican: probToAmerican,
    fmtAmerican: fmtAmerican,
    devig: devig,
    ev: ev,
    kelly: kelly,
    parlay: parlay,
    breakEvenPerLeg: breakEvenPerLeg,
    DEFAULT_POWER_PAYOUTS: DEFAULT_POWER_PAYOUTS,
    buildProps: buildProps,
    shiftLine: shiftLine,
    normCdf: normCdf,
    normInv: normInv,
    flattenOddsApiEvent: flattenOddsApiEvent,
    pickDaily: pickDaily,
    devigN: devigN,
    flattenOddsApiGame: flattenOddsApiGame,
    buildGameMarkets: buildGameMarkets,
    describeGameBet: describeGameBet
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScannerEngine = api;
})(this);
