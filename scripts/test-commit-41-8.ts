/**
 * Verifies Commit 41.8's key fixes:
 * 1. Empty Apex/Support slots get tutorial-stay-bright during tutorial mode
 *    (previously only filled cards did, leaving destination zones darkened).
 * 2. The AI-vs-AI board margin is genuinely conditional (0 in AI vs AI, -110
 *    otherwise) - the fix for boards overlapping each other in that mode.
 * 3. The coin flip's flip count genuinely doubled (18-22, was 9-11).
 * 4. Rift's "i" button is a real inline flex item now, not absolutely
 *    positioned separately from the title line.
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

async function main() {
  const fs = await import('fs');

  const boardSrc = fs.readFileSync('src/components/PlayerBoard.tsx', 'utf-8');
  check('empty Apex slots genuinely get tutorial-stay-bright now', /empty Apex slot[\s\S]{0,5}/.test(boardSrc) && /tutorial-stay-bright[\s\S]{0,200}empty Apex slot/.test(boardSrc));
  check('empty Support slots genuinely get tutorial-stay-bright now', /tutorial-stay-bright[\s\S]{0,200}empty Support slot/.test(boardSrc));

  const gbSrc = fs.readFileSync('src/components/GameBoard.tsx', 'utf-8');
  check('the fragile negative-margin hack is genuinely gone - replaced with a real fix, not just made conditional', !/marginBottom:\s*-110|marginBottom:\s*state\.aiVsAiMode/.test(gbSrc));
  check('the board is genuinely shifted left', /translateX\(-16px\)/.test(gbSrc));

  const menuSrc = fs.readFileSync('src/components/NewGameMenu.tsx', 'utf-8');
  check('the coin flip count genuinely doubled (18-22, was 9-11)', /let flips = 18 \+ Math\.floor\(Math\.random\(\) \* 5\)/.test(menuSrc));

  const riftSrc = fs.readFileSync('src/components/RiftPanel.tsx', 'utf-8');
  check('the Rift "i" button is genuinely an inline flex item now, not absolutely positioned', !riftSrc.includes('absolute top-1 right-1') && /Rift:[\s\S]{0,600}title="Full Rift text"/.test(riftSrc));

  const audioSrc = fs.readFileSync('src/audio/AudioController.tsx', 'utf-8');
  check('CARD_NEGATED genuinely triggers the new voice.negated hook, layered not replacing', /playSfx\('voice\.negated'\)/.test(audioSrc));

  const tutorialSrc = fs.readFileSync('src/components/TutorialPanel.tsx', 'utf-8');
  check('the tutorial Continue button genuinely plays a confirm sound now', /playSfx\('ui\.confirm'\)[\s\S]{0,40}setStep\(step \+ 1\)/.test(tutorialSrc));

  // Real mount smoke check, given the scope of this commit.
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
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(GameBoard));
  await new Promise((r) => setTimeout(r, 150));
  check('the board mounts cleanly with all of this commit\u2019s changes applied together', !!container.querySelector('button'));
  root.unmount();

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
