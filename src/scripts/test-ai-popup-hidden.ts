/**
 * Verifies HotseatResponseGate never shows anything to the human when a pending
 * decision belongs to the AI (Commit 23.3) - covers all 4 response stages, not
 * just the Rift ones that were originally reported. Before this fix, civilWarChoice
 * and humanErrorChoice unconditionally rendered ResponseModal regardless of which
 * player the choice belonged to, since needsPrivacy() only gated the hotseat
 * pass-screen flow for reactionChoice/negateWindow - it never considered "is this
 * even the human's decision to make" at all.
 *
 * A pure logic test (no DOM needed here) - this checks the actual gating condition
 * HotseatResponseGate uses (state.vsAI + which player the item belongs to), mirrored
 * exactly rather than re-derived, so it can't quietly drift from what the component
 * really does.
 */
import { useGameStore } from '../store/gameStore';
import type { PendingResponseItem, PlayerId } from '../types/game';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

// Mirrors HotseatResponseGate's own respondingPlayerOf + gating condition exactly -
// if this function's logic ever needs to change, the component's matching logic
// must change with it, keeping this test meaningful rather than trivially true.
function respondingPlayerOf(item: PendingResponseItem): PlayerId {
  if (item.stage === 'reactionChoice') return item.respondingPlayerId;
  if (item.stage === 'negateWindow') return item.negatingPlayerId;
  return item.playerId;
}
function shouldHideFromHuman(item: PendingResponseItem, vsAI: boolean): boolean {
  return vsAI && respondingPlayerOf(item) === 'player2';
}

// Construct a minimal representative item for each of the 4 stages - only the
// fields respondingPlayerOf actually reads need to be real.
const reactionItem = { stage: 'reactionChoice', respondingPlayerId: 'player2' } as unknown as PendingResponseItem;
const negateItem = { stage: 'negateWindow', negatingPlayerId: 'player2' } as unknown as PendingResponseItem;
const civilWarItem = { stage: 'civilWarChoice', playerId: 'player2' } as unknown as PendingResponseItem;
const humanErrorItem = { stage: 'humanErrorChoice', playerId: 'player2' } as unknown as PendingResponseItem;

check('reactionChoice for the AI is hidden in Vs AI mode', shouldHideFromHuman(reactionItem, true));
check('negateWindow for the AI is hidden in Vs AI mode', shouldHideFromHuman(negateItem, true));
check('civilWarChoice for the AI is hidden in Vs AI mode (the originally reported bug)', shouldHideFromHuman(civilWarItem, true));
check('humanErrorChoice for the AI is hidden in Vs AI mode (the originally reported bug)', shouldHideFromHuman(humanErrorItem, true));

const reactionItemP1 = { stage: 'reactionChoice', respondingPlayerId: 'player1' } as unknown as PendingResponseItem;
const civilWarItemP1 = { stage: 'civilWarChoice', playerId: 'player1' } as unknown as PendingResponseItem;
check('a decision belonging to the human (player1) is never hidden in Vs AI mode', !shouldHideFromHuman(reactionItemP1, true));
check('a Rift choice belonging to the human (player1) is never hidden in Vs AI mode', !shouldHideFromHuman(civilWarItemP1, true));

check('nothing is hidden in Hotseat mode (vsAI=false), even for "player2"', !shouldHideFromHuman(civilWarItem, false));
check('nothing is hidden in Hotseat mode for reactionChoice either', !shouldHideFromHuman(reactionItem, false));

// Sanity-check against the real store: Vs AI games actually set vsAI=true, so the
// gating condition above is checking a real, live field, not a stale assumption.
useGameStore.getState().startNewGame('Dark White', 'Neon Underground', true);
check('startNewGame(..., true) actually sets state.vsAI = true', useGameStore.getState().vsAI === true);
useGameStore.getState().startNewGame('Dark White', 'Neon Underground', false);
check('startNewGame(..., false) actually sets state.vsAI = false', useGameStore.getState().vsAI === false);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);

// Also confirm the REAL component, not just this mirrored logic, actually renders
// nothing - a logic-only test can pass even if the component itself has a bug, if
// the mirror happens to encode the same mistake. This is exactly the category of
// gap that let the original bug ship - Commit 23.1/23.2 both turned out to be real
// component-rendering bugs invisible to pure logic tests.
async function domCheck() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  (global as unknown as { window: unknown }).window = dom.window;
  (global as unknown as { document: unknown }).document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  (global as unknown as { HTMLElement: unknown }).HTMLElement = dom.window.HTMLElement;
  (global as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
  (global as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) => clearTimeout(id);
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (global as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });

  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { default: HotseatResponseGate } = await import('../components/HotseatResponseGate');

  const fakeState = {
    vsAI: true,
    activePlayerId: 'player2',
    pendingResponseQueue: [{ id: 'x', stage: 'civilWarChoice', playerId: 'player2' }],
  } as unknown as import('../types/game').GameState;

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(HotseatResponseGate, { state: fakeState }));
  await new Promise((r) => setTimeout(r, 30));

  const componentPassed = container.innerHTML.trim().length === 0;
  console.log(`  ${componentPassed ? 'PASS' : 'FAIL'}: the real HotseatResponseGate component renders nothing for an AI civilWarChoice`);

  // Commit 24.1: a HUMAN's own response in Vs AI mode should skip the pass-screen
  // ceremony entirely (there's no second human to hide anything from) and go
  // straight to the response modal.
  const humanReactionState = {
    vsAI: true,
    activePlayerId: 'player2',
    pendingResponseQueue: [
      {
        id: 'y',
        stage: 'reactionChoice',
        respondingPlayerId: 'player1',
        trigger: { kind: 'opponentAttackDealsO2Damage', amount: 200, isOverflow: false },
      },
    ],
    players: { player1: { hand: [], momentum: 0 } },
  } as unknown as import('../types/game').GameState;
  root.render(React.createElement(HotseatResponseGate, { state: humanReactionState }));
  await new Promise((r) => setTimeout(r, 30));
  const html = container.innerHTML;
  const skippedPassScreen = !html.includes('Pass the screen');
  const showedModal = html.includes('Response Window');
  console.log(`  ${skippedPassScreen ? 'PASS' : 'FAIL'}: a human's own reactionChoice in Vs AI mode skips the pass-screen`);
  console.log(`  ${showedModal ? 'PASS' : 'FAIL'}: a human's own reactionChoice in Vs AI mode shows the response modal directly`);

  root.unmount();
  process.exit(failed > 0 || !componentPassed || !skippedPassScreen || !showedModal ? 1 : 0);
}
domCheck();
