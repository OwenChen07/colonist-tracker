# Colonist Resource Tracker

A Chrome extension for [colonist.io](https://colonist.io) that keeps a live count of every
opponent's resource cards, read straight from the game log. It shows up as a small
draggable panel over the game.

## Install (about a minute)

1. Unzip this folder somewhere permanent (Chrome loads it from that location).
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `colonist-tracker` folder (the one containing `manifest.json`).
4. Open or refresh a colonist.io game. The panel appears once the game log is on screen.

Works in any Chromium browser (Chrome, Edge, Brave, Arc).

## What the panel shows

| Column | Meaning |
|---|---|
| Lumber, Brick, Wool, Grain, Ore | Cards in that player's hand. White = certain. **Amber `1–2`** = uncertain because of a hidden steal; hover it to see the odds of each count. |
| Σ | Total resource cards. Red when 8 or more (they will discard on a 7). |
| Dev | Development cards bought and not yet played (includes hidden victory points). |
| Can build | Road / Settlement / City / Dev card. Green = they can definitely afford it, amber outline = they might (hover for the %), grey = they can't. |

Buttons: **⟳** re-reads the whole log, **⚙** sets which player is you, hides your own row, or resets the game, and **–** collapses the panel. Drag the header to move the panel; it remembers where you put it.

## How it handles hidden steals

When one opponent robs another, the log only shows a card back. Instead of guessing, the
tracker keeps every combination of hands that is still consistent with the log, weighted by how
likely each steal was. For example, a victim with 3 ore and 1 brick lost ore 75% of the time.
Later moves rule combinations out. If the thief then builds a city, every combination where they
couldn't afford one is dropped, so the steal often resolves on its own within a turn or two.
After a Monopoly, it also uses the card counts colonist shows next to each player to settle
who lost how many.

## 1v1 games

Fully supported. With only two players every robber steal involves you, so the card is always
shown in the log and there is nothing hidden. Your opponent's hand is tracked exactly, with no
ranges. A real 537-line 1v1 game log replays through the extension with no unrecognised lines and
no inconsistencies.

## Refreshing and rejoining

- **Refresh mid-game:** progress is saved per game, and the panel picks up where it left off.
- **Installed or joined mid-game:** the log is a virtual list that only keeps visible rows in the
  page, so the extension scrolls the log from top to bottom once (a few seconds) to read the
  history, then puts the scroll position back.
- **New game in the same tab:** detected automatically, and the panel starts fresh.

## Limits

- Base game rules: 1v1, 3–4 players and 5–6 players. Cities & Knights and Seafarers aren't modelled.
- It reads colonist's log text. If colonist changes the wording, lines it can't read are
  counted as **"N unrecognised"** in the footer. Click that to see them.
- A ⚠ next to a total means the log and the board disagree (usually a missed line). Press ⟳.
- It only uses information shown publicly in the game log, which any player could count by hand.
  Check colonist.io's current rules before using it in ranked games.

## Files

```
manifest.json      MV3 manifest. Content script on colonist.io only, no permissions requested
src/parser.js      Log row → event (uses text and card image alt/src, not hashed CSS classes)
src/tracker.js     Possible-hands engine (unknown steals, monopoly, trades, builds, dev cards)
src/ui.js          The overlay panel (Shadow DOM, so it never clashes with colonist's styles)
src/content.js     Finds the log, reads each row once, backfills history, saves progress
test/              Game simulator and tests (not loaded by the extension)
```

## Running the tests (optional)

```bash
# Property test: 200 simulated 4-player games; the true hands must always be one of the tracked possibilities
cd test && npm i jsdom && node prop.test.js 200

# End-to-end: loads the real extension in Chromium against a colonist-like page
pip install playwright && python test/e2e.py
```
