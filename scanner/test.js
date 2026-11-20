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
