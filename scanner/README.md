# PropScope: player prop scanner

A static web app (no build step, no server) that scans player-prop odds and flags:

- **+EV bets**: sportsbook prices that beat the "fair" price. The fair price comes from removing the bookmaker's margin (the vig) from sharp books (Pinnacle by default).
- **Pick'em edges**: lines on PrizePicks, Underdog, DK Pick6 and similar apps where the fair win chance is above the break-even rate for the power play you choose. When an app's line differs from the sportsbook line, the fair chance is estimated by shifting the sharp line with a normal approximation. These rows are tagged `est.`.
- **Parlay builder**: add legs to see the combined fair hit chance, payout and expected value. It works as a sportsbook parlay or as a pick'em power play, with payout multipliers you can edit, and it warns about correlated legs.

## Run it

Open `scanner/index.html` in a browser. It starts in **demo mode**, which uses made-up teams, players and odds.

For live data:
1. Get a key from [the-odds-api.com](https://the-odds-api.com). The free tier works, but player props use credits quickly.
2. Click **⚙ Data source**, choose **Live**, paste the key, then click **Save & scan**.
3. Regions: `us` covers US sportsbooks, `us_dfs` covers pick'em apps, and `eu` includes Pinnacle. Each scan costs about `games × markets × regions` credits, so keep "Max games per sport" low.

The key is stored only in your browser's localStorage.

## Settings

| Setting | Meaning |
|---|---|
| Sharp books | Books whose two-sided prices define the fair probability (averaged). If none of them prices a line, the scanner falls back to every sportsbook that does. |
| Vig removal method | Multiplicative (default), power or additive. |
| Min EV / Min edge | Filters for the +EV and pick'em tabs. |
| ¼ Kelly | Suggested stake as a fraction of bankroll (quarter Kelly). |

## Files

- `engine.js`: odds math, vig removal, EV, Kelly, parlays, alt-line estimates and API normalisation. It has no DOM code and can be tested.
- `demo.js`: generator for the fictional demo data.
- `app.js`, `index.html`, `styles.css`: the UI.
- `test.js`: unit tests (`node scanner/test.js`).

These are estimates, not guarantees. Bet responsibly and only where it is legal.
