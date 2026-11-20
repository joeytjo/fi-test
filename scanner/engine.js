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
    flattenOddsApiEvent: flattenOddsApiEvent
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScannerEngine = api;
})(this);
