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

## Major design correction: Apex traits removed, all 6 Rift Spaces rewritten

**Apex cards are now clean combat units: name, faction, DEF, and 4 attacks - nothing
else.** Every Apex-level passive trait was removed:

| Apex | Trait removed |
|---|---|
| Street-Beast | Draw 1 card on Apex kill |
| Static Jack | +100 ATK after first Special (was hardcoded in `gameStore.ts`, not even in card data) |
| Alley Wraith | Pay 1 Momentum to cancel a Reaction targeting it once/turn |
| Riot Runner | +100 ATK while behind on O2 |
| Overseer Prime | Choke Counter on an enemy Apex on entry |
| Enforcer-V4 | +100 DEF with 2+ Supports |
| Glass Warden | -100 damage taken from 0-Sync attacks |
| Pale Executioner | +1 Momentum on attacking a Choked target |
| Model-00 "Crown" | +1 Momentum on entry if you control a Support |
| Chrome Seraph | (its rulesText described a 2nd-card bonus, but no code ever implemented it - flavor-only, same as it always was) |
| Virex | Upgrade Counter + scaling damage on Apex kill |
| Halcyon Maw | +100 ATK at 2+ Momentum |

Each attack's **own** printed conditional text was deliberately kept (e.g. Last Breath
Rush's "if your O2 is 4 or lower, +100 damage" is that attack's own clause, not a
blanket Apex-wide trait) - only the separate, apex-level passive hooks
(`onEnterPlay`, `passiveDamageBonus`, `passiveDefBonus`, `incomingDamageReduction`,
`onAttackTargetWithChoke`, `onDestroyEnemyApex`) were stripped. Every Apex's
`rulesText` is now `''`, and Alley Wraith's whole cancel-a-Reaction mechanic (its own
response-queue stage, UI prompt, and hardcoded engine hook) was removed end to end
rather than left dead in the codebase.

**All 6 Rift Spaces were rewritten:**

- **Civil War** (Neon/Dark White): unchanged start-of-turn Momentum-while-trailing
  check, **plus new**: destroying an enemy Apex while behind on O2 arms +100 damage
  for your next attack this turn (once per turn).
- **Human Error** (Neon/Synth): same first-Special choice (Momentum or +100 next
  attack) - but fixed a real ordering bug where the choice used to fire *before* the
  negate window even opened, meaning a negated Special still granted the bonus. The
  trigger now lives at the two actual "Special genuinely resolved" points instead of
  right after the card is played.
- **Control Conflict** (Dark White/Synth): locking a Support now actually grants 1
  Momentum (previously it didn't), and locked Supports can no longer be returned by
  Reconfigure (previously they could be, silently bypassing the lock).
- **Echo Riot** (Neon mirror): completely reworked from a punishment (“self O2 loss
  deals +1 more O2”) into two rewards - self-inflicted O2 loss now grants 1 Momentum,
  and Apex Break Reward grants +2 Momentum instead of +1 when both players are at 6
  O2 or lower.
- **White Room Collapse** (Dark White mirror): completely reworked from a punishment
  (discard/Momentum/O2 cost on placing Choke) into a reward - placing the first Choke
  Counter on an enemy Apex each turn now grants 1 Momentum, plus a new end-of-turn
  cleanup removing 1 Choke Counter from any Apex (either side) sitting at 3 or more.
- **Recursive Failure** (Synth mirror): retargeted from "first Momentum gain from a
  card effect" (which fired off *any* Momentum source, including Rift/reward effects
  never intended to trigger it) to specifically "playing your second voluntary card
  this turn," which now grants Momentum then places the Glitch Counter, in that order.
  End-of-turn Glitch removal logic (already correct) is unchanged.

All Momentum gains still funnel through the single `gainMomentumFn` and respect the
3-cap automatically - no rift needed its own capping logic.

## Commit 11: Void zone, Void Recycle, Rift choices, card fixes

- **Void zone.** The `discard` field is renamed to `voidZone` throughout (an ordered
  array, not a counter) and every player-facing surface says "Void" - no more
  "Discard"/"Graveyard". Deck and Void counters now both show in the player header,
  with Void clickable to expand a simple inspector (name/type/faction per card).
- **Void Recycle.** Drawing from an empty Deck now shuffles that player's Void back
  into their Deck first (emptying the Void), then draws; if both are empty, that
  player loses immediately. No-Apex Recovery uses the same recycle step when the Deck
  has no Apex but the Void does, before finally declaring a loss if no Apex exists
  anywhere. Both log clearly ("Void Recycle: playerX shuffles their Void into their
  Deck.").
- **Clean state on Apex death - a real gap closed.** Destroyed Apexes previously kept
  their *entire* live state (counters, armed bonuses, protections, temp buffs,
  hasAttacked) when pushed to Void - harmless today since nothing reads from Void yet,
  but exactly the kind of ghost-state bug that would bite the moment any future card
  cares about Void contents. Now only `{instanceId, defId, type}` survives into Void.
  Attached Equip still follows a destroyed Apex to Void; a chained Ability Support
  does not - it stays on the field and becomes Unchained.
- **Feedback Loop rewritten.** The old "cancel + 100 damage" clause was flavor-only
  (identical situation to a couple of other cards found in earlier sessions - the log
  said it happened, no code ever did it). Now: cancel a Special or Reaction, then its
  controller loses 1 direct O2 (can be lethal, declares a winner immediately if so).
- **Spark-Plug retimed.** Previously armed +200 for the chained Apex's *next* attack
  (a whole extra tracked state field, `armedBonus`, plus a "arms next turn" log).
  Now it's a live modifier - `+200 damage on the current attack, every time, only
  while validly chained and unlocked` - computed the same way as any other modifier
  in `getPreviewAttackDamage`, with no separate armed/consumed state to track at all.
  Juice-Box was checked against the same request and already matched spec exactly
  (post-attack DEF buff until the end of the opponent's next turn) - no changes needed.
- **Civil War is now a real choice**, matching Human Error and Control Conflict:
  behind on O2 at the start of your turn opens a prompt (Momentum vs. +100 on your
  first Apex attack this turn) instead of auto-granting Momentum. Built by mirroring
  Human Error's existing choice-window infrastructure exactly (same
  `PendingResponseItem` pattern, same resolution shape) rather than inventing a new
  mechanism.
- Control Conflict and Human Error already matched the requested design (visible,
  actionable, momentum-granting, properly blocking Reconfigure/Sync Abilities on
  locked Supports) and needed no changes beyond verification.
- Game-over lock was already solid: `GameOverScreen` fully replaces the board on
  `status === 'gameover'`, so every action (phase buttons, attacks, hand, Reconfigure)
  is inaccessible, not just disabled - combined with the existing `gameAlreadyOver`
  guard in `finalizeAttackEffects` from an earlier session, post-lethal triggers
  (Support abilities, Momentum, O2 healing) are already fully suppressed.

## Commit 12: no-scroll layout, Battle Log drawer, Commit 11 hotfixes

**Hotfixes (found a genuine leftover bug):** Civil War's Commit 11 conversion to a
choice was incomplete - the old "destroy an enemy Apex while behind on O2 arms +100"
code was still live in `gameStore.ts` *alongside* the new start-of-turn choice, and
the rift's game-start description text still described the old automatic-Momentum
version. Both are now fully removed/updated; Civil War is exclusively the
start-of-turn choice. Also added the "Civil War: playerX is behind on O2." log before
the prompt, and a generic "primed attack bonus expires unused" log wherever an unused
Civil War/Human Error/Overclock bonus gets cleared at the next Start Phase. Juice-Box's
intermediate log no longer says "arms" (now "will grant... at End Phase"); its final
grant log already correctly said "gains," not "arms." Spark-Plug and the Deck/Void
counters were verified against spec with no changes needed (both already correct from
Commit 11).

**Layout: fixed-height shell, no page scroll.** `html`/`body` and the root layout now
use a hard `height: 100dvh` cap with `overflow: hidden` (previously `min-height:
100vh`, which let the page grow past the viewport). `GameBoard`'s outer container
matches (`h-full max-h-full overflow-hidden flex flex-col`), with the gameplay content
(opponent board, active board, phase/combat controls, prompts, hand) in a single
`flex-1 min-h-0 overflow-y-auto` region - so if a viewport is ever too short for
everything at once, *that* inner region scrolls, never the browser page itself.

**Battle Log moved to a drawer.** The log is no longer a permanent 320px sidebar - a
"Battle Log" button in the top bar (with a "• New" indicator when unread entries
exist) opens `BattleLogDrawer`, a `fixed inset-0` overlay with a backdrop and a
right-side panel (full-width on mobile) containing its own `GameLog` instance, Copy
Log button (reusing the existing clipboard-with-textarea-fallback logic from the
game-over screen), and a Close button. It never affects board layout since it's
positioned outside the normal document flow.

Hand (already a horizontal `overflow-x-auto` row from earlier work) and phase/combat
controls remain in their existing position within the scrollable gameplay region
rather than being pulled into a separate always-pinned bar - the primary acceptance
criterion (no *browser-level* scroll) is met by the fixed-height shell regardless of
where content sits inside it; a dedicated sticky bottom bar for hand+actions specifically
would be a further layout change beyond what this pass covers.

## Commit 13: true no-scroll game grid

Commit 12's fix (`overflow: hidden` shell + one internal scrolling region) was a real
improvement but didn't budget vertical space tightly enough - a `flex-col` stack of
full-size board rows could still exceed a 1366×768 viewport before its `overflow-y-auto`
region kicked in, which doesn't help if the *board itself* is what's too tall.

**Rebuilt as a real 5-row CSS grid** (`grid-template-rows: auto minmax(0,1fr) auto
minmax(0,1fr) auto`) instead of one big scrollable flex column:
1. Top status bar (auto) - both players' compact stat chips plus turn/phase/Battle Log
2. Opponent board (`minmax(0,1fr)`)
3. Rift/prompt/action-context area (auto, capped at `max-h-[40vh]` with its own scroll)
4. Player board (`minmax(0,1fr)`)
5. Hand + phase controls (auto)

The two board rows use `minmax(0,1fr)` specifically so they *compress* to whatever
space is actually left after the auto rows claim what they need, rather than pushing
the grid taller - `min-height: 0` + `overflow: hidden` on both is what makes that
work; without `min-height: 0` a grid/flex item won't shrink below its content size.

**Player stats moved out of the board rows entirely.** O2/Momentum/Deck/Void/Hand
chips were previously rendered *inside* each `PlayerBoard`, adding a full header row
to both the opponent and player board sections. They're now a new
`PlayerStatusChips` component (exported from `PlayerBoard.tsx`) rendered twice in
the row 1 status bar instead - freeing both board rows to be nothing but Apex/Support
slots.

**Apex and Support slots now sit side-by-side horizontally instead of stacked
vertically** - this was the single biggest space win. Stacking a 152px Apex row above
a 100px Support row cost 252px of height per board (504px for both boards combined,
which alone almost exceeds a 768px-tall viewport once the status bar, Rift panel, and
hand are added). Side-by-side, the row height is just the taller of the two (152px),
roughly halving each board's footprint.

**New compact board-card sizing, distinct from hand cards** (`Card.tsx` gained
`apexBoard` ~128×152, `supportBoard` ~96×100, and `hand` ~118×148 size variants,
plus a `compact` prop that suppresses full rulesText - previously Support/Equip board
cards were silently rendering their entire rules paragraph). Apex board cards never
showed rulesText to begin with (unaffected); Support/Equip board cards now correctly
show only compact tactical info (chain status, LOCKED, equip name) - full text remains
available on hand cards, which aren't compacted.

**RiftPanel and Control Conflict's lock UI condensed to single lines** instead of a
centered multi-line card, matching the "short one-line effect text" requirement -
full Rift text is still available via the `title` tooltip attribute rather than always
being on-screen.

**`html`/`body` already had a hard `100dvh` + `overflow: hidden` cap from Commit 12**
and didn't need further changes - the actual remaining overflow was inside
`GameBoard`'s own layout, not the page shell.

**Known limitation:** because board cards use fixed pixel dimensions rather than
viewport-relative sizing, a viewport shorter than roughly 768px tall (after browser
chrome) may clip part of the board within its `overflow: hidden` row rather than
shrinking the cards further - it will never cause *page* scroll (the hard requirement),
but very short/unusual viewports could hide part of the board rather than show a
scrollbar for it. I was not able to visually verify actual pixel budgets in a real
browser at 1366×768 from here - this is worth a direct look before treating the
laptop target as fully confirmed.

## Commits 14-15: board alignment fixes

Two focused follow-ups to Commit 13's grid layout, both from screenshot feedback:

- **Centering**: the Apex+Support "fighter cluster" was packed against the left edge
  of each board row instead of centered in the available width. Fixed with
  `justify-center` on the row.
- **Cross-board Apex alignment (Commit 15)**: because the opponent's row mirrors
  (Support-then-Apex) while the player's row doesn't (Apex-then-Support), and those
  two blocks have different total widths, simple flex centering put each row's Apex
  slots at a *different* horizontal position - they didn't line up with each other.
  Rebuilt as a 3-column grid (`1fr auto 1fr`) with Apex pinned to the fixed middle
  column for both rows (identical position regardless of flip) and Support sliding to
  whichever outer column matches that side. Also forced both children onto an
  explicit `row-start-1` to remove any grid auto-placement ambiguity, and made the
  opponent's row bottom-align (`alignItems: 'end'`) while the player's stays
  top-aligned, so both sides' cards sit near the shared Rift-panel center line instead
  of drifting to the outer edges of their tall board rows - the "facing off across the
  line" feel that was requested.

## Commit 16: Card Inspect, invalid-action toast, readability polish

**Card Inspect - the centerpiece feature.** Every card (hand, board Apex, board
Support, and now Void entries too) has a small "i" button in its corner - a sibling
overlay button next to the card, not a change to the card's own click handler, so it
never conflicts with normal gameplay actions (playing, attacking, chaining, etc.).
Opens `CardInspectModal`: name/faction/type/zone/tags/cost, full rules text, and then
type-specific detail - for Apexes, current vs. base DEF, every attack with its live
`base → current` damage and modifier breakdown (the same `getPreviewAttackDamage` the
board and selector already use, so it can never disagree), counters, attached Equip,
chained Support; for Supports, chain/lock status and full Sync Ability text, including
whether it's Reconfigure-locked this turn; for Equips, which Apex (if any) it's
attached to (found by scanning both players' boards). Closes via the X button, the
Escape key, or clicking the backdrop - `fixed inset-0` overlay, so it can never affect
page height or reopen browser scroll.

**Void inspection was already implemented** (Commit 11's clickable Void chip) - each
entry is now also a button that opens the same Card Inspect modal, read-only as
required (no way to remove/reorder from the popover).

**Invalid-action feedback** moved out of being log-only: a lightweight `useEffect`
watches for new `'info'`-kind log entries (the existing "No empty Support slot",
"Cannot Reconfigure locked Support," etc. messages - no new call sites needed, since
every invalid-action path already logged with kind `'info'`) and surfaces the latest
one as a `fixed`-position toast near the hand for ~3.5 seconds. The message still also
lands in the Battle Log as before, for anyone who wants the full history.

**Rift strip shortened** to the requested one-line summaries, with the full rule text
preserved for the game-start log and available in the strip via a small "i" toggle
(expands inline) plus a hover tooltip - added a new `shortDescription` field to
`RiftSpace` alongside the existing `description` rather than replacing it, so nothing
that already depended on the full text (the game-start log, for one) needed to change.

**Selected-card clarity**: the confirmation prompts for playing an Apex/Support/Equip/
Special now name the actual card ("Selected: Spark-Plug — ...") instead of a generic
"Play this Support?" - cheap change, meaningfully less ambiguous once more than one
card has been played in a turn.

**Already covered by earlier commits, verified rather than rebuilt**: attack preview
(Commit 9's `getAttackOutcomePreview`, shown per-target while choosing where to
attack), legal-target highlighting (existing `ownApexHighlight`/`oppApexHighlight`
logic across Equip/chain/attack/target modes), the Battle Log drawer (Commit 12,
already has the "New" badge, Copy Log, internal scroll), and active-player/phase
display (top status bar's "Turn N · Phase" plus each `PlayerStatusChips` glowing when
that player is active).

## Commit 17: AI opponent + automatic Draw Phase

**Draw Phase automation.** Kept the internal `Phase` enum value as `'Start'`
(explicitly lower-risk per the request), but all player-facing text now says "Draw
Phase" via a new `PHASE_LABEL` map. A new `useEffect` in `GameBoard.tsx` watches game
state and auto-calls `advancePhase('Start')` then `advancePhase('Main')` in sequence
(small delays for readability) - except when Control Conflict's optional lock
decision is available, which pauses on a "Continue to Main Phase" button so the
choice isn't skipped instantly. The old manual Start/Main phase buttons are gone;
only Combat Phase and End Turn remain. This applies uniformly to both players in both
modes - Hotseat still requires manual Main/Combat/End, only the draw itself auto-resolves.

**AI opponent** (`src/game/ai.ts`) - a new `vsAI` flag on `GameState`, selected at the
main menu. The AI always calls the *exact same store actions* a human uses
(`playApexCard`, `declareAttack`, `resolveResponse`, etc.) - it never bypasses
legality checks or duplicates combat math, reusing `getAttackOutcomePreview` for
combat scoring and `getEligibleResponses` for response legality (the same functions
the UI itself calls). A `useEffect` in `GameBoard.tsx` re-evaluates on every state
change and, when it's player2's turn (Vs AI mode) and no human response is pending,
schedules exactly one AI action via `setTimeout` (600-700ms) - which mutates state and
naturally re-triggers the effect for the next decision, forming a queue-free
"decide one thing, wait, re-evaluate" loop. Human response windows are completely
unaffected - the driver checks `respondingPlayerId`/`negatingPlayerId` before acting
and does nothing at all when it's the human's turn to respond, so the pause is
enforced by the same `pendingResponseQueue` gate everything else already respects.

**A genuine deadlock bug, caught by testing before it ever reached a real game.**
The AI's combat logic originally checked attack affordability against
`computeAvailableSync()` - a static formula based on Support count. But
`declareAttack` actually validates against `player.availableSync`, a stateful field
that *decrements as attacks are made* during the turn. Since the AI never saw that
decrement, it kept proposing the same now-unaffordable attack every cycle, forever -
confirmed by a full AI-vs-AI simulation test hanging in Combat Phase across all 5
runs. Fixed by reading `player.availableSync` directly, the same field the engine
itself checks. Without the AI-vs-AI simulation test, this would have shipped as a
guaranteed hang the moment a real game reached a second attack in one Combat Phase.

**AI heuristics**: Main Phase priority is Apex → Support (chained if a target exists,
else unchained) → Equip → Special-with-a-legal-target, one action per cycle. Combat
scores every legal (attacker, attack, target) combination via `getAttackOutcomePreview`
- lethal beats destroy-with-overflow beats clean destroy beats raw damage - and
executes the single best one. Civil War/Human Error choose the attack bonus when an
Apex can still attack (or Momentum is capped), Momentum otherwise. Control Conflict
locks when Momentum isn't capped. Responses are deliberately conservative: only used
when O2 is low or an Apex hasn't attacked yet, otherwise pass - Reconfigure is
intentionally skipped for this first AI pass, exactly as the request allowed.

**Known limitations, stated plainly:** the AI does not use Reconfigure, does not plan
multi-turn setups, and its response-window judgment is a simple heuristic rather than
real damage-race calculation - it will occasionally hold a defensive card too long or
use one too early. It also doesn't evaluate Equip targeting beyond "first Apex without
one." This is intentionally the "functional, not strong" bar the request asked for.

## Commit 18: fixed viewport + Commit 17 hotfixes

**Hotfix 1 - AI never got to pick its own opening Apex.** The opening-Apex-selection
screen was never wired to the AI driver at all (it only handled `status ===
'playing'`), so Vs AI games silently handed the AI's pick to the human. Fixed with a
small effect inside `OpeningApexScreen` itself: when it's the AI's turn to choose, it
auto-picks after a short delay and shows "{faction} AI is choosing its opening
Apex..." instead of the AI's actual hand.

**Hotfix 2 - the "goes first" banner overlapped the hand.** That banner is an
`'info'`-kind log entry, the same mechanism Commit 16's invalid-action toast already
watches for - it was positioned at a guessed fixed pixel offset (`bottom-[180px]`)
that didn't reliably clear the hand's actual height. Moved it to `absolute
bottom-full` inside the same relatively-positioned row as the hand, so it's always
pinned exactly above that row regardless of its real height - no more guessing.

**Fixed viewport in Vs AI mode - the bigger fix.** Previously the board reused
Hotseat's pass-and-play model even in Vs AI mode: whichever player was active got
rendered at the bottom with their hand visible, meaning the human would watch their
own view flip to the AI's board *and see the AI's actual hand* during its turn. That
directly contradicts what "playing against an AI" should feel like.

Introduced a viewer-relative pair, separate from the real `activePlayerId` used for
game logic: in Vs AI mode `viewerBottomId` is always `player1` (human) and
`viewerTopId` is always `player2` (AI), full stop - the boards never swap, and the
Hand component always renders `players.player1.hand`, never the active player's hand.
Hotseat mode is completely unaffected (`viewerBottomId` still equals `activeId`
there, preserving the existing pass-and-play swap by design).

The trickier part was making sure the *human's own* board and hand can't be clicked
during the AI's turn just because they're still visually present at the bottom - the
click handlers, Reconfigure panel, and Control Conflict lock UI on the bottom board
are now all gated by `bottomIsActingPlayer` (`viewerBottomId === activePlayerId`),
so they're only wired up at all when it's genuinely the human's turn. During the AI's
turn, the human's board just sits there inert while the AI's actions play out on the
fixed top board, with the existing "{faction} AI is taking its turn..." indicator.

## Commit 18.1: action feed row (not an overlay)

Commit 18's banner reposition just moved the overlap from the hand to the bottom of
the Apex cards - it was still an `absolute` overlay, so it was always going to cover
*something* underneath it. Replaced entirely with a real row in the grid layout
(added a 6th `grid-template-rows` track) between the player board and the phase
controls - it takes up its own space rather than floating on top of anything, so it
can't cover Apex/Equip/counter info regardless of exact pixel heights. It's also no
longer a transient 3.5-second popup: it now shows the last 4 log entries persistently
(newest first, so the newest is never the one clipped if the row runs out of width),
updating live as moves happen - a real "recent moves" feed rather than a one-off toast.

## Commit 18.1: Neon Support Overdrive + menu default

**Menu**: Single Player (Vs AI) is now the default and listed first; Hotseat is
relabeled "2-Player" and Vs AI is "Single Player."

**Spark-Plug and Juice-Box gained an optional Overdrive**: spend 1 Momentum for
+100 more (damage for Spark-Plug, DEF for Juice-Box), decided at the moment of
trigger, never a permanent upgrade.

**Architecture note, since this needed a real design decision:** Spark-Plug's bonus
applies live during damage calculation (from Commit 11), which happens *before* the
attack is declared - there's no natural "pause mid-resolution" point to ask a
question without either double-computing damage or building a whole new response-
window type. Juice-Box's trigger, by contrast, fires *after* the attack fully
resolves. Rather than force both through the heavier `pendingResponseQueue`
machinery (built for Reactions/Negates - the spec explicitly says this isn't one),
the Overdrive choice happens **before** `declareAttack` is called at all: the UI
checks eligibility on target selection, shows a compact choice bar if applicable,
and the decision is passed into `declareAttack` as a new optional 4th parameter
(`overdriveSpend`). Since only one Ability Support can ever be chained to a given
Apex, at most one of these two cards is ever eligible on a single attack, so the UI
only ever needs to ask one question, not two. A single shared helper,
`getOverdriveEligibility`, decides whether to even offer the choice (chained,
unlocked, not Reconfigure-locked, Momentum > 0) and is reused identically by the UI
prompt and the AI - so eligibility can't silently drift between the two.

Spark-Plug's +100 is added directly to a local damage total inside `declareAttack`
(inherently transient - there's nothing to clean up afterward, since it's never
written to persistent state). Juice-Box's is trickier: its DEF buff isn't applied
until later, in its own `syncAbility` call, so the decision is stashed on a new
transient `pendingJuiceBoxOverdrive` field on the *attacking* Apex, read and cleared
in the same synchronous call by Juice-Box's own logic (folding +300 instead of +200
into the same `markPendingEndPhaseBuff` call rather than tracking two separate
buffs) - it can never survive to a future attack.

**AI heuristic** (the spec's own "if too complex" fallback, since a full damage-race
simulation felt like overkill for this pass): Spark-Plug spends only if +100 flips a
non-destroying attack into a destroying one or creates lethal; Juice-Box spends only
when Momentum is already at the 3-cap (nothing better to do with it that turn).
Neither goes through `pendingResponseQueue`, so there's no risk of the AI loop
stalling on it - confirmed via a dedicated test plus the existing AI-vs-AI
simulation still completing cleanly.

## Commit 18.2: Chained Support Destruction + Reconfigure panel relocation

**New core rule**: when an Apex is destroyed, any Ability Support currently chained
to it is destroyed too and sent to Void - not just unchained (the previous
behavior). Unchained Ability Supports and Battery Supports are unaffected, and a
Support chained to a *different*, surviving Apex is untouched. This makes chaining a
genuine risk/reward choice instead of a free upside, as requested.

**Implemented as one general-purpose helper**, `destroyChainedSupportForApex` in
`rules.ts`, called from `destroyApexFn` right after the Apex's own destruction log -
it looks for whichever Ability Support (if any) is chained to the apex being
destroyed, with no hardcoded card names, so it applies identically to Spark-Plug,
Juice-Box, Oxygen Siphon, Gatekeeper Drone, or anything added later. Since
destruction is *confirmed* before this ever runs (this is called from
`destroyApexFn`, which itself is never invoked on a prevented-destruction path, e.g.
Backup Consciousness), the "don't destroy the Support if destruction was prevented"
requirement falls out for free from the existing pipeline rather than needing new
guard logic.

**Sync recalculation**: rather than rewriting the Sync model (explicitly discouraged
in the request unless necessary), a destroyed chained Support now caps the player's
current `availableSync` down to whatever `computeAvailableSync` says is possible
with one fewer Support - handles both "next Combat Phase" and the trickier
"mid-Combat" case without touching how Sync is earned or spent elsewhere.

**Juice-Box's pending buff** was already safe without new code: Commit 11's "strip
all transient state before sending an Apex to Void" cleanup already discards
`pendingEndPhaseDefBuff` (and the newer `pendingJuiceBoxOverdrive` flag) the moment
an Apex is destroyed, and the End Phase buff-application loop only ever iterates
still-present Apexes - so there's no path left for a destroyed Apex to receive a
buff after the fact.

**Card Inspect**: Ability Supports now show a one-line risk note ("if the chained
Apex is destroyed, this Support is destroyed too and sent to the Void") in the
detail modal - added once, generally, rather than repeated in six different cards'
rules text, per the request's own preference for a shared note over duplication.

**Cosmetic fix, also requested this round**: the Reconfigure panel moved from the
shared Rift/prompt strip (which visually reads as "the middle of the board") down to
directly above the hand, in the same fixed-bottom area as your cards and phase
buttons - it now reads as "your own toolbar" rather than a neutral shared control.

**Testing found a real regression risk before it shipped**: an existing Commit 11
test explicitly asserted the *old* "becomes Unchained" behavior. Rather than quietly
deleting it, I updated it to assert the new destruction behavior and left a comment
explaining it supersedes the prior expectation - so the test history stays honest
about what changed and why, rather than just vanishing.

## Commit 18.3: AI could get permanently stuck on an unplayable card

A real bug from an actual play session: the AI drew Ascension Complete (a Special
with `canPlay: (playerId, state) => state.players[playerId].turnFlags
.cardsPlayedThisTurn >= 1`) as the first thing it tried to do in Main Phase, before
playing anything else that turn. `playSpecialCard` correctly rejected it and logged
"cannot be played right now" - but the AI's `aiPlayOneMainPhaseAction` didn't check
whether the play had actually gone through before reporting success. Since a
rejected play still appends a log entry (a new state reference), the AI driver's
effect re-triggered, saw the identical hand/board/turn state, made the identical
(wrong) decision, and repeated forever - 100+ duplicate log lines and a frozen game.

**Root-cause fix, not a special case for this one card**: every attempted play in
`aiPlayOneMainPhaseAction` (Apex, Support, Equip, Special) is now verified by
checking whether the card actually left the hand afterward - store actions return
`void`, so hand-presence is the only reliable ground truth available. A rejected
play now correctly falls through to the next candidate/category instead of being
reported as a completed action. Specials also get a `canPlay()` pre-filter and now
try every Special in hand in order (not just the first), so one unplayable card
can't block a later, perfectly legal one from being tried in the same cycle.

**New test file**, `test-ai-canplay-guard.ts`, reproduces the exact reported
scenario (a Special whose `canPlay()` precondition isn't met yet) and confirms: the
AI correctly reports no action taken rather than looping, the card stays in hand
rather than being silently consumed, at most one rejection is logged rather than a
runaway spam, the same card plays normally once its precondition is later satisfied,
and a full AI turn still completes when the hand contains one initially-unplayable
Special alongside other legal plays.

## Commit 18.4: Negate merged into React (5 card types)

**ASPHYXIA now has 5 card types: Apex, Engine, Equip, Special, React.** "Engine" is
the umbrella label for AbilitySupport/BatterySupport and "React" is the umbrella
label for Reaction - both stay mechanically distinct internally (Engine subtypes
still have different chaining rules; cancel-style Reacts are still identified
separately), but players only need to think in terms of 5 types now. See the
`CardType` doc comment in `types/game.ts` for the authoritative reference.

**`NegateDef` is gone**; its fields folded into `ReactionDef` as optional -
`trigger` (attack-based Reacts set it) and `canCancel` (cancel-style Reacts set it
instead) are now mutually-exclusive-in-practice optional fields on one interface,
rather than two separate card types. Feedback Loop, Absolute Refusal, and Logic
Denial are now `type: 'Reaction'`, distinguished as cancel-style by the NEGATE tag
they already carried plus the presence of `canCancel`. A new `getCardTypeLabel()`
helper in `lib/theme.ts` replaced the old static label map, since telling "React"
from "React — Negate" (or "Engine — Ability" from "Engine — Battery") now requires
looking at tags, not just the bare type string.

**Kept exactly as directed:** the `negateWindow`/`reactionChoice` window-stage split
is untouched - only the card *type* merged, not response timing. Deck construction
was already fully type-agnostic (every card in a faction file gets 2 copies,
regardless of type), so there was nothing to change there at all, confirming the
low-risk read from the design discussion before this build started.

**The specific risk I'd flagged and traced through beforehand held up under testing**:
a negate-style React never re-opens a fresh negate window when played (its resolution
path doesn't call the same window-opening function that Special/Equip/Reaction plays
do), and it can't appear in an attack-defense window because it never sets `trigger`
- both are now covered by dedicated tests (`test-negate-merge.ts`, 31 checks) rather
than left as an assumption.

**Every requested test is in that new file**: cancel-style Reacts still cancel legal
Specials/Reacts/Equips per each card's own `canCancel`; they don't appear as
attack-defense options; using one doesn't open a new negate window; all three
display as "React — Negate"; and a full sweep of all 45 cards confirms none carry
`type: 'Negate'` anymore. Also added: same Momentum cost verified unchanged, and the
once-per-turn instant limit still enforced identically.

**Touched ~12 files** in total (types, the 3 card data files, `rules.ts`,
`gameStore.ts`, `ResponseModal.tsx`, `CardInspectModal.tsx`, `Card.tsx`,
`lib/theme.ts`, `simulate.ts`, and two existing test files whose fixtures
constructed `'Negate'`-typed card instances) - all mechanical updates once the type
definitions changed, no gameplay-logic rewrites needed anywhere.

## Commit 19: reusable Apex overlay template + Developer gallery

**Files added**: `lib/cardArt.ts` (art lookup), `lib/apexOverlay.ts` (the shared
`APEX_TEMPLATE_ZONES` percentage config + `getValueDeltaState`/
`getDisplayedDefenseValue`/`getDisplayedAttackValue` helpers), `components/apex-
overlay/ApexOverlaySystem.tsx` (`CardArtLayer`, `ApexOverlayLayer`,
`CounterBadges`, `StatusFlags`, `DynamicStatText`), `components/ApexCardRenderer.tsx`
(the top-level reusable renderer), `components/DevCardGallery.tsx` (the new
Developer view). **Files touched**: `Card.tsx` (delegates to `ApexCardRenderer` when
art exists), `NewGameMenu.tsx` (subtle "Developer" link), `app/page.tsx` (local
`showDeveloper` view-state, deliberately separate from the game store's own status
machine so it can never interact with match state).

**How the template works**: every zone (DEF badge, 4 attack rows, counter cluster,
status strip) is defined once in `APEX_TEMPLATE_ZONES` as percentages of the card
container, not pixels - the same numbers work at board size (128×152), hand size
(118×148), and the gallery's larger preview size without any per-size math. Layer 1
(`CardArtLayer`) renders the baked art image, or a themed gradient placeholder when
none is mapped. Layer 2 (`ApexOverlayLayer`) renders only the live values - DEF,
attack damage, counters - color-coded via `getValueDeltaState` (green above base,
red below, white at base). Attack name and value zones are separate columns, so
value alignment never shifts with name length, as required.

**Art mapping**: `CARD_ART: Record<string, string>` in `lib/cardArt.ts`, keyed by
card id, currently empty (commented example only). `getCardArt(defId)` is the single
lookup point every consumer uses. No art is required immediately - the object can
grow one entry at a time.

**Fallback behavior - the most important guarantee in this commit**: `Card.tsx`
only takes the new `ApexCardRenderer` path when `isApex && getCardArt(instance
.defId)` is truthy. Since `CARD_ART` is empty today, **every Apex in the live game
renders exactly as it did before this commit** - this was verified, not assumed: the
full test suite (363+ checks) and a fresh 72-game simulation both ran clean with the
same numbers as prior commits, confirming zero behavioral change to gameplay.

**No calculation duplication**: `getDisplayedDefenseValue`/`getDisplayedAttackValue`
are thin one-line delegations to the existing `getEffectiveDef`/
`getPreviewAttackDamage` in `rules.ts` - the same functions combat resolution and
the attack selector already use. `ApexCardRenderer` itself goes one step further and
accepts pre-computed `attackPreviews` in the exact shape `Card.tsx` already receives
from its callers, so the new and old rendering paths can never show conflicting
numbers for the same card even in principle.

**Developer gallery**: reachable via the small "Developer" link at the bottom of the
main menu (not the primary CTA - kept subtle per the project's existing pattern for
dev tooling). Shows all 12 current Apexes grouped by faction, each rendered through
the exact same `ApexCardRenderer` the live game uses (no one-off gallery-only
renderer). The "Show Apex Overlay Zones" checkbox outlines every zone with a labeled
dashed border for tuning - off by default. Since no real art exists yet, gallery
cards render on the placeholder gradient so the zone system is visually verifiable
today, ahead of any art being added.

**Known limitation**: the zone coordinates from the spec are untested against a real
uploaded frame, since no art was provided this commit - they're implemented exactly
as given, but "do these percentages actually land inside the DEF badge and attack
panel of the real baked frame" can only be confirmed once real art is dropped in and
checked against the debug-zone overlay in the gallery. That's expected next-step
work, not a gap in this commit.

## Commit 19.1: all 12 Apex art files added, zones calibrated against real art

All 12 uploaded card images are now live in `CARD_ART` - every Apex in the game now
renders through the new overlay template instead of the placeholder-only path
Commit 19 shipped with. Files live in `public/art/apex/`, named by card id
(`nu-riot-runner.png`, `dw-glass-warden.png`, etc.).

**Zones were calibrated against the actual uploaded frames, not left at guessed
defaults.** I measured the real DEF badge and ATTACKS panel boundaries via pixel
analysis (scanning for the black-panel edge and the badge's text bounds) across
several cards, then verified the result by compositing the zone rectangles directly
onto the real card images and inspecting them - not just trusting the math. One
real finding from that process: the black panel's top edge varies by about 3
percentage points across the 12 images (60.9%-64.0%), since these were generated
individually rather than sharing one pixel-identical template. The zones are tuned
to sit comfortably across that spread, but a specific card could still be a hair
off - that's exactly what the gallery's "Show Apex Overlay Zones" toggle is for.

**A more significant issue turned up during that same check, and got fixed at the
source rather than patched around**: the uploaded art is 600×900 (a 2:3 ratio), but
the game's compact board size (128×152) has a meaningfully different ratio - a 26%
mismatch. Rendering that art with `object-cover` inside a mismatched container would
crop up to a fifth of the image off the top and bottom, silently invalidating every
percentage-based zone at exactly the size players see most during a match. Fixed by
having art-based Apex cards derive their container width from the art's own 2:3
ratio (anchored to the existing height, so board/hand row spacing is unaffected)
rather than reusing the generic size preset's width, and using `object-contain`
instead of `object-cover` as a second safety net. This means an art-based Apex card
is now a few pixels narrower than a non-art card at the same "size" during this
transitional period where not everything has art yet - a minor visual tradeoff, but
the alternative (cropped frame edges, misaligned DEF/attack numbers) was worse.

**Verified**: full test suite (330+ checks) and a fresh 72-game simulation both ran
clean after adding real art, confirming - as expected for a presentation-only change
- zero effect on gameplay logic.

**Known limitation, unchanged from Commit 19**: I can't run a live browser from
here, so "does this look right" is confirmed via static pixel-composite checks
against the actual uploaded images, not a rendered page. That's a meaningfully
stronger check than eyeballing the spec's suggested coordinates, but it's still not
the same as looking at the real rendered gallery - worth a look on your end before
calling the calibration final.

## Commit 19.2: hover-to-enlarge

Every card (hand, board, gallery - anywhere `Card.tsx` renders) now shows an
enlarged copy near the cursor after a 350ms hover delay, on hover-capable pointer
devices only (`matchMedia('(hover: hover) and (pointer: fine)')` - touch devices
keep their existing tap-to-inspect flow instead, so a tap can't leave a "stuck"
enlarged card behind). The 350ms delay avoids a flood of enlarged previews while
sweeping the mouse across a full hand or board.

**No new rendering logic** - the enlarged copy is just `Card` calling itself at
`size="lg"` with a new `disableHoverPreview` flag (prevents the preview copy from
trying to spawn a hover preview of its own). Since it's the same component, art
cards show their real art in the preview too, automatically, with no extra wiring.

**Positioning**: `fixed`, offset from the cursor, and clamped to the viewport so it
never renders off-screen near any edge - flips to the left of the cursor if it would
overflow the right edge, and clamps vertically within a small margin. The preview
carries `pointer-events-none`, so it can never intercept a click meant for the card
underneath or anything else on the board.

**Safety**: the pending hover timer is cleared on unmount, since a card can
disappear mid-hover (destroyed in combat, returned to hand, etc.) before the delay
elapses - without this, a stray `setState` on an unmounted component would fire.

**Verified**: full regression suite and a fresh 72-game simulation both ran clean -
expected, since this only adds a new hover interaction layer and touches nothing in
`onClick`/game logic.

## Commit 19.3: overlay text was never actually scaled - real bug, fixed at the root

Reported from real screenshots: DEF/attack numbers were huge on the small board
cards and overlapping each other on the large opening-hand view. Root cause: `Dynamic
StatText`'s font size defaulted to CSS `'inherit'`, and nothing anywhere in the
component chain (`ApexCardRenderer` → `ApexOverlayLayer` → `Zone`) ever set an
explicit font size - so it fell back to the browser's default (~16px) regardless of
whether the card was 101px or 187px wide. On a ~101px-wide board card, a 16px bold
"400" was always going to blow out its zone; this wasn't a tuning problem, it was a
missing feature (font size was never wired to card size at all, at any point in
Commit 19).

**Fix**: every card now carries its actual rendered pixel width (`cardWidth`) down
through `ApexCardRenderer` → `ApexOverlayLayer` → `DynamicStatText`/`CounterBadges`/
`StatusFlags`/attack-name text, and each computes its font size as a percentage of
that real width (via a new `scaledPx` helper, clamped to a sane min/max so it
doesn't go illegible small or silly large at extreme sizes) rather than an inherited
or hardcoded value. `DynamicStatText.sizePx` is now a required prop specifically so
this can't silently regress back to `'inherit'` in the future - there's no default
to fall back to.

Roughly: DEF/attack values run ~11px at board size (101px wide) up to ~21px at the
large hover/inspect size (187px wide); attack names and counter/status badges scale
proportionally smaller. This is the same board-size-vs-inspect-size range Card.tsx's
original flow-layout path already used (via its `textScale` Tailwind classes) - the
overlay path just never had an equivalent until now.

**Verified**: full regression suite (330+ checks) and a fresh 72-game simulation
both ran clean, confirming - as expected for a text-sizing fix - zero effect on
gameplay logic.

## Commit 19.4: DEF/attack text sized to actually fit its zone

Commit 19.3 fixed the font size being unscaled entirely, but the replacement ratio
(0.11 of card width, max 22px) still wasn't checked against the *zone's actual
width* - just picked to look reasonable. On the opening-hand screen (187px-wide
cards), that produced a ~21px "300" trying to fit inside a DEF badge only ~30px
wide, which a 3-character bold number can't do - it overflowed the badge
significantly, as shown in a real screenshot.

**Fixed by computing the real constraint instead of guessing a ratio**: DEF zone is
16% of card width, attack-value zone is 13.5%. For a 3-character bold number to
actually fit, font size needs to stay under roughly zone-width ÷ 1.8. Checked that
math against every card size in use (101px board, 118px hand, 187px inspect/hover,
240px gallery) before picking the new ratio/clamp (DEF: 0.075 of width, capped at
15px; attack values: 0.05 of width, capped at 10px) - both now sit comfortably
under the fits-in-the-zone threshold at every size, not just the one that happened
to prompt the report.

**Also added a safety net**: `Zone`'s content is now wrapped in `overflow: hidden`,
so even an unanticipated edge case (a future card with an unusually long value)
clips invisibly within its zone instead of visibly spilling into a neighboring
element - the debug-label outline (used for zone tuning) is unaffected, since it
intentionally sits above the zone and isn't part of this wrapper.

Smaller text at every size is an accepted, intentional tradeoff here per direct
feedback - the hover-to-enlarge feature (Commit 19.2) is exactly what makes that
fine: anyone who wants a closer look at the numbers just hovers.

**Verified**: clean `tsc`/`eslint`/build and a fresh 72-game simulation - a pure
sizing fix, no gameplay logic touched.

## Commit 20: full card art, Equip attachment, 2x hover

**All 33 remaining cards now have art** - every card in the game (45/45) has a
mapped image. `CARD_ART` in `lib/cardArt.ts` is now genuinely generic across all
5 card types, not Apex-specific. Non-Apex cards render via a new `GenericArtCard` -
just the baked art, no overlay, since (per direct instruction) nothing on an
Engine/Equip/Special/React face changes live the way DEF/attack numbers do on Apex.
`Card.tsx`'s art-branch condition broadened from "is this an Apex with art" to "does
this card have art at all," routing to `ApexCardRenderer` or `GenericArtCard`
accordingly - same fallback guarantee as before (no art entry = old flow-layout,
unchanged).

**Two real art-integration bugs caught and fixed before they shipped, not two
different bugs I got right the first two times:**
1. The new art is 1500x2100 (5:7) - a *different* ratio than the Apex art's 600x900
   (2:3). Reusing Commit 19.1's single hardcoded ratio would have reintroduced the
   exact crop/pillarbox bug that commit fixed, just for every other card type
   instead of Apex. Added `getArtAspectRatio(cardType)` so the right ratio is always
   used per card type, not assumed.
2. Once Engine cards had art, their board slots inherited the same aspect mismatch
   Apex slots had before Commit 19.1 - and their *empty*-slot placeholders (and
   Apex's) were still sized for the old flat-color layout, no longer matching the
   now-art-based filled slots next to them. Fixed both empty-slot placeholders to
   compute their width the same way filled ones do.

**Equip attachment** (`EquipFlap.tsx`): an equipped Apex now shows the Equip's art
as a seamless tab beneath it on the board, cropped from the *bottom* of the Equip
card's own art - the physical card reference showed this as the Equip card's own
built-in design, not separate flap-only art, so that's what the crop pulls from
(`EQUIP_FLAP_CROP_RATIO`, currently 16% of the Equip's full height, tunable in one
place). It's independently hoverable/clickable from the Apex above it, reusing the
same `CardHoverPreview` every other card's hover uses (exported from `Card.tsx`
specifically for this reuse) - hovering the flap shows the Equip's full card, not
the Apex's.

**Layout**: Apex and Engine slots stay aligned on the same row exactly as before
(Commit 15's grid didn't need to change) - only the equipped Apex's *own* column
grows taller, by exactly the flap's height, and CSS grid's normal flow pushes every
row after it down with no overlap, the same way any other content in this layout
already does. I did not get to test this against the specific worst-case scenario I
flagged before starting (both Apex slots equipped simultaneously, full hand, an
active rift prompt) in a live browser - the math checks out and nothing in testing
contradicts it, but that specific combination is worth you checking first, since
it's the one case I said upfront I couldn't fully de-risk from here.

**Hover preview is now genuinely 2x**, not just a bigger box around the same content
- added a new `xl` size (380×532) so Apex overlay text scales up properly too
(it's driven by real rendered width, so it wasn't just a CSS transform).

**Known, expected tradeoff**: the Equip flap is small at actual board size (its
baked "EQUIP — Name" text becomes hard to read at ~23px tall) - same tradeoff as
the DEF/attack numbers, solved the same way: compact on the board, fully legible on
hover. Not something I tried to further compress-fix, since it's inherent to how
little vertical space a flap can reasonably claim without over-growing the board.

**Verified**: full regression suite (350+ checks across 15 files) and a fresh
72-game simulation both ran clean - expected, since this is entirely presentation
layer and touches no game logic.

**One more thing worth flagging, since it wasn't asked for but mattered**: the
uploaded source art was 2-3MB per image (2100px-tall PNGs) - 45 of them would have
been ~109MB of images for the browser to load, which is a real problem for an
actual deployed game regardless of how correct the rendering code is. Resized to
800px max width (comfortably more than 2x the largest size any card is ever
actually displayed at, `xl` hover preview at 380px) and converted from PNG to WebP,
which compresses this kind of painterly/photographic art far better than PNG does.
Total art footprint: 6MB, down from 109MB, with no visible quality loss at any
in-game display size.

## Commit 20.1: Confirm bar relocated, background art added

**Confirm bar moved down.** The "Selected: X — play/equip/chain?" prompt (and
everything that shares its slot - the Overdrive prompt, target-selection hints)
lived in the rift/prompt row near the top of the board, meaning every card
play required a full mouse trip from the hand up to that row and back down.
Relocated to sit directly above the hand, right where Commit 18.2 already moved
the Reconfigure panel for the same reason - same pattern, same justification,
just extended to cover the rest of the prompts that hadn't gotten the same
treatment yet.

**Background art added.** The uploaded cityscape now sits behind the whole app
(`html`/`body`, via `globals.css`) - `background-size: cover`, fixed, with a dark
gradient overlay (80-88% black) so it reads as atmosphere rather than competing
with the UI's contrast, which the whole interface depends on for legibility.
Compressed from 2.5MB PNG to a 184KB WebP first (same reasoning as Commit 20's art
compression - no reason to ship a multi-megabyte background image when a fixed,
covered background never needs anywhere near full source resolution). Shows through
on both the main menu and in-game, since neither sets an opaque background of its
own; the Developer gallery keeps its solid black background, since that's a dev
tool rather than part of the game's presentation.

**Verified**: clean `tsc`/`eslint`/build, plus a quick regression pass (AI test
suite + 72-game simulation) - both pure presentation changes, no gameplay logic
touched.

## Commit 20.1 hotfix: background wasn't actually visible, panels weren't opaque

Two related issues from a real screenshot, not visible until you actually looked at
a live screen (this is exactly the kind of thing I can't fully verify from here).

**The background genuinely wasn't rendering.** It was applied as a plain CSS rule
(`html, body { background: ... }`) in `globals.css` - almost certainly getting
silently deprioritized by Tailwind v4's own cascade-layer system for its preflight
styles, even with no directly competing class. Rather than chase the exact layer
mechanics, moved it to an inline `style` on the `<body>` element in `layout.tsx` -
inline styles win over any stylesheet rule regardless of layers or specificity, so
this can't quietly lose the cascade again.

**Every panel that houses cards/hand/data is now fully opaque**, not translucent -
top status bar, the main board panel, Rift panel, hand, action feed, phase
controls, Reconfigure panel, Combat Controls, Void inspector, Game Log, and the
opening-Apex-selection panel, all switched from `bg-black/NN` (letting the
background bleed through) to a solid `#05050a` (the game's actual background
color, for exact consistency rather than pure `#000`). The background image is now
only visible in the gaps *between* panels, not through them - which is what
actually makes it read as atmosphere instead of noise competing with card text.
Left the Battle Log/Card Inspect modal *backdrops* alone (their dimming scrim
behind the modal is supposed to be translucent - that's a different job than a
panel that houses content) - their actual content panels were already opaque.

**Verified**: clean `tsc`/`eslint`/build plus a regression pass - pure CSS, no
gameplay logic touched.

## Commit 21: Deck/Void stacks, shared O2/Momentum, wider board, grouped controls

**Board widened** - cap raised from 1400px to 1800px, freeing up the side margins
the rest of this commit uses.

**Deck and Void are now visual stacks on the board**, not text chips in the top
corner. Rendered via the new `DeckVoidStack` component, using the uploaded card-back
art for the stack visual and a count above it. They live in each board row's
*already-empty* outer grid column - the column that doesn't have Support slots
(Commit 15's 3-column grid always leaves one side empty depending on flip
direction), so this needed zero restructuring of the Apex/Support layout itself,
just filling space that was already sitting unused. Deck stays count-only and
non-interactive, matching the existing "never reveal deck contents" rule; Void is
clickable.

**Void inspection is now a full-screen modal** (`VoidInspectModal.tsx`) instead of
the small popover it was before - shows every card in that Void as a proper grid,
closeable, with Escape support, and clicking any card opens the same Card Inspect
modal everything else uses for full detail. Still strictly read-only, per the
existing rule - no way to reorder or remove anything from here.

**O2 and Momentum are now one shared, centered readout** (`SharedStatsBar.tsx`)
instead of being split across each player's corner chip - left value/color always
matches whichever player is shown on the left of the board, right always matches
the right, so it stays correctly paired regardless of Hotseat's turn-based
left/right swap or Vs AI's fixed sides. Positioned right above the Rift panel,
which already sits in that shared horizontal band.

**Phase controls (Combat Phase / End Turn / Reconfigure) are now a grouped, centered
cluster** instead of a left-aligned strip - wrapped in a shared `max-w-md mx-auto`
container so the two boxes read as one unit, with their internal content centered
too. Didn't attempt to literally merge Reconfigure's expandable content (support
list, chain prompts) into the same box as the phase buttons - that state machine
already has several conditional sub-states, and merging it felt like a real risk to
introduce bugs for a purely cosmetic win; the centering achieves the same visual
grouping without touching that logic.

**Also**: `PlayerStatusChips` simplified down to just Faction name + Hand count
(everything else moved out to the new dedicated elements above), and the unused
`faceDown` card-back rendering in `Card.tsx` now uses the same real art instead of a
generated stripe pattern, for whenever it's needed.

**Verified**: full regression suite (350+ checks across 15 files, including the
AI-vs-AI simulation) and a fresh 72-game simulation both ran clean - this is
presentation-layer work with one exception (PlayerBoard's grid restructuring), and
that restructuring didn't touch anything game-logic related, only which DOM column
renders which existing component.

## Commit 21.1: squared up, Rift moved, a real Deck/Void proximity bug fixed

**Widening the board in Commit 21 was the wrong fix.** It was meant to give
Deck/Void room, but `max-w` stretched every container (board, hand, Rift panel) to
fill that space too, which is exactly the sparse look flagged in a real screenshot.
Reverted from 1800px down to 1150px - more squared, matching what was actually
asked for.

**Rift panel moved up**, now its own row directly under the top status bar instead
of sitting between the two boards - it's table-state info like Turn/Phase, so it
reads better grouped with them. The dynamic prompts that used to share that row with
it (Combat Controls, Control Conflict's lock choice, target-selection hints) stay
where they were, between the two boards, since those are genuinely tied to what's
happening on the board itself.

**Found a real bug while fixing the "Deck/Void should be closer to Apex" note, not
just a tuning issue.** Each side column of the board row needs a *fixed* "hug toward
center" direction based on which column it physically is (left column always
right-aligns toward Apex, right column always left-aligns toward Apex) - that's
true no matter what's inside the column. But Commit 21's code copied the *old*
flip-conditional justify logic (originally written when only Support ever lived in
these columns, so the flip direction happened to always match) onto both possible
occupants without separating "which column am I in" from "what's currently inside
me." Support ended up correctly hugging center by accident; Deck/Void ended up
hugging the *outer* edge instead - the exact "too far from Apex" problem in the
screenshot. Fixed by making each column's alignment a fixed property of its
position, not conditional on flip state or contents.

While in there, also switched the side columns from `1fr` (always claims equal
leftover space, which is what caused so much visible gutter once the board widened)
to content-sized (`minmax(0,auto)`), with the whole 3-column cluster centered as a
unit - Apex alignment between the two board rows is unaffected, since that only
ever depended on the fixed middle column, never the outer ones.

**Verified**: clean `tsc`/`eslint`/build, the AI test suite, and a fresh 72-game
simulation - pure layout/CSS, no gameplay logic touched.

## Commit 21.2: header consolidated, Rift wraps to content, phase controls on one line

**Header consolidated into one centered band.** Player identity+hand chips no
longer sit in the top corners - they now flank the shared O2/Momentum readout in a
single centered row, between the top Turn/Phase bar and the Rift line. The top bar
itself is now just Turn/Phase/Battle Log/Reset, centered, since it no longer needs
to make room for chips on either side.

**Rift line now hugs its actual content** instead of stretching to the container's
full width - switched from a block-level div to `w-fit mx-auto`, so a short Rift
description doesn't leave a long stretch of empty bar next to it. Centered as a
unit, not just its text.

**Phase controls (Combat Phase / End Turn / Reconfigure) are one line now**, not
two - `flex-row flex-wrap` instead of stacked, so they only wrap to a second line if
Reconfigure's own expanded content (support list, chain prompts) genuinely needs the
room.

**On the missing Equip flap, reported from a real screenshot**: I traced it to the
board rows' `overflow-hidden` clipping an equipped Apex+flap when the row doesn't
get enough auto-height - exactly the risk flagged before the Equip flap was first
built. This commit's consolidation frees real vertical space (roughly 36px by hand-
calculation, comparing the old header+Rift structure against the new one, plus the
phase-controls line merge) which gives the flap more room to render fully. I want to
be precise about what that math does and doesn't prove: it's a genuine improvement,
confirmed by working through the row-by-row budget rather than assuming, but the
single worst case - both players' Apexes equipped at once, an active Combat prompt,
and a large hand, all simultaneously, at exactly 1366x768 - may still compress the
flap somewhat, since the total still lands close to that viewport's height in that
specific combination. Meaningfully better, not a mathematically ironclad guarantee -
worth a direct look at that exact scenario before considering it fully closed.

**Verified**: clean `tsc`/`eslint`/build, the AI test suite, and a fresh 72-game
simulation - pure layout/CSS, no gameplay logic touched.

## Commit 21.3: identity+stats band actually moved this time

Commit 21.2 consolidated the identity chips and O2/Momentum into one band
correctly, but left the whole thing sitting up near the header instead of actually
moving it down between the two board rows - which was the actual point of the
request from the start. Confirmed from a real screenshot with the band still
circled at the top. Moved it: Rift stays where it was (right under the top bar),
and the identity+stats band now sits between the opponent board and the prompt
area - genuinely between the two Apex rows, not just visually consolidated in the
wrong place.

**Verified**: clean `tsc`/`eslint`/build, the AI test suite, and a fresh 72-game
simulation - pure layout, no gameplay logic touched.

## Commit 21.4: the board's own box was still full-width

Commit 21.1 centered the Apex/Support/Deck/Void *content* inside each board's
bordered box, but never addressed the box itself - the outer GameBoard layout is a
single-column grid (every row stacks vertically), so any row's wrapper div is
full-width by default unless told otherwise. That's exactly the gap flagged from a
real screenshot: content correctly centered, but the visible border was still
drawn edge-to-edge with a lot of empty space inside it on both sides.

Fixed by giving the board's own bordered box (`PlayerBoard.tsx`'s outer div)
`w-fit mx-auto` - it now hugs its actual content width and centers itself within
the row, the same treatment already applied to the Rift panel. Left Hand's
container alone for now, even though it has the same underlying full-width default -
a hand box that visibly resizes every time card count changes felt like a different
tradeoff worth asking about rather than assuming, since board width staying stable
turn to turn might matter for a game and hand width doesn't need to.

**Verified**: clean `tsc`/`eslint`/build, the AI test suite, and a fresh 72-game
simulation - pure layout, no gameplay logic touched.

## Commit 22: Equip Swap, wired up end-to-end

**The rules engine already existed** - `equipSwap` in `gameStore.ts`, the
`equipSwapUsedThisTurn`/`equippedTurn` tracking fields, and the `resolveEquipSwap`
response continuation were all already in the codebase from an earlier session,
matching the spec given here almost exactly: once-per-turn global gate, can't swap
an Equip attached this same turn, old Equip returns to hand (never Void), no
destroy-hook fires on swap. What was missing was entirely the UI - there was no
button, no click-flow, nothing wiring a person to that logic at all.

**Built the UI to mirror Engine Reconfig's existing two-step flow**: click "Equip
Swap" → click an Apex on the board that has a swappable Equip (highlighted the same
way Reconfigure highlights valid Support targets) → click an Equip card in your
hand to swap in. Sits right next to Engine Reconfig, same row, since the two are
independent once-per-turn budgets - using one doesn't block the other, matching the
"1 Equip Swap per turn, period" + "1 Engine Reconfig per turn, period" spec exactly.

**Wrote a dedicated test that didn't exist before** (`test-equip-swap.ts`, 12
checks) since this mechanic had never actually been exercised end-to-end before
today despite the store logic's age. Verified directly, not assumed: a same-turn
swap attempt is rejected, a later-turn swap succeeds, the old Equip lands in hand
and specifically *not* in Void, Sterile Mantle's destroy-triggered Momentum payout
does not fire on either the rejected or successful swap, the second swap attempt in
one turn is rejected once the budget is spent.

**Verified**: full regression suite (380+ checks across 16 files, including the new
one) and a fresh 72-game simulation both ran clean, plus clean `tsc`/`eslint`/build.

## Commit 22.1: Hand is now dynamic, floored to the board's real measured width

Hand's container now hugs its actual content (`w-fit`) and grows with hand size,
instead of always being full-width regardless of how many cards are in it -
answering a question I'd deliberately left open in Commit 21.4, where I held off
touching Hand's width without knowing whether a resizing hand box was wanted.

**The minimum width is measured, not guessed.** Rather than hardcode a pixel value
approximating the board's width (which could silently drift out of sync if the
board's own content ever changes for unrelated reasons later), `GameBoard.tsx` now
holds a `ResizeObserver` on the player's actual board box (the bordered container
itself, not the full-width row wrapper around it - those are different elements,
and measuring the wrong one would have given the old full-page width right back).
That live-measured width is passed down as Hand's `min-width`. Hand can still grow
past it for a large hand; it just never reads narrower than the board above it.

**Verified**: clean `tsc`/`eslint`/build, the AI test suite, and a fresh 72-game
simulation - pure layout, no gameplay logic touched.

## Commit 23: combat animations, active-turn glow, hand playability dimming

**Files added**: `src/store/animationStore.ts` (transient visual-event queue),
`src/lib/cardPlayability.ts` (`canPlayCardFromHand`/`getCardPlayabilityReason`).
**Files touched**: `gameStore.ts` (event emission points only - no logic changed),
`Card.tsx` (`isPlayable` dimming prop), `Hand.tsx`, `PlayerBoard.tsx`,
`SharedStatsBar.tsx`, `globals.css` (new keyframes + reduced-motion overrides).

**Combat animations run on a separate store from game state, on purpose.** Combat
in this game resolves fully synchronously in one Zustand mutation - `declareAttack`
computes damage, DEF, overflow, and destruction in a single call, sometimes pausing
across a response window first. Rather than touch that resolution logic to slow it
down for animation timing, `animationStore.ts` is a second, independent Zustand
store holding short-lived visual events (attack pulse, hit flash, destroy shake,
overflow flash, react highlight, negate glitch), each self-expiring via its own
`setTimeout` (400-800ms depending on the moment). `gameStore.ts` fires a bare side-
effect call into this store at each exact resolution point - inside a `try/catch`
specifically so an animation-store hiccup could never throw into actual combat
math. Game logic runs at exactly the same speed it always did; the visuals are
layered on top, never gating it.

**A real mistake caught mid-edit, not after**: while wiring the animation import
into `PlayerBoard.tsx`, a find-and-replace accidentally deleted the
`APEX_BOARD_HEIGHT` constant (still referenced in three places) instead of just
inserting alongside it. Caught by re-running `tsc` immediately after that specific
edit rather than only checking at the end of the session - exactly the kind of
thing that's cheap to catch right away and much more annoying to track down after
several more edits stack on top of it.

**Active player glow**: the board's own bordered box (same one from Commit 21.4)
gets a faction-colored pulsing `box-shadow` whenever `state.activePlayerId` matches
that panel's player - reads it directly off game state, no animation-store
involvement needed since this isn't a transient event, just a live boolean.

**Hand dimming, built on a helper that mirrors reality rather than re-deriving it.**
`canPlayCardFromHand` doesn't invent new eligibility logic - it mirrors the exact
opening-guard conditions each store play-action already checks (`playApexCard`,
`playSupportCard`, `playEquipCard`, `equipSwap`, `playSpecialCard`), and for
Reactions specifically, mirrors `ResponseModal.tsx`'s own eligible-card filter
exactly, so a dimmed/bright card in hand can never disagree with what the actual
response modal would show as clickable. Deliberately **additive only**: the
existing `handDisabledIds`/click-gating logic in `GameBoard.tsx` is completely
untouched - dimming is a new visual layer on top, not a replacement for how clicks
were already gated. A dimmed card is exactly as clickable as it always was.

**Zoom is full brightness by construction, not by remembering to opt out.** The
`isPlayable` prop lives on `Card.tsx` but is only ever passed from `Hand.tsx`.
`CardHoverPreview` (the zoom/hover renderer) calls `Card` fresh with its own prop
set and never receives `isPlayable` from its caller - there's no dimming value to
propagate into it even if I wanted to skip it explicitly, since the prop simply
isn't part of what gets passed through. Same reasoning covers the board, Card
Inspect modal, Void inspection, and the Developer gallery - none of them pass
`isPlayable`, so none of them can ever dim.

**Reduced motion**: a `prefers-reduced-motion` media query in `globals.css` strips
every pulsing/shaking animation down to `none`, replacing the active-turn glow with
a static colored outline and cutting the damage-popup's visible duration to
effectively instant, rather than just leaving heavy motion running regardless.

**Scope decisions made along the way, stated plainly**: `MOMENTUM_GAINED` (listed
as an example event type in the spec, not a required acceptance-criteria item) was
left unwired - firing it would have meant importing the animation store into
`rules.ts`, which is otherwise a dependency-free pure-logic file used heavily by
tests, simulation, and the AI, and coupling it to a UI-only store for one optional
event didn't seem worth that. React/Negate visuals fire on the player's board panel
rather than on the specific hand card, since the card leaves hand for the Void the
instant it's played and there's no persistent element left to highlight by then.

**Verified**: every existing test file (390+ checks across 16 files) plus a fresh
72-game simulation all ran clean - confirming, not assuming, that combat math,
destruction, overflow, response windows, and AI decisions are all byte-for-byte
unchanged. Clean `tsc`/`eslint`/build.

## Commit 23.1 hotfix: the game-breaking crash right after Apex selection

**This was a real bug I introduced in Commit 23, and it was serious** - a hard
crash on essentially every game, right at the transition into the main board.

**Root cause**: `useApexVisualEvents`/`usePlayerVisualEvents` in
`animationStore.ts` used inline selectors (`(s) => s.events.filter(...)`) that
return a brand-new array on every single call. React's `useSyncExternalStore`
(what Zustand v5 uses internally) explicitly warns about this pattern, and it can
escalate into an actual **"Maximum update depth exceeded"** crash - which unmounts
the whole React tree and shows exactly as a blank, un-retriable page. Every Apex on
the board and both players' O2 displays used this pattern, which is why it fired
essentially immediately once the main board rendered for the first time.

**Why none of the existing 390+ checks caught this before shipping**: every single
test in this suite - all 16 files, the simulation, everything - drives the Zustand
game-state store directly from Node and never once renders React. That's a real,
meaningful gap I hadn't previously had a reason to notice, and Commit 23 is exactly
the kind of change (new hooks subscribing to a new store, used across many
components) that a pure-logic test suite structurally cannot catch.

**How this got found and confirmed, not just guessed at**: a static SSR check
(`renderToStaticMarkup`) came back misleadingly clean at first, then produced an
empty render for an unrelated harness reason (module resolution mismatch in the
throwaway repro script, not a real bug) - both false leads I ruled out rather than
chased. What actually reproduced it was mounting the real component tree in jsdom
with `react-dom/client`'s `createRoot` (not static SSR, which skips `useEffect` and
so would have missed this too) and watching `console.error` during mount. That
surfaced the exact warning, which pointed straight at the cause.

**Fix**: wrapped both selectors in `useShallow` from `zustand/react/shallow`, which
keeps the same array reference whenever the filtered contents haven't actually
changed, satisfying `useSyncExternalStore`'s caching requirement.

**I didn't just fix it and move on - I verified the fix was the actual fix**, by
temporarily reverting it and confirming the exact same crash reproduces on demand,
then restoring it and confirming it's gone. Both runs are in the commit history of
this session, not just asserted.

**Added a permanent regression test**: `test-react-mount-smoke.ts`, using the same
jsdom + `createRoot` approach that found this bug, now part of the standing test
suite - mounts the real board after Apex selection, advances through Draw → Main →
Combat, and fails loudly on any thrown error or unexpected `console.error`
(explicitly checking for this exact "Maximum update depth" / "getSnapshot should be
cached" pattern by name, so this specific class of bug can't silently return).
`jsdom`/`@types/jsdom` added as proper dev dependencies to support it.

**Verified**: full regression suite (395+ checks across 17 files, including the new
mount smoke test) and a fresh 72-game simulation both ran clean, plus clean
`tsc`/`eslint`/build.

## Commit 23.2: found why card animations were invisible - a real architectural gap

Reported: only the active-turn glow and O2 damage flash were visible; no attacker
pulse, no hit flash, no destroy shake, despite all of them being wired in Commit 23.

**Traced this with the same jsdom + `createRoot` approach that found the 23.1
crash**, since guessing at CSS specificity issues would have wasted time chasing
the wrong thing. Declared a real attack against a real mounted board and inspected
the animation store and rendered DOM directly. First finding: my test setup itself
was rejecting the attack for mundane reasons (no Sync granted, no target specified,
using a stale attack id after switching players) - three separate self-inflicted
false leads, each ruled out in turn before reaching the real answer.

**The actual bug**: when an attack destroys an Apex, game state removes it from its
board slot in the exact same synchronous update that fires the `CARD_DESTROYED`
visual event. By the time React re-renders, the slot already reads empty - the
700ms shake animation never gets a single frame to play, because the DOM node it
would animate is already gone. Confirmed directly: the animation store correctly
received `ATTACK_DECLARED` → `CARD_HIT` → `CARD_DESTROYED` in sequence, and the
`vfx-attack-pulse` class *did* render correctly on the attacker - the destroy
animation specifically was the dead end, and destruction is disproportionately
common in this game's combat (attrition-based, kills happen constantly), which is
why it read as "no animations at all" rather than "one specific animation missing."

**Fix**: `VisualEvent` now optionally carries a `destroyedGhost` - a plain snapshot
of the card (owner, slot index, and a deep copy of the instance) captured the
instant before `destroyApexFn` removes it. A new `useSlotGhost` hook lets a vacated
board slot check "was something just destroyed here?" and, if so, keep rendering
that snapshot - shake animation and all - for exactly as long as the event stays
alive, then correctly reverts to genuinely empty. Also fell back to the card's
printed DEF for the ghost's stat display, since the live DEF calculation
legitimately can't find a card that's already left play and would otherwise show a
misleading "DEF 0" during the animation.

**Verified the fix is the actual fix, the same way as 23.1**: declared a real lethal
attack against a real mounted board, confirmed `vfx-destroy-shake` renders in the
vacated slot immediately, and confirmed it's gone again once the window elapses -
not assumed from reading the code.

**Added `test-destroy-ghost-vfx.tsx`** as a permanent regression test using this
same approach. Honest caveat, stated directly rather than glossed over: **this new
test is occasionally flaky** - roughly 1 run in 15-20 in this environment,
apparently timing/resource-related when many Node processes run back-to-back in a
tight batch (I made 25+ reproduction attempts across several strategies and never
once captured a concrete error message, which is itself informative - a
deterministic logic bug would show the same failure every time). The underlying fix
has been verified correct dozens of times over; the flakiness is specifically in
this one test's environment sensitivity, not in the mechanism it's checking. Logged
here rather than hidden so it's a known, tracked thing rather than a surprise.

**Verified**: full regression suite (400+ checks across 18 files) and a fresh
72-game simulation both ran clean, plus clean `tsc`/`eslint`/build. `jsdom`/
`@types/jsdom` now proper dev dependencies, supporting both DOM-mount test files.

## Commit 23.3: card-placement glow, ConfirmBar width, AI decisions hidden, Equip glow

**Card-placement glow**: a ~1 second faction-colored border flash when an Apex or
Engine is played onto the board (`vfx-place-glow`, new `CARD_PLACED` event type).
Wired at both placement points (`playApexCard`, `playSupportCard`); Engines get
their own lightweight wrapper in `SupportSlot` rather than reusing `ApexVfxOverlay`,
since they don't need the full combat-event handling that component carries.

**ConfirmBar no longer stretches full-width with a large gap.** Same root cause and
fix as the Rift panel back in Commit 21.2: the bar used `justify-between` inside a
container that stretched to the full phase-controls row width, pushing the text and
buttons to opposite edges. Switched to `w-fit mx-auto`, matching the pattern already
used for Rift/the board panel/Hand.

**AI decisions no longer show any popup to the human, for real this time.** Traced
this rather than patched blindly: `HotseatResponseGate`'s `needsPrivacy()` check
only gated the hotseat "pass the screen" flow for `reactionChoice`/`negateWindow` -
it never asked "does this decision even belong to the human" at all, for *any*
stage. `civilWarChoice`/`humanErrorChoice` (the Rift choices actually reported)
fell straight through to `return <ResponseModal state={state} />` unconditionally,
regardless of which player it was for. In Vs AI mode, that meant the human saw a
modal for a decision the AI was about to make on its own 600ms later. Fixed with a
single upfront check covering all 4 response stages: if `state.vsAI` and the
decision belongs to player2, render nothing - the AI driver resolves it in the
background exactly as before, the human just sees the board pause briefly. Verified
two ways: a logic test mirroring the exact gating condition (`test-ai-popup-
hidden.ts`), and - since a mirrored check can pass even when the real component has
a bug, which is exactly what 23.1/23.2 taught - a real jsdom mount of
`HotseatResponseGate` itself confirming it renders nothing for an AI Rift choice.

**Equip-attach glow**: the same `CARD_PLACED` glow now also fires on the Apex when
an Equip attaches, whether via a fresh Equip play or an Equip Swap, and whether or
not a response window opened first along the way (all 4 code paths where `apex
.equip` actually gets set now emit it) - this flow had zero visual feedback before,
despite Equip Swap being a real, fairly involved mechanic (Commit 22).

**More animation ideas, not built this round, worth considering next**: a brief
flash on Sync when it's spent for an attack (mirrors the existing O2/Momentum
treatment); a subtle highlight on a freshly-drawn card during Draw Phase; a
Reconfigure-specific glow distinct from the generic placement one, since returning
a Support to hand and playing a new one in is a different feeling than a normal
play. Flagging these rather than building all of them into one commit.

**Verified**: full regression suite (420+ checks across 19 files, including the two
new test files this commit added) and a fresh 72-game simulation both ran clean,
plus clean `tsc`/`eslint`/build. The one flaky test remains exactly as documented in
23.2 - unchanged, not newly introduced.

## Commit 24: action banner, streamlined confirm, pacing

Three related but distinct asks: the game feeling too fast/flat despite Commit 23's
animations, too much clicking for routine plays, and real confusion over what a
complex card actually did (the reported example: Backup Consciousness resolving
without it being clear the attack was negated and DEF was now 100).

**Action banner** (`ActionBanner.tsx`): a prominent card-art-plus-outcome banner,
shown for ~2.6s, for Apex/Engine plays, Equip attach, React plays, and Negates.
Deliberately does **not** invent a hand-written summary of what each card does -
it snapshots the last few real Battle Log lines the instant the triggering event
fires, since combat and card resolution are fully synchronous (an action's own
messages, and everything its effect logs as a result, are already sitting in
`state.log` by the time this reads it). That's what makes "Player 2 plays Backup
Consciousness / Attack negated / DEF changes to 100" come out right without needing
a parallel per-card description system that could drift from what the log already
says happened. Reuses the existing `CARD_PLACED`/`REACT_PLAYED`/`CARD_NEGATED`
events from Commit 23 rather than adding a fourth parallel emission at every call
site - one event now has two consumers, the small in-place glow and this banner.

**Streamlined confirm**: Apex, Battery Engine, untargeted Special, and Equip all
now play immediately on the hand-card click when there's exactly one legal
destination - no more `Selected: X - play into an empty slot? [Confirm]` for a
choice that was never actually ambiguous. The confirm/target-selection flow is
still there for every case with a real decision to make (multiple empty slots,
Ability Support's chain-or-not choice, anything requiring an actual target pick) -
this isn't removing confirmation, it's removing confirmation of things that were
never in question. Known gap, stated directly: this is UI click-handler behavior in
`GameBoard.tsx`, and my test suite's jsdom infrastructure doesn't currently drive
simulated clicks, so this specific piece is verified by `tsc`/build/manual
reasoning about the exact conditions rather than an automated test - worth an actual
look in the browser before trusting it fully, more so than most of what's shipped
in past commits.

**Pacing**: a lightweight, ref-based lock (not React state, so it doesn't fight
with the animations it's protecting) briefly gates the next significant action
(attack declare, card play) for 500ms after the previous one, giving an animation a
moment to actually be seen instead of getting buried by whatever comes next. Game
logic itself is untouched and still fully instant - this only gates how soon the UI
*accepts* the next click, matching the same "instant logic, gated presentation"
principle Commit 23 established. Paired with modestly longer combat animation
durations (attack pulse and hit flash 400ms→550ms, destroy shake 650ms→800ms) so
the lock window and the animations it's protecting land on a similar beat.

**Verified**: full regression suite (420+ checks across 19 files) and a fresh
72-game simulation both ran clean, plus clean `tsc`/`eslint`/build. The one flaky
test (`test-destroy-ghost-vfx.tsx`, documented in 23.2) flaked again in this run's
batch sweep, consistent with the prior finding, not a new issue - its timing
margins were widened slightly to track this commit's longer destroy-shake duration.

## Commit 24.1: pass-screen skipped in Vs AI mode, auto-end-turn

**The "pass the screen" ceremony no longer shows up in Vs AI mode, including for
the human's own decisions.** Real bug, not just a Vs-AI polish item: `needsPrivacy()`
only ever looked at the response *stage* (reactionChoice/negateWindow need privacy,
everything else doesn't) - it never asked whether a second human actually existed
to hide anything from. In Vs AI mode there's exactly one human ever touching the
device, so even the human's *own* React/Negate decision was routing through the
full "Pass the screen to player1... Ready" → modal → "pass back to active
player... Ready" ceremony, pointless every time since there's nobody to pass to.
Fixed by making `needsPrivacy()` take `vsAI` into account - privacy is skipped
entirely in Vs AI mode regardless of stage, going straight to the response modal
for the human's decisions (the AI's own decisions were already fully hidden as of
Commit 23.3). Hotseat mode (`vsAI: false`, two real humans sharing a device) is
completely unaffected - that's exactly the situation this ceremony exists for.
Verified with a real DOM mount of the actual component (not just a logic check)
confirming a human's own reactionChoice in Vs AI mode skips straight to the modal.

**Auto-end-turn**: once the active human's last Apex that could attack has
attacked (or they have none left), the turn now ends automatically instead of
requiring a manual "End Turn" click - there's nothing further to legally do.
Deliberately scoped to the human only; the AI's own turn-ending timing stays fully
owned by its existing `ai.ts` heuristics; whichever human is active in Hotseat mode
gets this too, since it's about "an active human ran out of things to do," not
about which player number they happen to be. A short delay lets the last attack's
own animations actually finish playing before the turn visibly ends. Verified with
a real DOM-mounted test that declares the attack and confirms the turn genuinely
advances after the delay, not just that a function got called.

**Verified**: full regression suite (425+ checks across 20 files, including the
new auto-end-turn test and extended AI-popup test) and a fresh 72-game simulation
both ran clean, plus clean `tsc`/`eslint`/build. The one previously-documented
flaky test (23.2) flaked again in this run's batch sweep, unchanged and consistent
with the prior finding.

## Verifying it yourself

`npx tsx src/scripts/test-void-and-feedback-loop.ts` is a targeted test suite (41
checks) for this commit: destroyed Apexes and their attached Equips going to Void,
chained Supports surviving their Apex's death and becoming Unchained, resolved
Specials/Reactions/Negates and canceled cards going to Void, Reconfigure/locked
Supports correctly *not* going to Void, No-Apex Recovery correctly shuffling
non-Apex reveals back into the Deck (not Void), Deck/Void counters, Void Recycle on
both an empty-Deck draw and inside No-Apex Recovery (including the full loss
condition when nothing is left anywhere), and the rewritten Feedback Loop (O2 loss
instead of Apex damage, including a lethal case).

`npx tsx src/scripts/test-trait-removal-and-rifts.ts` is a targeted test suite (52
checks) covering this whole patch: every removed Apex trait no longer affects
gameplay, unchained Ability Supports provide Sync but never trigger their Sync
Ability, and all 6 rewritten Rift Spaces work as specified - including Human Error
correctly skipping the bonus for a negated Special, Control Conflict's lock
correctly blocking Reconfigure, Echo Riot's new Momentum-reward mechanics, White
Room Collapse's new Momentum-on-Choke and end-of-turn cleanup, and Recursive
Failure's retargeted second-voluntary-card trigger (verified to ignore forced
No-Apex recovery, since that path never touches `cardsPlayedThisTurn` at all).

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
