// Checks the tracker's dice model (src/dice.js) against a line-for-line port
// of colonist's DiceControllerBalanced (test/colonistDice.js).
//
//   node test/dice.test.js [games]
//
// 1. Exactness: before every roll, the odds the tracker predicts must equal
//    the weights colonist's controller uses for that draw.
// 2. Detection: games with ordinary random dice must get flagged as such.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { DiceModel } = require(path.join(ROOT, 'src/dice.js'));
const { DiceControllerBalanced } = require(path.join(ROOT, 'test/colonistDice.js'));

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const GAMES = +process.argv[2] || 2000;
let worst = 0, draws = 0, failures = 0, flagged = 0, nextWrong = 0;
const sevensSeen = { blocked: 0 }; // how often a roller's 7 was impossible (×0)

for (let g = 1; g <= GAMES; g++) {
  const random = rng(g * 7919);
  const nPlayers = 2 + (g % 5); // 2..6 players
  const players = Array.from({ length: nPlayers }, (_, i) => 'P' + i);
  let colonistWeights = null;
  const ctrl = new DiceControllerBalanced(nPlayers, { random, onWeights: (w) => { colonistWeights = w; } });
  const model = new DiceModel();
  players.forEach((p) => model.notePlacement(p));
  const rolls = 40 + (g % 120);
  for (let r = 0; r < rolls; r++) {
    const p = players[r % nPlayers];
    if (model.nextRoller() !== p) nextWrong++;
    const predicted = model.predict(p);
    const pair = ctrl.throwDice(p);
    const sum = colonistWeights.reduce((a, b) => a + b, 0);
    const actual = colonistWeights.map((x) => x / sum);
    if (actual[5] === 0) sevensSeen.blocked++;
    let diff = 0;
    for (let i = 0; i < 11; i++) diff = Math.max(diff, Math.abs(predicted[i] - actual[i]));
    worst = Math.max(worst, diff);
    if (diff > 1e-9) {
      failures++;
      if (failures <= 3) console.log('MISMATCH game', g, 'roll', r + 1, { predicted, actual });
    }
    model.observe(p, pair.dice1, pair.dice2);
    draws++;
  }
  if (model.mode !== 'balanced') {
    flagged++;
    if (flagged <= 3) console.log('FALSELY FLAGGED game', g, model.brokenAt);
  }
}
console.log(`exactness: ${GAMES} balanced games, ${draws} rolls, largest odds difference ${worst.toExponential(2)}, mismatches ${failures}, wrongly flagged as random ${flagged}, next-roller mistakes ${nextWrong}`);
console.log(`  (a 7 was impossible for the roller on ${(100 * sevensSeen.blocked / draws).toFixed(1)}% of rolls)`);

// Random dice: how fast is the game recognised as not-balanced?
const detectedAt = [];
let never = 0;
for (let g = 1; g <= GAMES; g++) {
  const random = rng(g * 104729 + 1);
  const nPlayers = 2 + (g % 5);
  const model = new DiceModel();
  for (let r = 0; r < 120 && model.mode === 'balanced'; r++) {
    model.observe('P' + (r % nPlayers), 1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6));
  }
  if (model.mode === 'random') detectedAt.push(model.brokenAt.roll);
  else never++;
}
detectedAt.sort((a, b) => a - b);
const q = (f) => detectedAt[Math.floor(f * (detectedAt.length - 1))];
console.log(`detection: random-dice games flagged ${detectedAt.length}/${GAMES} within 120 rolls; median at roll ${q(0.5)}, 90% by roll ${q(0.9)}, never ${never}`);

const ok = failures === 0 && flagged === 0 && nextWrong === 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
