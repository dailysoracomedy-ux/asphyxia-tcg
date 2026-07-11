/**
 * Verifies Commit 29.1's tutorial gating logic and scripted setup.
 *
 * Honest scope note: this tests tutorialActionMatches() directly (the exact
 * function GameBoard.tsx's blockedByTutorial() calls to decide block/allow) and
 * the scripted deck/hand setup, plus a DOM mount check that the locked panel
 * renders correctly and Next is hidden on action steps. It does NOT simulate an
 * actual wrong click through GameBoard.tsx's real handlers end-to-end - this
 * project's test harness doesn't have a DOM click-simulation tool (no
 * @testing-library/react fireEvent equivalent installed), so the gating
 * function itself - the exact logic every handler calls - is verified directly
 * instead. This is the same category of gap flagged honestly for Commit 24's
 * streamlined-confirm behavior.
 */
import { JSDOM } from 'jsdom';

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
(global as unknown as { matchMedia: unknown }).matchMedia = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
});
(global as unknown as { AudioContext: unknown }).AudioContext = class {
  state = 'running';
  currentTime = 0;
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} };
  }
  createGain() {
    return {
      gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => {},
    };
  }
  resume() {
    return Promise.resolve();
  }
};

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

async function main() {
  const { tutorialActionMatches, tutorialActionNeedsExplicitAdvance } = await import('@/tutorial/tutorialGate');
  const { TUTORIAL_STEPS } = await import('@/tutorial/tutorialSteps');

  // --- Step 5 fix: "click Street-Beast, attack menu opens, tutorial doesn't
  //     advance" was a real reported bug - selectAttacker/chooseAttack only ever
  //     change local UI mode, never anything in GameState, so a GameState-
  //     watching autoAdvanceWhen has nothing to detect for them. ---
  check('selectAttacker is flagged as needing explicit step-advancement (the actual Step 5 bug)', tutorialActionNeedsExplicitAdvance('selectAttacker'));
  check('chooseAttack is flagged as needing explicit step-advancement (the same bug, one step later)', tutorialActionNeedsExplicitAdvance('chooseAttack'));
  check('playApex is NOT flagged - it has a real GameState signal (apexSlots) and should never double-advance', !tutorialActionNeedsExplicitAdvance('playApex'));
  const selectAttackerSteps = TUTORIAL_STEPS.filter((s) => s.requiredAction.type === 'selectAttacker' || s.requiredAction.type === 'chooseAttack');
  check(
    'every selectAttacker/chooseAttack step in the actual script genuinely has no autoAdvanceWhen (confirming the bug diagnosis, not just the fix)',
    selectAttackerSteps.length > 0 && selectAttackerSteps.every((s) => !s.autoAdvanceWhen)
  );

  // --- Core gating logic (the exact function every GameBoard.tsx handler calls) ---
  check(
    'playing the WRONG Apex during the "play Street-Beast" step does not match',
    !tutorialActionMatches({ type: 'playApex', defId: 'nu-riot-runner' }, { type: 'playApex', defId: 'nu-street-beast' })
  );
  check(
    'playing the CORRECT Apex during the "play Street-Beast" step matches',
    tutorialActionMatches({ type: 'playApex', defId: 'nu-street-beast' }, { type: 'playApex', defId: 'nu-street-beast' })
  );
  check(
    'trying to play an Engine during a "play this Apex" step does not match (wrong action type entirely)',
    !tutorialActionMatches({ type: 'playEngine', defId: 'nu-dead-battery' }, { type: 'playApex', defId: 'nu-street-beast' })
  );
  check(
    'choosing the wrong attack during "choose Neon Pounce" does not match',
    !tutorialActionMatches({ type: 'chooseAttack', attackId: 'razor-swipe' }, { type: 'chooseAttack', attackId: 'neon-pounce' })
  );
  check(
    'choosing the correct attack matches',
    tutorialActionMatches({ type: 'chooseAttack', attackId: 'neon-pounce' }, { type: 'chooseAttack', attackId: 'neon-pounce' })
  );
  check(
    'a step requiring "any" attack accepts any attack id (the buffed-attack step)',
    tutorialActionMatches({ type: 'chooseAttack', attackId: 'backstreet-maul' }, { type: 'chooseAttack', attackId: 'any' })
  );
  check(
    'playing the wrong React during the react-window step does not match',
    !tutorialActionMatches({ type: 'playReact', defId: 'nu-feedback-loop' }, { type: 'playReact', defId: 'nu-glitch-step' })
  );

  // --- Step list sanity: every card the script names actually exists as a real card ---
  const { getCardDef } = await import('@/data/cards');
  const namedDefIds = TUTORIAL_STEPS.flatMap((s) => {
    const a = s.requiredAction;
    return 'defId' in a ? [a.defId] : [];
  });
  let allCardsExist = true;
  for (const defId of namedDefIds) {
    try {
      getCardDef(defId);
    } catch {
      allCardsExist = false;
      console.log(`    missing card: ${defId}`);
    }
  }
  check('every card the tutorial script names by id actually exists in the real card pool', allCardsExist);

  // --- Only 2 of 17 steps are "passive" (ack) and show a skippable Next button;
  //     everything else is gated on a real action, matching "locked, not free reign".
  const ackSteps = TUTORIAL_STEPS.filter((s) => s.requiredAction.type === 'ack').length;
  const gatedSteps = TUTORIAL_STEPS.filter((s) => s.requiredAction.type !== 'ack' && s.requiredAction.type !== 'waitForOpponent' && s.requiredAction.type !== 'win').length;
  check('the large majority of steps require a real gated action, not just a Next click', gatedSteps > ackSteps * 2);

  // --- Scripted deck setup ---
  const { useGameStore } = await import('@/store/gameStore');
  useGameStore.getState().startNewGame('Synth Ascendancy', 'Synth Ascendancy', false, false, true);
  const s = useGameStore.getState();
  const hand1 = s.players.player1.hand.map((c) => c.defId);
  check('player1\'s scripted opening hand contains Street-Beast', hand1.includes('nu-street-beast'));
  check('player1\'s scripted opening hand contains Dead Battery', hand1.includes('nu-dead-battery'));
  check('player1\'s scripted opening hand contains Plasma Edge', hand1.includes('nu-plasma-edge'));
  check('player1\'s scripted opening hand contains Overclock', hand1.includes('nu-overclock'));
  const nextFewDraws = s.players.player1.deck.slice(0, 2).map((c) => c.defId);
  check(
    'Glitch Step is guaranteed to show up early (opening hand or the very next draws), not left to chance',
    hand1.includes('nu-glitch-step') || nextFewDraws.includes('nu-glitch-step')
  );
  check('Static Jack is guaranteed among player1\'s next draws (not left to chance)', nextFewDraws.includes('nu-static-jack'));
  check(
    'player2 (scripted opponent) has Enforcer-V4 placed at match start - matches Neon Pounce exactly for a real clean break (Commit 29.13)',
    s.players.player2.apexSlots[0]?.defId === 'dw-enforcer-v4'
  );

  // --- Real DOM mount: confirm the locked panel actually renders and Next is
  //     hidden on the very first action-gated step (play-apex), not just present
  //     on every step regardless. ---
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { default: GameBoard } = await import('@/components/GameBoard');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 80));

  const html1 = container.innerHTML;
  check('the tutorial panel renders during the welcome step', html1.includes('Learn To Play') && html1.includes('Continue'));

  const { useTutorialStore } = await import('@/store/tutorialStore');
  useTutorialStore.getState().setStep(1); // play-apex, a real gated step
  await new Promise((r) => setTimeout(r, 150));
  const html2 = container.innerHTML;
  check('Next/Continue is hidden on a gated action step (Play an Apex) - only "follow the instruction" text shows', !html2.includes('>Continue<') && html2.includes('locked during this step'));

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
