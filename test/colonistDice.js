/*
 * Test reference: a line-for-line JavaScript port of colonist.io's
 * DiceControllerBalanced (TypeScript). Kept deliberately close to the
 * original so the tracker's own model (src/dice.js) can be checked against it.
 * Not loaded by the extension.
 *
 * Differences from the original, test-only:
 *   - `random` is injectable so games are reproducible.
 *   - `onWeights` is called with the final weights just before each draw.
 *   - The Cities & Knights event die is left out.
 */
(function (root) {
  'use strict';

  function randomElementFromArray(arr, random) { return arr[Math.floor(random() * arr.length)]; }
  function removeElementFromArray(arr, el) { const i = arr.indexOf(el); if (i >= 0) arr.splice(i, 1); }

  class DiceControllerBalanced {
    constructor(numberOfPlayers, opts) {
      opts = opts || {};
      this.random = opts.random || Math.random;
      this.onWeights = opts.onWeights || null;
      this.numberOfPlayers = numberOfPlayers;

      this.initWeightedDiceDeck();
      this.reshuffleWeightedDiceDeck();
      this.updateWeightedDiceDeckProbabilities();

      this.minimumCardsBeforeReshuffling = 13;
      this.probabilityReductionForRecentlyRolled = 0.34;
      this.probabilityReductionForSevenStreaks = 0.4;

      this.recentRolls = [];
      this.maximumRecentRollMemory = 5;

      this.sevenStreakCount = { playerColor: null, streakCount: 0 };
      this.totalSevensRolledByPlayer = new Map();
    }

    throwDice(playerColor) {
      this.initTotalSevens(playerColor);
      return this.drawWeightedCard(playerColor);
    }

    drawWeightedCard(playerColor) {
      if (this.cardsLeftInDeck < this.minimumCardsBeforeReshuffling) this.reshuffleWeightedDiceDeck();
      this.updateWeightedDiceDeckProbabilities();
      this.adjustWeightedDiceDeckBasedOnRecentRolls();
      this.adjustSevenProbabilityBasedOnSevens(playerColor);
      if (this.onWeights) this.onWeights(this.weightedDiceDeck.map((d) => d.probabilityWeighting), playerColor);
      return this.getWeightedDice(playerColor);
    }

    initWeightedDiceDeck() {
      this.weightedDiceDeck = [];
      for (let t = 2; t <= 12; t++) this.weightedDiceDeck.push({ totalDice: t, dicePairs: [], probabilityWeighting: 0, recentlyRolledCount: 0 });
    }

    reshuffleWeightedDiceDeck() {
      const standardDiceDeck = DiceControllerBalanced.getStandardDiceDeck();
      for (const [totalDiceIndex, dicePairsForTotalDice] of standardDiceDeck.entries()) {
        this.weightedDiceDeck[totalDiceIndex].dicePairs = dicePairsForTotalDice.dicePairs;
      }
      const totalCombinations = 36;
      this.cardsLeftInDeck = totalCombinations;
    }

    updateWeightedDiceDeckProbabilities() {
      for (const d of this.weightedDiceDeck) d.probabilityWeighting = d.dicePairs.length / this.cardsLeftInDeck;
    }

    getWeightedDice(playerColor) {
      const totalProbabilityWeight = this.getTotalProbabilityWeight();
      let targetRandomNumber = this.random() * totalProbabilityWeight;
      for (const d of this.weightedDiceDeck) {
        if (targetRandomNumber <= d.probabilityWeighting) {
          const drawnCard = randomElementFromArray(d.dicePairs, this.random);
          removeElementFromArray(d.dicePairs, drawnCard);

          this.recentRolls.push(d.totalDice);
          d.recentlyRolledCount += 1;
          this.cardsLeftInDeck -= 1;

          if (this.recentRolls.length > this.maximumRecentRollMemory) this.updateRecentlyRolled();
          if (d.totalDice == 7) this.updateSevenRolls(playerColor);
          return drawnCard;
        }
        targetRandomNumber -= d.probabilityWeighting;
      }
      throw new Error('Something seriously wrong with weighted dice deck');
    }

    getTotalProbabilityWeight() {
      let total = 0;
      for (const d of this.weightedDiceDeck) total += d.probabilityWeighting;
      return total;
    }

    updateRecentlyRolled() {
      const ignore0and1 = 2;
      const totalDiceFiveRollsAgo = this.recentRolls[0];
      this.weightedDiceDeck[totalDiceFiveRollsAgo - ignore0and1].recentlyRolledCount -= 1;
      this.recentRolls.shift();
    }

    adjustWeightedDiceDeckBasedOnRecentRolls() {
      for (const d of this.weightedDiceDeck) {
        const probabilityReduction = d.recentlyRolledCount * this.probabilityReductionForRecentlyRolled;
        const probabilityMultiplier = 1 - probabilityReduction;
        d.probabilityWeighting *= probabilityMultiplier;
        if (d.probabilityWeighting < 0) d.probabilityWeighting = 0;
      }
    }

    initTotalSevens(playerColor) {
      if (this.totalSevensRolledByPlayer.get(playerColor) != undefined) return;
      this.totalSevensRolledByPlayer.set(playerColor, 0);
    }

    updateSevenRolls(playerColor) {
      const sevensRolledByPlayer = this.totalSevensRolledByPlayer.get(playerColor) ?? 0;
      this.totalSevensRolledByPlayer.set(playerColor, sevensRolledByPlayer + 1);
      if (playerColor == this.sevenStreakCount.playerColor) {
        this.sevenStreakCount.streakCount += 1;
        return;
      }
      this.sevenStreakCount.playerColor = playerColor;
      this.sevenStreakCount.streakCount = 1;
    }

    adjustSevenProbabilityBasedOnSevens(playerColor) {
      if (this.numberOfPlayers < 2) return;
      const streakAdjustmentPercentage = this.getStreakAdjustmentConstant(playerColor);
      const playerSevensAdjustmentPercentage = this.getSevenImbalanceAdjustment(playerColor);
      let sevenProbabilityAdjustment = 1 * playerSevensAdjustmentPercentage + streakAdjustmentPercentage;
      const minimumAdjustment = 0;
      const maximumAdjustment = 2;
      if (sevenProbabilityAdjustment < minimumAdjustment) sevenProbabilityAdjustment = minimumAdjustment;
      if (sevenProbabilityAdjustment > maximumAdjustment) sevenProbabilityAdjustment = maximumAdjustment;
      const ignore0and1 = 2;
      const sevenIndex = 7 - ignore0and1;
      this.weightedDiceDeck[sevenIndex].probabilityWeighting *= sevenProbabilityAdjustment;
    }

    getStreakAdjustmentConstant(player) {
      const isStreakForOrAgainstPlayer = this.sevenStreakCount.playerColor == player ? -1 : 1;
      return this.probabilityReductionForSevenStreaks * this.sevenStreakCount.streakCount * isStreakForOrAgainstPlayer;
    }

    getSevenImbalanceAdjustment(playerColor) {
      const totalSevens = this.getTotalSevensRolled();
      if (totalSevens < this.totalSevensRolledByPlayer.size) return 1;
      const sevensPerPlayer = this.totalSevensRolledByPlayer.get(playerColor) ?? 0;
      const percentageOfTotalSevens = sevensPerPlayer / totalSevens;
      const idealPercentageOfTotalSevens = 1 / this.totalSevensRolledByPlayer.size;
      return 1 + ((idealPercentageOfTotalSevens - percentageOfTotalSevens) / idealPercentageOfTotalSevens);
    }

    getTotalSevensRolled() {
      let total = 0;
      for (const v of this.totalSevensRolledByPlayer.values()) total += v;
      return total;
    }

    static getStandardDiceDeck() {
      const deck = [];
      for (let t = 2; t <= 12; t++) {
        const pairs = [];
        for (let a = 1; a <= 6; a++) { const b = t - a; if (b >= 1 && b <= 6) pairs.push({ dice1: a, dice2: b }); }
        deck.push({ totalDice: t, dicePairs: pairs });
      }
      return deck;
    }
  }

  root.ColonistDice = { DiceControllerBalanced };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ColonistDice;
})(typeof globalThis !== 'undefined' ? globalThis : this);
