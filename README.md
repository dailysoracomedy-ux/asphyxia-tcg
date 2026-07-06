# ASPHYXIA v0.2.1 — Local Hotseat Prototype

A fully playable local 2-player prototype of the ASPHYXIA trading card game, built with
Next.js, TypeScript, Tailwind CSS, and Zustand. No blockchain, no accounts, no network
play — just a rules engine and a board.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Two players share one browser tab/window (hotseat).

## What's implemented

- Full turn structure: Start / Main / Combat / End phases with explicit phase buttons
- All 3 starter decks (Neon Underground, Dark White, Synth Ascendancy), 30 cards each,
  every card from the v0.2.1 spec with its actual rules text and effects
- Sync economy (Supports → Sync, capped at 3, spent per-attack)
- DEF/damage math, overflow → O2 conversion, direct-attack O2 cap (2/turn)
- Momentum, Reactions, Negates, and a queued "Available Responses" system so both
  players get real response windows (declare attack → opponent may Glitch Step /
  Emergency Authority / Backup Consciousness / Negate before it resolves)
- All 6 Rift Spaces with their actual trigger conditions
- Choke / Upgrade / Glitch counters, Equip attach/detach/discard-on-destroy
- Reconfigure (once per turn), Ability Support chaining/unchaining,
  the 2-Ability-Support limit, Control Conflict locking
- Mulligan-until-Apex opening hands, 0-Sync-damage first-player determination,
  first-turn attack restriction, and the "no empty Apex" emergency draw rule
- A full game log and a cyberpunk-themed board (placeholder cards, faction color coding)

## Structure

```
src/types/game.ts        - all shared types (cards, instances, game state)
src/data/cards*.ts        - the 3 starter decks' full card definitions + effects
src/data/decks.ts         - deck/instance construction, shuffling
src/game/rules.ts         - damage/DEF/O2/Sync math + the mutation-side engine
src/game/rifts.ts         - Rift Space determination + descriptions
src/store/gameStore.ts    - the Zustand store: the actual rules engine/orchestration
src/components/*          - the board UI
src/scripts/simulate.ts   - a headless randomized-playthrough test harness
```

## Verifying it yourself

`npx tsx src/scripts/simulate.ts` runs 72 full randomized games across every faction
matchup (so every Rift Space gets exercised), driving the real store end-to-end
including reactions, negates, reconfigure, and rift triggers, and asserts card
conservation + sane O2/Momentum/counter values throughout. It should print
`Games run: 72, crashed: 0` with no errors.

## Known simplifications (documented in code with TODO/NOTE comments)

A few of the spec's more elaborate interactive prompts were implemented in the
"cleanest practical way" per the brief rather than as full manual pickers, since they're
narrow edge cases:

- **Verdict Protocol** always applies its "-300 DEF until end of turn" mode rather than
  offering the full 3-way choice (attack-lock / DEF debuff / your-next-attack-bonus).
- **Emergency Shell**'s discard trigger and **Overseer Prime**'s enter-play trigger
  auto-target the first available Apex rather than opening a manual picker.
- **Recursive Failure**'s optional end-of-turn Glitch Counter removal is auto-applied
  (to the Apex holding the most Glitch Counters) when the condition is met, rather than
  asking who/which.
- Negates can cancel Specials and Equips (full interactive window); cancelling a
  Reaction-in-response-to-a-Reaction is not implemented (no true effect "stack" — this
  matches the brief's "do not build a full stack system yet unless easy").

Everything else — all attacks, traits, Sync Abilities, Rift triggers, counters, the
response system for Reactions/Negates on Specials and Equips, and the full turn/combat
pipeline — is implemented per the spec.
