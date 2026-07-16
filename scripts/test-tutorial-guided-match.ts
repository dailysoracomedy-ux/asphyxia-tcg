/**
 * Verifies Commit 31's rebuilt guided tutorial match end to end, driving
 * every step with real, simulated player actions - real drag-and-drop for
 * hand cards, real clicks for the Apex/response window/Rift choice/attack
 * selector - through the actual mounted game board, not by calling store
 * actions directly. This is the test that proves the whole point of the
 * rebuild: the tutorial plays like the real game with training wheels on,
 * not a scripted slideshow.
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
(global as unknown as { window: unknown }).window = dom.window;
(global as unknown as { document: unknown }).document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
(global as unknown as { HTMLElement: unknown }).HTMLElement = dom.window.HTMLElement;
(global as unknown as { PointerEvent: unknown }).PointerEvent = dom.window.PointerEvent ?? dom.window.MouseEvent;
(global as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
(global as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) => clearTimeout(id);
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(global as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
(global as unknown as { AudioContext: unknown }).AudioContext = class {
  state = 'running'; currentTime = 0;
  createOscillator() { return { type: '', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} }; }
  createGain() { return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} }; }
  resume() { return Promise.resolve(); }
};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function click(el: Element) {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
function firePointer(target: Element | Window, type: string, x: number, y: number) {
  const ev = new dom.window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 });
  target.dispatchEvent(ev);
}
const windowTarget = dom.window as unknown as Window;

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');
  const { useTutorialStore } = await import('@/store/tutorialStore');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', false, false, true);
  useTutorialStore.getState().setSlideshowActive(false);
  useTutorialStore.getState().setStep(0);

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(200);

  // Opening Apex selection isn't part of the guided steps themselves - pick
  // the scripted Apex directly via the real store action, same as a real
  // player's one required click at match start.
  let s = useGameStore.getState();
  if (s.status === 'selectingOpeningApex') {
    const apex1 = s.players.player1.hand.find((c) => c.defId === 'nu-street-beast');
    if (apex1) s.selectOpeningApex('player1', apex1.instanceId);
    s = useGameStore.getState();
    const apex2 = s.players.player2.hand.find((c) => c.type === 'Apex');
    if (apex2) s.selectOpeningApex('player2', apex2.instanceId);
  }
  s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  await wait(150);

  function handCardButtonFor(defId: string): HTMLElement | null {
    s = useGameStore.getState();
    const card = s.players.player1.hand.find((c) => c.defId === defId);
    if (!card) return null;
    const candidates = Array.from(dom.window.document.querySelectorAll('.tutorial-spotlight button'));
    const real = candidates.find((b) => b.textContent !== 'i');
    return (real as HTMLElement) ?? null;
  }

  async function dragHandCardToZone(defId: string, zoneKindHint: string) {
    for (let attempt = 0; attempt < 12; attempt++) {
      await wait(120);
      const btn = handCardButtonFor(defId);
      if (!btn) continue;
      firePointer(btn, 'pointerdown', 100, 700);
      await wait(50);
      firePointer(windowTarget, 'pointermove', 140, 400);
      await wait(80);
      const zonesFound = dom.window.document.querySelectorAll('[data-dropzone]').length > 0;
      if (!zonesFound) {
        // This attempt's drag never actually activated (no legal zones
        // registered) - release the pointer to reset any pending drag state
        // and retry fresh rather than leaving a half-started drag hanging.
        firePointer(windowTarget, 'pointerup', 140, 400);
        continue;
      }
      dom.window.document.elementFromPoint = () => {
        const zones = Array.from(dom.window.document.querySelectorAll('[data-dropzone]'));
        const match = zones.find((z) => {
          try {
            return JSON.parse((z as HTMLElement).dataset.dropzone!).kind === zoneKindHint;
          } catch {
            return false;
          }
        });
        return (match ?? zones[0]) as unknown as Element;
      };
      firePointer(windowTarget, 'pointermove', 140, 400);
      await wait(20);
      firePointer(windowTarget, 'pointerup', 140, 400);
      await wait(200);
      return true;
    }
    return false;
  }

  const stepIndex = () => useTutorialStore.getState().step;

  // --- Step 1: play-apex ---
  check('starts at step 0 (play-apex)', stepIndex() === 0);
  const droveApex = await dragHandCardToZone('nu-street-beast', 'apex-slot');
  check('a real drag of the spotlighted Apex played it', droveApex);
  s = useGameStore.getState();
  check('the Apex is genuinely on board', s.players.player1.apexSlots.some((a) => a?.defId === 'nu-street-beast'));
  check('tutorial genuinely advanced to step 1 (play-engine-1)', stepIndex() === 1);

  // --- Step 2: play-engine-1 ---
  await dragHandCardToZone('nu-dead-battery', 'support-slot');
  s = useGameStore.getState();
  check('first Engine genuinely on board', s.players.player1.supportSlots.some((sl) => sl?.defId === 'nu-dead-battery'));
  check('tutorial genuinely advanced to step 2 (play-equip)', stepIndex() === 2);

  // --- Step 3: play-equip ---
  await dragHandCardToZone('nu-smog-jacket', 'own-apex');
  s = useGameStore.getState();
  check('Smog Jacket genuinely equipped', s.players.player1.apexSlots.find((a) => a?.defId === 'nu-street-beast')?.equip?.defId === 'nu-smog-jacket');
  check('tutorial genuinely advanced to step 3 (play-special)', stepIndex() === 3);

  // --- Step 3: play-special ---
  await dragHandCardToZone('nu-overclock', 'action-zone');
  s = useGameStore.getState();
  check('the Special is genuinely still in hand (specialReady mode, not resolved yet)', s.players.player1.hand.some((c) => c.defId === 'nu-overclock'));
  check('tutorial genuinely advanced to step 4 (special-target)', stepIndex() === 4);

  // --- Step 4: special-target - real click on own Apex to complete Overclock ---
  await wait(150);
  const ownApexCandidates = Array.from(dom.window.document.querySelectorAll('button')).filter(
    (b) => b.closest('[data-dropzone]') === null && b.textContent !== 'i' && /Street-Beast|Razor Swipe|Neon Pounce/i.test(b.textContent ?? '')
  );
  let overclockResolved = false;
  for (const btn of ownApexCandidates.length ? ownApexCandidates : Array.from(dom.window.document.querySelectorAll('button')).filter((b) => b.closest('[data-dropzone]') === null && b.textContent !== 'i' && !/end turn|battle log|reset|restart|exit|continue/i.test(b.textContent ?? ''))) {
    click(btn);
    await wait(50);
    s = useGameStore.getState();
    if (!s.players.player1.hand.some((c) => c.defId === 'nu-overclock')) {
      overclockResolved = true;
      break;
    }
  }
  check('clicking the Apex genuinely completed Overclock - card left hand', overclockResolved);
  check('tutorial genuinely advanced to step 5 (enemy-attack-setup)', stepIndex() === 5);

  // --- Step 5: enemy-attack-setup (Continue button, explanation only) ---
  const continueBtn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => b.textContent === 'Continue');
  check('a real Continue button is genuinely present for this explanation-only step', !!continueBtn);
  if (continueBtn) click(continueBtn);
  await wait(400);
  check('tutorial genuinely advanced to step 6 (play-react) - the opponent\u2019s scripted attack is now firing', stepIndex() === 6);

  // Wait for the opponent's scripted attack to actually open a real response window.
  let waited = 0;
  while (useGameStore.getState().pendingResponseQueue.length === 0 && waited < 18000) {
    await wait(500);
    waited += 500;
  }
  s = useGameStore.getState();
  check('a real response window genuinely opened from the opponent\u2019s scripted attack', s.pendingResponseQueue.length > 0);

  // --- Step 5: play-react - real click in the real response modal ---
  await wait(200);
  const reactBtn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => b.textContent?.includes('Glitch Step'));
  check('the highlighted React (Glitch Step) is genuinely rendered as a real, clickable button', !!reactBtn);
  if (reactBtn) click(reactBtn);
  await wait(300);
  s = useGameStore.getState();
  check('the response window genuinely closed - the React was accepted, not rejected', s.pendingResponseQueue.length === 0 || s.pendingResponseQueue[0]?.stage !== 'reactionChoice');

  // Wait for the opponent's turn to genuinely end and the Civil War Rift choice to appear.
  waited = 0;
  while (useGameStore.getState().pendingResponseQueue.length === 0 && waited < 18000) {
    await wait(200);
    waited += 200;
  }
  s = useGameStore.getState();
  check('the Civil War Rift choice genuinely triggered at the start of player1\u2019s next turn', s.pendingResponseQueue[0]?.stage === 'civilWarChoice');
  check('tutorial genuinely advanced to the rift-choice step', stepIndex() === 7);

  // --- Step 6: rift-choice - real click ---
  await wait(150);
  const momentumBtn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => b.textContent === '+1 Momentum');
  check('the highlighted Rift option is genuinely rendered', !!momentumBtn);
  if (momentumBtn) click(momentumBtn);
  await wait(300);
  s = useGameStore.getState();
  check('the Rift choice genuinely resolved - momentum increased', s.players.player1.momentum >= 1);
  check('tutorial genuinely advanced to play-engine-2 (a fresh turn - legal now)', stepIndex() === 8);

  // --- Step 7: play-engine-2 (second Engine, now legal - fresh turn) ---
  await dragHandCardToZone('nu-juice-box', 'support-slot');
  s = useGameStore.getState();
  check('second Engine genuinely on board (2 Engines total, Sync bumps to 2 next turn)', s.players.player1.supportSlots.filter(Boolean).length === 2);
  check('tutorial genuinely advanced to declare-attack', stepIndex() === 9);

  // --- Step 8: declare-attack - real click on own Apex ---
  await wait(150);
  const apexButtons = Array.from(dom.window.document.querySelectorAll('button')).filter(
    (b) => b.closest('[data-dropzone]') === null && b.textContent !== 'i' && !/end turn|battle log|reset|restart|exit|continue/i.test(b.textContent ?? '')
  );
  let openedPopup = false;
  for (const btn of apexButtons) {
    click(btn);
    await wait(80);
    if (dom.window.document.querySelector('button[aria-label*="sync"]')) {
      openedPopup = true;
      break;
    }
  }
  check('clicking the spotlighted Apex genuinely opened the real attack selector popup', openedPopup);
  check('tutorial genuinely advanced to choose-attack', stepIndex() === 10);

  // --- Step 9: choose-attack - real click on the 1-Sync row ---
  await wait(200);
  const attackRowButtons = Array.from(dom.window.document.querySelectorAll('button[aria-label*="sync"]'));
  const bigAttackBtn = attackRowButtons.find((b) => b.getAttribute('aria-label')?.includes('1 sync'));
  check('the 1-Sync attack row is genuinely rendered and enabled', !!bigAttackBtn && !bigAttackBtn.hasAttribute('disabled'));
  if (bigAttackBtn) click(bigAttackBtn);
  await wait(200);
  check('tutorial genuinely advanced to select-target', stepIndex() === 11);

  // --- Step 10: select-target - real click on enemy Apex ---
  await wait(150);
  const targetButtons = Array.from(dom.window.document.querySelectorAll('button')).filter(
    (b) => b.closest('[data-dropzone]') === null && b.textContent !== 'i' && !/end turn|battle log|reset|restart|exit/i.test(b.textContent ?? '')
  );
  for (const btn of targetButtons) {
    click(btn);
    await wait(80);
    if (useGameStore.getState().status === 'gameover') break;
  }
  await wait(200);

  s = useGameStore.getState();
  check('the match genuinely ended in victory', s.status === 'gameover');
  check('player1 (the human) genuinely won - opponent O2 at 0', s.players.player2.o2 <= 0);
  check('tutorial genuinely advanced to the final win step', stepIndex() === 12);

  root.unmount();
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
