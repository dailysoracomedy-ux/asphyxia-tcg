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
- **An internal Engine Tag System for response-window eligibility.** Rather than
  hardcoding "is this card a Reaction/Negate that matches this event" by name or
  type, every card can carry `tags: EngineTag[]` (`INSTANT`, `REACTION`, `NEGATE`,
  `ON_ATTACK_DECLARED`, `ON_SPECIAL_PLAYED`, `ON_EQUIP_PLAYED`, `ON_REACTION_PLAYED`,
  `ON_O2_DAMAGE`, `ON_APEX_WOULD_BE_DESTROYED`). Only the 6 actual instant-speed
  cards (Glitch Step, Feedback Loop, Emergency Authority, Absolute Refusal, Backup
  Consciousness, Logic Denial) carry `INSTANT` - Specials and Equips never do, so
  they're never playable at instant speed themselves (Negates can still respond
  *to* them). `getEligibleResponses(state, respondingPlayerId, event)` in
  `src/game/rules.ts` is the single source of truth every eligibility check calls
  through - the attack/Special/Equip/destroy/O2-loss code paths, the UI, and the
  headless simulator all ask the same function the same question, so there's no
  way for "hardcoded by name" logic to drift out of sync in one place but not
  another. A Negate can now even respond to a Reaction being played
  (`ON_REACTION_PLAYED`) as one additional single-layer response opportunity -
  still no full effect stack, just one well-defined extra step.
- **Hotseat privacy screens for response windows.** A Response Window (and the
  "pass the screen" privacy step around it) only opens when the non-active player
  actually has at least one legal instant-speed card (per the tag system above) -
  otherwise the action just resolves immediately with no pause. When a window does
  open: the board is fully hidden behind an opaque "Pass the screen to Player X"
  screen, then the responder's eligible Reactions/Negates and the triggering event
  are shown, then another "Pass the screen back to Player Y" screen before control
  returns. The log records each step precisely ("Checked for eligible responses:
  none found.", "Response window opened: player2 has 1 eligible response.",
  "player2 passed." / "player2 played Emergency Authority.", "Original action
  resolved.").
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

## Pacing/cleanup patch (playtest fixes)

- **1 Special per player turn.** A second Special attempt is blocked outright - the
  card stays in hand, nothing is discarded, no effect resolves, no resources spent.
- **1 Support per player turn** (Ability or Battery). Reconfigure's "play a card into
  the vacated slot" step draws from this same budget - if you already played a Support
  normally, Reconfigure can still *return* a card but can't play one in, and vice versa.
- **1 INSTANT-tagged card per player turn** (Reactions/Negates), tracked per player
  regardless of whose turn it is, resetting at the start of *that player's own* next
  turn. `getEligibleResponses` excludes a player's instants entirely once they've used
  one, so a Response Window simply won't open for a second instant that turn.
- **Ability Support same-Apex chaining is enforced everywhere** it's played from
  (normal play and Reconfigure) - an Apex that already has one chained is neither a
  valid target in the UI nor clickable, and the engine rejects it as a backstop.
- **No-Apex Recovery Rule**, checked at the start of every Main Phase: force-play an
  Apex from hand → reveal the deck until one turns up (rest reshuffled in) → if the
  deck runs dry, shuffle the discard pile in and keep searching → if there's truly no
  Apex anywhere, that player loses immediately (a safety valve against a permanent
  no-board deadlock).
- **O2 is capped at 6.** Any gain that would push a player over 6 just logs "already
  at max O2" instead.
- **Game-over screen now shows winner/loser/reason/final O2 & Momentum**, plus
  "View Full Game Log", "Copy Game Log" (clipboard, falling back to a selectable
  textarea if clipboard access isn't available), and "Start New Game". The log is
  never cleared on game end - only a fresh `startNewGame` clears it.
- **The noisy "Checked for eligible responses: none found." trace is gated behind a
  debug-mode checkbox** in the top bar (off by default) so normal play only shows
  meaningful response-window lines ("Response window opened for player2.", "player2
  played Glitch Step.", "player2 passed.", "Action resolved.").
- Hand cards that can't legally be played this turn (Special/Support limit already
  used) are visually disabled, not just silently rejected on click.

## Apex Break Reward + scroll-position fix

- **Apex Break Reward.** When an attack destroys an enemy Apex and that same attack
  dealt exactly 0 O2 damage (no overflow got through), the attacker gains +1 Momentum.
  Implemented at the single terminal point of the attack-resolution pipeline
  (`finalizeAttackEffects`), which is only ever reached via the real combat flow - so it
  automatically excludes direct attacks (no target = no reward), prevented destructions
  (Backup Consciousness), and any non-attack destruction effect (they never route
  through that function). Overflow O2 damage - even if later reduced to 0 by a
  Reaction like Emergency Authority - still counts as "O2 damage was dealt" for this
  rule, since the check runs after all reactions have resolved and uses the actual
  final O2-loss outcome.
- **Phase-button scroll-to-top, root cause found and fixed.** No `<form>` elements and
  no remounting `key` were involved - the actual cause was the classic React/browser
  gotcha where a *focused* button becoming `disabled` on the very next render forces
  the browser to yank focus away (usually to `<body>`), which triggers a native
  scroll-to-top. The Start/Main/Combat/End Turn buttons all disable themselves the
  instant their own click updates the phase. Fixed by calling `.blur()` on the button
  *before* the state update runs, so focus has already moved away gracefully by the
  time the button becomes disabled or unmounts. Also added a scroll-position
  snapshot/restore backstop (`requestAnimationFrame` + `window.scrollTo`) as defense in
  depth, and every `<button>` in the app now has an explicit `type="button"`.

## O2 rebalance (finer granularity)

Per direct request: **100 damage = 1 O2 loss** (was 200), and the O2 pool is now
**12** (was 6) for both starting and max O2. This is a pure resolution increase, not
a power-level change - the overall damage-to-kill budget is identical either way
(6 × 200 = 1200 = 12 × 100), so a 100-overflow hit that used to silently round down to
0 O2 lost now correctly costs 1 O2. The direct-attack cap was scaled proportionally
too, from 2/turn to 4/turn, so direct attacks keep the same effective 400-damage/turn
ceiling instead of being quietly nerfed by the finer granularity. The in-game "low O2"
warning color threshold was scaled the same way (2→4, same 1/3-of-pool fraction).
Every one of these lives in a single set of constants in `src/game/rules.ts`
(`OVERFLOW_O2_DIVISOR`, `DIRECT_O2_DIVISOR`, `DIRECT_O2_CAP_PER_TURN`, `STARTING_O2`,
`MAX_O2`) - nothing else hardcodes these numbers.

**Card-specific O2 thresholds have now been rescaled too** (per follow-up request),
preserving each card's original fraction of the pool:
- Last Breath Rush, No Gods in the Gutters, Emergency Authority, Backup Consciousness:
  "O2 is 2 or lower" (2/6 = 33%) → **"O2 is 4 or lower"** (4/12 = 33%)
- Echo Riot rift: "3 or less" (3/6 = 50%) → **"6 or less"** (6/12 = 50%)

Relative comparisons - Riot Runner's passive ("if your O2 is lower than your
opponent's") and the Civil War rift - were correctly left untouched, since they don't
depend on the pool size at all. Both the game logic *and* the displayed card rules
text were updated together so the UI stays accurate. New regression test:
`npx tsx src/scripts/test-o2-threshold-rescale.ts` (9 checks) locks in the exact new
boundary for four of the five rescaled thresholds - triggering at the new value,
not triggering one point above it.

**Follow-up playtest report ("still behaving like the old 6 O2 / 200 damage
system"):** directly verified against this exact code with fresh scripted scenarios
matching the report - 600 damage into 400 DEF correctly loses 2 O2, 400 into 300 DEF
correctly loses 1 O2, and a fresh game correctly starts at 12 O2. All three already
matched the reported *expected* behavior, meaning the deployment being tested predates
this rebalance (same root cause as the earlier "2 Supports per turn" report - the fix
was in the code but not yet the live deployment). **Redeploy this zip to fix it.**

That said, this report did surface one genuine remaining bug while checking the exact
math: Apex Break Reward was checking the *final, post-reduction* O2 loss to decide
whether to fire, so if Emergency Authority absorbed an overflow's O2 loss all the way
to 0, the reward incorrectly fired anyway (overflow genuinely happened; a Reaction
just prevented its cost afterward - not a clean break). Fixed by tracking the
mechanical fact that overflow occurred separately from the final applied loss, and
the log now explicitly says *"Apex Break Reward does not trigger - overflow damage
was prevented by a Reaction"* in that case, rather than silently doing nothing or
misfiring. Two new tests in `test-apex-break-reward.ts` lock this in, including the
exact scenario from the report (Riot Runner's Mob Charge into Pale Executioner: 400
damage vs 300 DEF → destroyed, 100 overflow, exactly 1 O2 lost, no reward).

## Quick polish patch: attack preview, chain indicators, Momentum cap

- **The Combat Phase attack selector now shows real modified damage, not just the
  printed base number.** Each attack option shows the final expected damage plus a
  compact modifier breakdown (e.g. `+200 armed bonus`, `+100 Plasma Edge`, `-100
  Choke Counter penalty`), color-coded green/red. Built via a new
  `getPreviewAttackDamage(state, attackerInstanceId, attackId, targetInstanceId?)` in
  `src/game/rules.ts`, and - per the request - `declareAttack` itself was refactored
  to call this *same* helper rather than keep a separate parallel calculation, so the
  preview and the actual resolved damage can never drift apart (short of an opponent
  Reaction like Glitch Step modifying it afterward, which is expected and unavoidable
  since it happens after the attack is declared).
  - This also surfaced a genuine gap from the original card-pool spec: Choke Counters
    were only ever checked as a *condition* by other cards, but the actual "-100
    damage while choked" self-penalty (explicitly defined in the original counters
    spec) had never been wired into damage resolution at all. It's implemented now,
    consistently in both the preview and real combat.
- **Chained Ability Support ↔ Apex indicators.** Support cards show `Chain -> {Apex
  name}` or `Unchained`; Apex cards show `Chained Support: {Support name}` when one is
  chained to them. Battery Supports show nothing (they're never chained). Built as two
  small pure functions (`getChainedSupportFor`, `getChainLabelForSupport` in
  `rules.ts`) instead of inline JSX logic, specifically so they're independently
  testable and reused by both card types rather than duplicated.
- **Momentum is now capped at 3**, enforced in the single existing `gainMomentumFn`
  helper that every Momentum gain already routed through (Civil War, Apex Break
  Reward, card/Support effects, Reconfigure payouts, Rift effects) - so the cap
  applies everywhere at once with no new call sites to keep in sync. Logs distinguish
  a normal gain, a gain that got capped mid-way (`"gains 1 Momentum (now 3). Momentum
  capped at 3."`), and a no-op at max (`"is already at max Momentum."`). Spending
  Momentum is untouched and still works normally down to 0.

## Centralized damage calculation patch (a real bug found along the way)

**The most important fix in this patch was found while implementing it, not asked for
directly.** Every Ability Support's Sync Ability (Juice-Box, Spark-Plug, Gatekeeper
Drone, Logic Bloom, Drone Choir - 5 of the 6 Ability Supports in the game) was being
called with the wrong instance ID: `chainedApexId: support.instanceId` passed the
*Support's own* card ID instead of the Apex it's chained to. Every one of those five
cards' effects (`ctx.helpers.armAttackBonus(ctx.chainedApexId, ...)`,
`markPendingEndPhaseBuff`, `markPendingEndPhaseProtection`) looks up an Apex by that ID
- since a Support's ID never matches anything in `apexSlots`, the lookup silently
failed every time. The log line ("Spark-Plug arms +200 damage...") fires *before* the
broken call, so it looked like it worked while doing nothing at all - exactly the
symptom reported. One-line fix in `gameStore.ts`: pass `trigger.attackerInstanceId`
(the actual chained Apex) instead. This existed since the original build and was
never caught before because every earlier armed-bonus test set `apex.armedBonus`
directly rather than actually triggering the Sync Ability through a real attack.

**Choke Counter penalty was also flat instead of scaling.** Commit 8 added Choke
Counters as a damage penalty for the first time (a real gap from the original spec),
but implemented it as a flat -100 regardless of stack size. This patch's explicit
clarification (0/1/2/3 CHK = 0/-100/-200/-300) made the intended per-counter scaling
unambiguous, so it's fixed to `-100 * chokeCount`, with the modifier breakdown now
labeled `"Choke Counter x3"` instead of a generic penalty.

**One central helper, used everywhere, per the request.** `getPreviewAttackDamage`
(added in Commit 8) is now the *only* place attack damage math happens - the board
card display (`Card.tsx`, via a new per-attack `attackPreviews` map built in
`PlayerBoard.tsx`) and `declareAttack`'s actual combat resolution both call it
directly, and the older, incomplete `getApexAttackBonusPreview` (which applied one
flat number to every attack line and didn't know about Choke or each attack's own
conditional bonus) was retired entirely rather than left as a second, drifting
implementation.

**New: target/outcome preview** (`getAttackOutcomePreview`), shown once an attack is
chosen and while picking a target - final damage, target's current DEF, whether it
would be destroyed, expected overflow, expected O2 loss, and whether Apex Break
Reward would trigger. Purely informational; no attack is ever disabled for being
"weak," only for genuine illegality (Sync, already attacked, no valid target, etc.).

Board card attack numbers now show `base → current` (e.g. `600 → 500`) whenever
modified, colored green/red, with the same modifier breakdown shown in the selector
and the combat log - all three read from the identical calculation.

## Verifying it yourself

`npx tsx src/scripts/test-combat-damage-patch.ts` is a targeted test suite (36 checks)
covering this patch, most importantly the Ability Support `chainedApexId` bug fix
verified through the *real* Sync Ability invocation path (unlike earlier tests that
set `armedBonus` directly and so never actually exercised the broken code): the bonus
doesn't apply to the same attack that armed it, correctly applies on the chained
Apex's next attack after a real turn-cycle, is consumed and correctly re-armed by
further attacks, never applies to the wrong Apex, and is handled safely if the Apex
leaves play. Also covers the corrected per-counter Choke scaling (3 CHK on a 600
attack → 300, matching the exact request example), Equip+Choke stacking, the damage
floor at 0, failed attacks not punishing the attacker, and all 4 outcome-preview
scenarios (no break / exact break with reward / overflow / no reward when O2 is dealt).

`npx tsx src/scripts/test-preview-chains-momentum.ts` is a targeted test suite (19
checks) for this patch: the attack selector preview matching armed bonuses, Equip
bonuses, and Choke Counter penalties; the preview matching actual resolved damage;
both directions of the chain indicator (Support→Apex and Apex→Support); Battery
Supports showing no chain info; unchained Supports showing "Unchained"; and the
Momentum cap holding at 3 from Civil War, Apex Break Reward, and direct card-effect
gains, while spending still works normally afterward.

`npx tsx src/scripts/test-apex-break-reward.ts` is a targeted test suite (33 checks)
for the 6 original required scenarios (exact-lethal grants the reward, overflow O2
damage denies it, non-lethal damage denies it, Backup Consciousness prevention denies
it, direct attacks never trigger it, non-attack destruction never triggers it) plus 2
follow-up scenarios: Emergency Authority absorbing overflow's O2 loss to exactly 0
still denies the reward, and the exact reported scenario (Riot Runner's Mob Charge
into Pale Executioner - 400 into 300 DEF, destroyed, 100 overflow, exactly 1 O2 lost,
no reward).

`npx tsx src/scripts/simulate.ts` runs 72 full randomized games across every faction
matchup (so every Rift Space gets exercised), driving the real store end-to-end
including reactions, negates, reconfigure, and rift triggers, and asserts card
conservation, sane O2/Momentum/counter values, the O2 cap, and the new 1-per-turn
Special/Support/Instant limits at every single turn (not just game-end). It should
print `Games run: 72, crashed: 0` with no errors. It resolves response windows using
the same `getEligibleResponses` helper the real engine uses, so it can't "cheat" by
playing a card that wouldn't actually be legal.

`npx tsx src/scripts/test-response-eligibility.ts` is a targeted test suite for the
Engine Tag System covering the 9 scenarios it needs to get right: no pass screen
when nobody has an eligible instant, a window opening for each of the 6 instant
cards in its correct situation, no window when Momentum is short, and confirming
Specials/Equips can never be played as the non-active player.

`npx tsx src/scripts/test-turn-limits.ts` is a targeted test suite (39 checks) for
this pacing patch: the Special/Support/Instant 1-per-turn limits (including that a
blocked card stays in hand unresolved), Reconfigure sharing the Support budget in
both directions, Ability Support same-Apex chain prevention, all four steps of the
No-Apex Recovery Rule (hand → deck → discard → loss), the O2 cap, and game-log
persistence after game-over.

`npx tsx src/scripts/test-overflow-fix.ts` is a small regression test locking in the
overflow → O2 conversion math (`floor(overflow / 200)`, direct-attack cap at 2/turn).

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
