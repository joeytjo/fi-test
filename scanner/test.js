// Run with: node scanner/test.js
const assert = require('assert');
const E = require('./engine.js');
const D = require('./demo.js');

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

close(E.americanToDecimal(-110), 1.9091);
close(E.americanToDecimal(150), 2.5);
assert.strictEqual(E.decimalToAmerican(2.5), 150);
assert.strictEqual(E.decimalToAmerican(1.5), -200);

let f = E.devig(-110, -110);
close(f.over, 0.5);
f = E.devig(-150, 130, 'power');
close(f.over + f.under, 1);
f = E.devig(-150, 130, 'additive');
close(f.over + f.under, 1);

close(E.ev(0.55, 100), 0.10);
close(E.kelly(0.55, 100), 0.10);
assert.strictEqual(E.kelly(0.4, 100), 0);

close(E.breakEvenPerLeg(2, 3), 0.57735);
const p = E.parlay([{ fairProb: 0.5, american: 100 }, { fairProb: 0.5, american: 100 }]);
close(p.decimal, 4); close(p.ev, 0);

// shifting a 50/50 line up lowers P(over)
assert.ok(E.shiftLine(0.5, 20.5, 22.5) < 0.5);
close(E.shiftLine(0.5, 20.5, 20.5), 0.5);
close(E.normCdf(E.normInv(0.3)), 0.3);

// buildProps: sharp book drives the fair price, best price is picked, DFS-only line is estimated
const rows = [
  { eventId: 'e', event: 'A @ B', market: 'pts', player: 'X', point: 20.5, side: 'Over', book: 'pinnacle', price: -110 },
  { eventId: 'e', event: 'A @ B', market: 'pts', player: 'X', point: 20.5, side: 'Under', book: 'pinnacle', price: -110 },
  { eventId: 'e', event: 'A @ B', market: 'pts', player: 'X', point: 20.5, side: 'Over', book: 'draftkings', price: 115 },
  { eventId: 'e', event: 'A @ B', market: 'pts', player: 'X', point: 20.5, side: 'Under', book: 'draftkings', price: -140 },
  { eventId: 'e', event: 'A @ B', market: 'pts', player: 'X', point: 18.5, side: 'Over', book: 'prizepicks', price: null },
  { eventId: 'e', event: 'A @ B', market: 'pts', player: 'X', point: 18.5, side: 'Under', book: 'prizepicks', price: null },
];
const props = E.buildProps(rows);
const over = props.find(r => r.point === 20.5 && r.side === 'Over');
close(over.fairProb, 0.5);
assert.strictEqual(over.bestBook, 'draftkings');
close(over.ev, 0.075);
const dfsOver = props.find(r => r.point === 18.5 && r.side === 'Over');
assert.ok(dfsOver.estimated && dfsOver.fairProb > 0.6, 'lower pick\'em line should make over more likely');
assert.deepStrictEqual(dfsOver.dfsBooks, ['prizepicks']);

// Odds API flattening
const flat = E.flattenOddsApiEvent({
  id: 'x', home_team: 'H', away_team: 'A', commence_time: 't',
  bookmakers: [{ key: 'fanduel', markets: [{ key: 'player_points', outcomes: [
    { name: 'Over', description: 'P', price: -115, point: 10.5 },
    { name: 'Under', description: 'P', price: -105, point: 10.5 }] }] }]
}, 'NBA');
assert.strictEqual(flat.length, 2);
assert.strictEqual(flat[0].event, 'A @ H');

// demo data produces a sensible board
const demo = E.buildProps(D.generate(Object.keys(D.SPORTS), 42));
assert.ok(demo.length > 100);
assert.ok(demo.some(r => r.ev > 0.03));
assert.ok(demo.some(r => r.estimated && r.dfsBooks.length));

console.log('all tests passed (' + demo.length + ' demo props)');

// daily picks: diversified, upcoming only
const card = E.pickDaily(demo, { legs: 3, minEv: 0.02, now: 0 });
assert.ok(card.bets.length > 0 && card.bets.length <= 8);
assert.strictEqual(new Set(card.bets.map(b => b.player)).size, card.bets.length);
assert.ok(card.bets.every(b => b.ev >= 0.02 && !b.estimated));
if (card.pickem) {
  assert.strictEqual(card.pickem.legs.length, 3);
  assert.strictEqual(new Set(card.pickem.legs.map(l => l.eventId)).size, 3);
}
assert.strictEqual(E.pickDaily(demo, { now: Date.now() + 1e12 }).bets.length, 0, 'started games are excluded');
console.log('pickDaily ok');

// soccer / game markets
const sum3 = E.devigN([150, 180, 220]).reduce((a, b) => a + b, 0);
close(sum3, 1);
const game = {
  id: 'g', home_team: 'H', away_team: 'A', commence_time: new Date(Date.now() + 3600e3).toISOString(),
  bookmakers: [
    { key: 'pinnacle', markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: 100 }, { name: 'A', price: 250 }, { name: 'Draw', price: 240 }] },
      { key: 'spreads', outcomes: [{ name: 'H', point: -0.5, price: 100 }, { name: 'A', point: 0.5, price: -110 }] }] },
    { key: 'bet365', markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: 120 }, { name: 'A', price: 230 }, { name: 'Draw', price: 220 }] }] },
    { key: 'betfair_ex_eu', markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: 200 }, { name: 'A', price: 200 }, { name: 'Draw', price: 200 }] }] }
  ]
};
const gm = E.buildGameMarkets(E.flattenOddsApiGame(game, 'L'));
const home = gm.find(r => r.market === 'h2h' && r.outcome === 'H');
assert.strictEqual(home.bestBook, 'bet365', 'exchanges are excluded');
assert.ok(home.ev > 0 && !home.consensus);
assert.strictEqual(gm.filter(r => r.market === 'spreads').length, 2, 'both handicap sides group together');
assert.strictEqual(E.describeGameBet(home), 'H to win');
console.log('game markets ok');

// target odds: min = (1 + ev) / fair
const tg = E.targetOdds(gm, { minEv: 0.02 });
assert.strictEqual(tg.length, 1);
const h = tg[0].list.find(s => s.label === 'H');
close(h.min, h.fair * 1.02);
assert.deepStrictEqual(tg[0].list.map(s => s.label), ['H', 'Draw', 'A']);
console.log('target odds ok');

// target odds pick each match's main total line
const tGame = JSON.parse(JSON.stringify(game));
tGame.bookmakers[0].markets.push({ key: 'totals', outcomes: [
  { name: 'Over', point: 2.5, price: -150 }, { name: 'Under', point: 2.5, price: 130 },
  { name: 'Over', point: 3, price: -102 }, { name: 'Under', point: 3, price: -108 }] });
const tg2 = E.targetOdds(E.buildGameMarkets(E.flattenOddsApiGame(tGame, 'L')));
assert.deepStrictEqual(tg2[0].list.map(s => s.label), ['H', 'Draw', 'A', 'O3', 'U3']);
console.log('main total line ok');
