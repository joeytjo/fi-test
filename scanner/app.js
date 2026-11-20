(function () {
  'use strict';
  var E = window.ScannerEngine;
  var D = window.ScannerDemo;
  var $ = function (s) { return document.querySelector(s); };

  var SPORTS = {
    basketball_nba: { title: 'NBA', markets: ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists'] },
    americanfootball_nfl: { title: 'NFL', markets: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions', 'player_pass_tds'] },
    icehockey_nhl: { title: 'NHL', markets: ['player_shots_on_goal', 'player_points', 'player_assists'] },
    baseball_mlb: { title: 'MLB', markets: ['batter_hits', 'batter_total_bases', 'pitcher_strikeouts'] }
  };
  var MARKET_LABEL = {
    player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: '3PM',
    player_points_rebounds_assists: 'Pts+Reb+Ast', player_pass_yds: 'Pass Yds', player_rush_yds: 'Rush Yds',
    player_reception_yds: 'Rec Yds', player_receptions: 'Receptions', player_pass_tds: 'Pass TDs',
    player_shots_on_goal: 'Shots on Goal', batter_hits: 'Hits', batter_total_bases: 'Total Bases', pitcher_strikeouts: 'Strikeouts'
  };
  var BOOK_LABEL = {
    pinnacle: 'Pinnacle', fanduel: 'FanDuel', draftkings: 'DraftKings', betmgm: 'BetMGM', caesars: 'Caesars',
    espnbet: 'ESPN BET', betrivers: 'BetRivers', fanatics: 'Fanatics', prizepicks: 'PrizePicks', underdog: 'Underdog',
    pick6: 'DK Pick6', betr_us_dfs: 'Betr', circasports: 'Circa', bovada: 'Bovada', betonlineag: 'BetOnline', mybookieag: 'MyBookie'
  };
  var mLabel = function (k) { return MARKET_LABEL[k] || k.replace(/_/g, ' '); };
  var bLabel = function (k) { return BOOK_LABEL[k] || k; };
  var pct = function (x, d) { return (x * 100).toFixed(d == null ? 1 : d) + '%'; };

  // ---------- state ----------
  var load = function (k, d) { try { var v = JSON.parse(localStorage.getItem('propscope.' + k)); return v == null ? d : v; } catch (e) { return d; } };
  var save = function (k, v) { localStorage.setItem('propscope.' + k, JSON.stringify(v)); };

  var state = {
    settings: load('settings', { mode: 'demo', apiKey: '', regions: 'us,us_dfs,eu', maxEvents: 6, sharpBooks: 'pinnacle,circasports,fanduel', devigMethod: 'multiplicative' }),
    sports: load('sports', ['basketball_nba', 'americanfootball_nfl', 'icehockey_nhl']),
    tab: 'ev',
    rows: [],
    props: [],
    sort: { key: 'ev', asc: false },
    open: {},
    slip: load('slip', []),
    slipMode: load('slipMode', 'book'),
    payouts: load('payouts', E.DEFAULT_POWER_PAYOUTS),
    entrySize: load('entrySize', 2)
  };

  // ---------- data loading ----------
  function scan() {
    var s = state.settings;
    setStatus('Scanning…');
    var p = s.mode === 'live' ? fetchLive() : Promise.resolve(D.generate(state.sports, Math.floor(Date.now() / 60000)));
    return p.then(function (rows) {
      state.rows = rows;
      reprice();
      setStatus('Updated ' + new Date().toLocaleTimeString() + ' · ' + state.props.length + ' props');
    }).catch(function (err) {
      setStatus('⚠ ' + err.message);
      console.error(err);
    });
  }

  function reprice() {
    state.props = E.buildProps(state.rows, {
      sharpBooks: state.settings.sharpBooks.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
      devigMethod: state.settings.devigMethod
    });
    // refresh slip legs with the latest prices
    state.slip = state.slip.map(function (leg) {
      return state.props.find(function (p) { return p.id === leg.id; }) || leg;
    });
    fillFilterOptions();
    render();
  }

  function apiGet(path, params) {
    var u = new URL('https://api.the-odds-api.com/v4' + path);
    Object.keys(params).forEach(function (k) { u.searchParams.set(k, params[k]); });
    u.searchParams.set('apiKey', state.settings.apiKey);
    return fetch(u).then(function (res) {
      var rem = res.headers.get('x-requests-remaining');
      if (rem != null) $('#quota').textContent = rem + ' API credits left';
      if (!res.ok) return res.text().then(function (t) { throw new Error('Odds API ' + res.status + ': ' + t.slice(0, 160)); });
      return res.json();
    });
  }

  function fetchLive() {
    var s = state.settings;
    if (!s.apiKey) return Promise.reject(new Error('Add your The Odds API key under “Data source”.'));
    var all = [];
    return state.sports.reduce(function (chain, sk) {
      return chain.then(function () {
        var cfg = SPORTS[sk];
        return apiGet('/sports/' + sk + '/events', {}).then(function (events) {
          var soon = events
            .filter(function (e) { return new Date(e.commence_time) > new Date(); })
            .slice(0, Number(s.maxEvents) || 6);
          return Promise.all(soon.map(function (ev) {
            return apiGet('/sports/' + sk + '/events/' + ev.id + '/odds', {
              regions: s.regions, markets: cfg.markets.join(','), oddsFormat: 'american'
            }).then(function (odds) {
              all = all.concat(E.flattenOddsApiEvent(odds, cfg.title));
            }).catch(function (e) { console.warn(sk, ev.id, e.message); });
          }));
        }).catch(function (e) {
          if (/401|quota/i.test(e.message)) throw e;
          console.warn(sk, e.message);
        });
      });
    }, Promise.resolve()).then(function () { return all; });
  }

  // ---------- filtering / sorting ----------
  function filtered() {
    var q = $('#search').value.trim().toLowerCase();
    var mk = $('#marketFilter').value;
    var bk = $('#bookFilter').value;
    var hideEst = $('#hideEst').checked;
    var be = breakEven();
    var minEv = Number($('#minEv').value) / 100;
    var minEdge = Number($('#minEdge').value) / 100;
    var sportTitles = state.sports.map(function (k) { return (SPORTS[k] || {}).title; });

    var list = state.props.filter(function (p) {
      if (sportTitles.indexOf(p.sport) === -1) return false;
      if (q && (p.player + ' ' + p.event).toLowerCase().indexOf(q) === -1) return false;
      if (mk && p.market !== mk) return false;
      if (hideEst && p.estimated) return false;
      if (state.tab === 'ev') {
        if (p.ev == null || p.ev < minEv) return false;
        if (bk && p.bestBook !== bk && !(bk in p.prices)) return false;
      } else {
        if (!p.dfsBooks.length) return false;
        if (bk && p.dfsBooks.indexOf(bk) === -1) return false;
        if (p.fairProb - be < minEdge) return false;
      }
      return true;
    });

    var k = state.sort.key, dir = state.sort.asc ? 1 : -1;
    var val = function (p) {
      if (k === 'edge') return p.fairProb - be;
      if (k === 'player') return p.player;
      if (k === 'time') return p.commence || '';
      if (k === 'price') return p.bestPrice == null ? -1e9 : E.americanToDecimal(p.bestPrice);
      return p[k] == null ? -1e9 : p[k];
    };
    list.sort(function (a, b) {
      var x = val(a), y = val(b);
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
    return list;
  }

  function breakEven() {
    var n = Number(state.entrySize);
    return E.breakEvenPerLeg(n, Number(state.payouts[n]) || 1);
  }

  // ---------- rendering ----------
  var COLS = {
    ev: [
      ['player', 'Player'], ['prop', 'Prop', true], ['time', 'Game'], ['price', 'Best price'],
      ['fairProb', 'Fair'], ['ev', 'EV'], ['kelly', '¼ Kelly'], ['books', 'Books', true], ['add', '', true]
    ],
    pickem: [
      ['player', 'Player'], ['prop', 'Prop', true], ['time', 'Game'], ['apps', 'Apps', true],
      ['fairProb', 'Fair win %'], ['edge', 'Edge'], ['add', '', true]
    ]
  };

  function render() {
    var cols = COLS[state.tab];
    $('#board thead').innerHTML = '<tr>' + cols.map(function (c) {
      var cls = state.sort.key === c[0] ? 'sorted' + (state.sort.asc ? ' asc' : '') : '';
      return '<th data-key="' + c[0] + '" class="' + cls + '"' + (c[2] ? ' data-nosort' : '') + '>' + c[1] + '</th>';
    }).join('') + '</tr>';

    var list = filtered().slice(0, 400);
    var be = breakEven();
    var inSlip = {};
    state.slip.forEach(function (l) { inSlip[l.id] = 1; });

    var html = list.map(function (p) {
      var sideCls = p.side === 'Over' ? 'side-over' : 'side-under';
      var prop = '<span class="' + sideCls + '">' + p.side[0] + ' ' + p.point + '</span> ' + mLabel(p.market) +
        (p.estimated ? ' <span class="est" title="Fair price estimated from the ' + p.refPoint + ' line">est.</span>' : '');
      var game = '<div>' + esc(p.event) + '</div><div class="sub">' + p.sport + ' · ' + fmtTime(p.commence) + '</div>';
      var addBtn = '<button class="add' + (inSlip[p.id] ? ' in' : '') + '" data-add="' + attr(p.id) + '">' + (inSlip[p.id] ? '✓' : '+') + '</button>';
      var cells;
      if (state.tab === 'ev') {
        var evCls = p.ev >= 0 ? 'pos' : 'neg';
        cells = [
          '<span class="player">' + esc(p.player) + '</span>',
          prop, game,
          '<b>' + E.fmtAmerican(p.bestPrice) + '</b> <span class="book">' + bLabel(p.bestBook) + '</span>',
          '<span class="num">' + E.fmtAmerican(p.fairAmerican) + '</span><div class="sub">' + pct(p.fairProb) + '</div>',
          '<span class="ev ' + evCls + '">' + (p.ev >= 0 ? '+' : '') + pct(p.ev, 2) + '</span>',
          '<span class="num">' + pct(p.kelly / 4, 2) + '</span>',
          '<span class="sub">' + Object.keys(p.prices).length + ' books ▾</span>',
          addBtn
        ];
      } else {
        var edge = p.fairProb - be;
        cells = [
          '<span class="player">' + esc(p.player) + '</span>',
          prop, game,
          p.dfsBooks.map(function (b) { return '<span class="book">' + bLabel(b) + '</span>'; }).join(''),
          '<b>' + pct(p.fairProb) + '</b><span class="bar"><i style="width:' + Math.min(100, p.fairProb * 100) + '%"></i></span>',
          '<span class="ev ' + (edge >= 0 ? 'pos' : 'neg') + '">' + (edge >= 0 ? '+' : '') + pct(edge, 1) + '</span>',
          addBtn
        ];
      }
      var row = '<tr data-id="' + attr(p.id) + '" class="' + (state.open[p.id] ? 'open' : '') + '">' +
        cells.map(function (c, i) { return '<td' + (i > 2 ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>';
      if (state.open[p.id]) row += '<tr class="detail"><td colspan="' + cols.length + '">' + detail(p) + '</td></tr>';
      return row;
    }).join('');

    $('#board tbody').innerHTML = html;
    $('#empty').classList.toggle('hidden', list.length > 0);
    $('#minEvWrap').classList.toggle('hidden', state.tab !== 'ev');
    $('#minEdgeWrap').classList.toggle('hidden', state.tab !== 'pickem');
    renderSlip();
  }

  function detail(p) {
    var books = Object.keys(p.prices).sort(function (a, b) { return E.americanToDecimal(p.prices[b]) - E.americanToDecimal(p.prices[a]); });
    var grid = books.map(function (b) {
      var e = E.ev(p.fairProb, p.prices[b]);
      return '<div class="' + (b === p.bestBook ? 'best' : '') + '"><span class="sub">' + bLabel(b) + '</span><b>' + E.fmtAmerican(p.prices[b]) +
        '</b><span class="ev ' + (e >= 0 ? 'pos' : 'neg') + ' small">' + (e >= 0 ? '+' : '') + pct(e, 1) + '</span></div>';
    }).join('');
    var src = p.estimated
      ? 'Fair price estimated by shifting the ' + p.refPoint + ' line (priced from ' + p.sharpSource.map(bLabel).join(', ') + ').'
      : 'Fair price: margin removed from ' + p.sharpSource.map(bLabel).join(', ') + '.';
    return (grid ? '<div class="pricegrid">' + grid + '</div>' : '<span class="sub">No sportsbook offers this exact line.</span>') +
      '<p class="sub">' + src + ' Fair odds ' + E.fmtAmerican(p.fairAmerican) + ' (' + pct(p.fairProb) + ').</p>';
  }

  function renderSlip() {
    var legs = state.slip;
    $('#legCount').textContent = legs.length;
    $('#legs').innerHTML = legs.map(function (l) {
      var price = state.slipMode === 'book'
        ? (l.bestPrice != null ? E.fmtAmerican(l.bestPrice) + ' ' + bLabel(l.bestBook) : 'no book price')
        : pct(l.fairProb) + ' fair';
      return '<li><div><b>' + esc(l.player) + '</b><div class="sub">' + l.side + ' ' + l.point + ' ' + mLabel(l.market) +
        ' · ' + price + '</div></div><button data-remove="' + attr(l.id) + '">✕</button></li>';
    }).join('') || '<li class="sub">Click + on any prop to add a leg.</li>';

    var stake = Number($('#stake').value) || 0;
    var out = '', warn = '';
    var pe = state.slipMode === 'pickem';
    $('#payoutEditor').classList.toggle('hidden', !pe);
    if (legs.length) {
      var res;
      if (pe) {
        var mult = Number(state.payouts[legs.length]);
        if (!mult) warn = 'No power-play payout set for ' + legs.length + ' legs.';
        res = E.parlay(legs.map(function (l) { return { fairProb: l.fairProb, american: 100 }; }), { multiplier: mult || 1 });
      } else {
        var priced = legs.filter(function (l) { return l.bestPrice != null; });
        if (priced.length < legs.length) warn = 'Some legs have no sportsbook price and are left out.';
        res = E.parlay(priced.map(function (l) { return { fairProb: l.fairProb, american: l.bestPrice }; }));
      }
      out = row('Hit chance (fair)', pct(res.fairProb, 2)) +
        (pe ? row('Payout', res.decimal + '×') : row('Parlay odds', E.fmtAmerican(res.american))) +
        row('Fair odds', E.fmtAmerican(res.fairAmerican)) +
        row('To win', '$' + (stake * (res.decimal - 1)).toFixed(2)) +
        '<span>Expected value</span><span class="big ev ' + (res.ev >= 0 ? 'pos' : 'neg') + '">' +
        (res.ev >= 0 ? '+' : '') + pct(res.ev, 1) + ' ($' + (stake * res.ev).toFixed(2) + ')</span>';

      var seen = {}, games = {};
      legs.forEach(function (l) {
        if (seen[l.player]) warn = warn || 'Same player twice: these legs are correlated, so the combined odds are unreliable.';
        seen[l.player] = 1;
        games[l.eventId] = (games[l.eventId] || 0) + 1;
      });
      if (!warn && Object.keys(games).some(function (g) { return games[g] > 1; })) {
        warn = 'Several legs from one game: they may be correlated, and many books reprice same-game parlays.';
      }
    }
    $('#slipSummary').innerHTML = out;
    $('#slipWarn').textContent = warn;
    $('#slipWarn').classList.toggle('hidden', !warn);
    function row(a, b) { return '<span class="muted">' + a + '</span><span>' + b + '</span>'; }
  }

  function renderPayouts() {
    $('#payouts').innerHTML = [2, 3, 4, 5, 6].map(function (n) {
      return '<label>' + n + '-pick <input type="number" step="0.5" data-payout="' + n + '" value="' + state.payouts[n] + '">×</label>';
    }).join('');
    renderEntry();
  }

  function renderEntry() {
    $('#minEdgeWrap').innerHTML = 'Min edge <input id="minEdge" type="number" step="0.5" value="' + ($('#minEdge') ? $('#minEdge').value : 0) +
      '"> % vs <select id="entrySize">' + [2, 3, 4, 5, 6].map(function (n) {
        return '<option value="' + n + '"' + (n == state.entrySize ? ' selected' : '') + '>' + n + '-pick ' + state.payouts[n] + '× (' + pct(E.breakEvenPerLeg(n, state.payouts[n])) + ')</option>';
      }).join('') + '</select>';
  }

  function fillFilterOptions() {
    var mk = {}, bk = {};
    state.props.forEach(function (p) {
      mk[p.market] = 1;
      Object.keys(p.prices).forEach(function (b) { bk[b] = 1; });
      p.dfsBooks.forEach(function (b) { bk[b] = 1; });
    });
    var keep = function (sel, opts, first, lab) {
      var cur = sel.value;
      sel.innerHTML = '<option value="">' + first + '</option>' + Object.keys(opts).sort().map(function (k) {
        return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + lab(k) + '</option>';
      }).join('');
    };
    keep($('#marketFilter'), mk, 'All markets', mLabel);
    keep($('#bookFilter'), bk, 'Any book', bLabel);
  }

  function renderChips() {
    $('#sportChips').innerHTML = Object.keys(SPORTS).map(function (k) {
      return '<button class="chip' + (state.sports.indexOf(k) !== -1 ? ' on' : '') + '" data-sport="' + k + '">' + SPORTS[k].title + '</button>';
    }).join('');
  }

  function renderSource() {
    var live = state.settings.mode === 'live';
    var b = $('#sourceBadge');
    b.textContent = live ? 'LIVE · The Odds API' : 'DEMO DATA';
    b.className = 'badge ' + (live ? 'live' : 'demo');
    if (!live) $('#quota').textContent = '';
  }

  function setStatus(t) { $('#status').textContent = t; }
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function attr(s) { return esc(s); }

  // ---------- events ----------
  function bind() {
    $('#settingsBtn').onclick = function () { $('#settings').classList.toggle('hidden'); };
    $('#refreshBtn').onclick = scan;
    $('#saveSettings').onclick = function () {
      ['mode', 'apiKey', 'regions', 'maxEvents', 'sharpBooks', 'devigMethod'].forEach(function (k) { state.settings[k] = $('#' + k).value.trim(); });
      save('settings', state.settings);
      $('#settings').classList.add('hidden');
      renderSource();
      scan();
    };
    ['mode', 'apiKey', 'regions', 'maxEvents', 'sharpBooks', 'devigMethod'].forEach(function (k) { $('#' + k).value = state.settings[k]; });

    document.querySelector('.tabs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-tab]');
      if (!t) return;
      state.tab = t.dataset.tab;
      state.sort = { key: state.tab === 'ev' ? 'ev' : 'edge', asc: false };
      document.querySelectorAll('.tabs [data-tab]').forEach(function (b) { b.classList.toggle('active', b === t); });
      if (state.tab === 'pickem' && state.slipMode !== 'pickem') setSlipMode('pickem');
      render();
    });

    $('#sportChips').addEventListener('click', function (e) {
      var c = e.target.closest('[data-sport]');
      if (!c) return;
      var k = c.dataset.sport, i = state.sports.indexOf(k);
      if (i === -1) state.sports.push(k); else state.sports.splice(i, 1);
      save('sports', state.sports);
      renderChips();
      scan();
    });

    ['#search', '#marketFilter', '#bookFilter', '#minEv', '#hideEst'].forEach(function (s) {
      $(s).addEventListener('input', render);
    });
    $('#minEdgeWrap').addEventListener('input', function (e) {
      if (e.target.id === 'entrySize') { state.entrySize = Number(e.target.value); save('entrySize', state.entrySize); }
      render();
    });

    $('#board thead').addEventListener('click', function (e) {
      var th = e.target.closest('th');
      if (!th || th.hasAttribute('data-nosort')) return;
      var k = th.dataset.key;
      state.sort = state.sort.key === k ? { key: k, asc: !state.sort.asc } : { key: k, asc: k === 'player' || k === 'time' };
      render();
    });

    $('#board tbody').addEventListener('click', function (e) {
      var add = e.target.closest('[data-add]');
      if (add) {
        var id = add.dataset.add;
        var i = state.slip.findIndex(function (l) { return l.id === id; });
        if (i === -1) state.slip.push(state.props.find(function (p) { return p.id === id; }));
        else state.slip.splice(i, 1);
        save('slip', state.slip);
        render();
        return;
      }
      var tr = e.target.closest('tr[data-id]');
      if (tr) { state.open[tr.dataset.id] = !state.open[tr.dataset.id]; render(); }
    });

    $('#legs').addEventListener('click', function (e) {
      var r = e.target.closest('[data-remove]');
      if (!r) return;
      state.slip = state.slip.filter(function (l) { return l.id !== r.dataset.remove; });
      save('slip', state.slip);
      render();
    });
    $('#clearSlip').onclick = function () { state.slip = []; save('slip', []); render(); };
    $('#stake').addEventListener('input', renderSlip);
    document.querySelectorAll('[name=slipMode]').forEach(function (r) {
      r.addEventListener('change', function () { setSlipMode(r.value); });
    });
    $('#payouts').addEventListener('input', function (e) {
      var n = e.target.dataset.payout;
      if (!n) return;
      state.payouts[n] = Number(e.target.value);
      save('payouts', state.payouts);
      renderEntry();
      render();
    });
  }

  function setSlipMode(m) {
    state.slipMode = m;
    save('slipMode', m);
    document.querySelectorAll('[name=slipMode]').forEach(function (r) { r.checked = r.value === m; });
    renderSlip();
  }

  bind();
  renderChips();
  renderPayouts();
  renderSource();
  setSlipMode(state.slipMode);
  scan();
})();
