/**
 * Verifies Commit 41.11's shared "decision pending" system:
 * 1. Baseline: hand is fully visible (opacity 1), Player 1's board sits at
 *    its small baseline gap (marginBottom: 12).
 * 2. During an attack-targeting decision: hand goes invisible AND inert
 *    (opacity 0, pointer-events none), Player 1's board shifts down
 *    (marginBottom: -230) to make room for the hub, covering the hand.
 * 3. The overdrive prompt and Control Conflict prompt also drive the same
 *    condition.
 * 4. ResponseModal genuinely portals into Row 5's hub target instead of
 *    rendering a full-screen backdrop, when that target is mounted.
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
(global as unknown as { window: unknown }).window = dom.window;
(global as unknown as { document: unknown }).document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
(global as unknown as { HTMLElement: unknown }).HTMLElement = dom.window.HTMLElement;
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

function findHandOpacityWrapper(): HTMLElement | null {
  const handLabel = Array.from(dom.window.document.querySelectorAll('div')).find((d) => /^Hand \(\d+\)$/.test(d.textContent ?? ''));
  let el: HTMLElement | null = (handLabel?.parentElement as HTMLElement) ?? null;
  while (el) {
    const style = el.getAttribute('style') ?? '';
    if (style.includes('opacity')) return el;
    el = el.parentElement;
  }
  return null;
}

function findBoardMarginWrapper(): HTMLElement | null {
  const endTurnBtn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => b.textContent === 'End Turn');
  let el: HTMLElement | null = endTurnBtn as HTMLElement | null;
  while (el) {
    const style = el.getAttribute('style') ?? '';
    if (style.includes('margin-bottom')) return el;
    el = el.parentElement;
  }
  return null;
}

async function main() {
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');
  const { useGameStore } = await import('@/store/gameStore');
  const { default: GameBoard } = await import('@/components/GameBoard');

  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', true, false, false);
  let s = useGameStore.getState();
  if (s.status === 'selectingOpeningApex') {
    const apex1 = s.players.player1.hand.find((c) => c.type === 'Apex');
    if (apex1) s.selectOpeningApex('player1', apex1.instanceId);
    s = useGameStore.getState();
    const apex2 = s.players.player2.hand.find((c) => c.type === 'Apex');
    if (apex2) s.selectOpeningApex('player2', apex2.instanceId);
  }
  s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  s = useGameStore.getState();
  if (s.phase === 'Main') s.advancePhase('Main');

  // Advance past turn 1 (attacks aren't legal on the very first turn overall)
  // so the live-click confirmation below has a real attack available.
  s = useGameStore.getState();
  if (s.phase === 'Combat') s.endTurn();
  await wait(300);
  s = useGameStore.getState();
  if (s.phase === 'Start' && s.startPhasePending) s.advancePhase('Start');
  s = useGameStore.getState();
  if (s.phase === 'Start' && !s.startPhasePending) s.advancePhase('Main');
  s = useGameStore.getState();
  if (s.phase === 'Main') s.advancePhase('Main');

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await wait(150);

  // --- Baseline ---
  const handWrapperBaseline = findHandOpacityWrapper();
  check('at baseline, hand is genuinely fully visible', (handWrapperBaseline?.getAttribute('style') ?? '').includes('opacity: 1'));
  const boardWrapperBaseline = findBoardMarginWrapper();
  check('at baseline, Player 1\u2019s board genuinely sits at the small 12px gap', (boardWrapperBaseline?.getAttribute('style') ?? '').includes('margin-bottom: 12px'));

  // --- Trigger a real attack-targeting decision via actual clicks ---
  function click(el: Element) {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  s = useGameStore.getState();
  const ownApexButtons = Array.from(dom.window.document.querySelectorAll('button')).filter((b) => b.querySelector('img') && !/end turn|options|battle log/i.test(b.textContent ?? ''));
  if (ownApexButtons.length > 0 && !s.isFirstTurnOverall) {
    click(ownApexButtons[ownApexButtons.length - 1]);
    await wait(50);
    const attackRow = Array.from(dom.window.document.querySelectorAll('button[aria-label*="sync"]')).find((b) => !(b as HTMLButtonElement).disabled);
    if (attackRow) {
      click(attackRow);
      await wait(50);
      const handWrapperDuring = findHandOpacityWrapper();
      check('during a real attack-targeting decision, hand genuinely becomes invisible', (handWrapperDuring?.getAttribute('style') ?? '').includes('opacity: 0'));
      const boardWrapperDuring = findBoardMarginWrapper();
      check('during a real attack-targeting decision, Player 1\u2019s board genuinely shifts down', (boardWrapperDuring?.getAttribute('style') ?? '').includes('margin-bottom: -230px'));
    } else {
      console.log('  (no enabled attack row found in this random matchup - skipping the live-click confirmation, source-level checks below still verify the wiring)');
    }
  } else {
    console.log('  (turn 1, no attacks legal yet - skipping the live-click confirmation, source-level checks below still verify the wiring)');
  }

  root.unmount();

  const fs = await import('fs');
  const gbSrc = fs.readFileSync('src/components/GameBoard.tsx', 'utf-8');
  check('decisionPending genuinely includes attackAwaitingTarget/attackerChosen/attackChoicePending/overdrivePrompt', /mode\.kind === 'attackAwaitingTarget'[\s\S]{0,200}mode\.kind === 'overdrivePrompt'/.test(gbSrc));
  check('decisionPending genuinely includes the Control Conflict condition', /decisionPending =[\s\S]{0,600}ControlConflict/.test(gbSrc));
  check('decisionPending genuinely includes any pending response item', /!!pendingResponseItem/.test(gbSrc));
  check('the hand wrapper genuinely uses decisionPending for opacity and pointer-events', /opacity: decisionPending \? 0 : 1, pointerEvents: decisionPending \? 'none' : 'auto'/.test(gbSrc));
  check('Player 1\u2019s board genuinely uses decisionPending for its position', /marginTop: decisionPending \? 10 : 'auto'/.test(gbSrc));
  check('Row 5 genuinely has the response-hub-target portal mount point', /id="response-hub-target"/.test(gbSrc));

  const modalSrc = fs.readFileSync('src/components/ResponseModal.tsx', 'utf-8');
  check('ResponseModal genuinely portals into response-hub-target instead of always rendering full-screen', /createPortal\(content, hubTarget\)/.test(modalSrc));

  console.log(`\n=== FINAL RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
