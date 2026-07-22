/** Commit 54.1 - HubPrompt compactness: the shared prompt must be content-fit
 *  and centered (w-fit mx-auto), never full-width with buttons pushed to the
 *  far edge (w-full + ml-auto - the reported "way too wide" bar). Rendered
 *  for real via react-dom/server and asserted on the emitted markup. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HubPrompt from '../src/components/HubPrompt';

let passed = 0, failed = 0;
function check(name: string, ok: boolean) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}`);
  ok ? passed++ : failed++;
}

const html = renderToStaticMarkup(
  <HubPrompt
    text={'Model-00 "Crown" is attacking for 600 damage. Play a React card?'}
    options={[
      { key: 'a', label: 'Glitch Step (1 Mom)', onClick: () => {} },
      { key: 'b', label: 'Pass', muted: true, onClick: () => {} },
    ]}
  />
);

const rootClass = /class="([^"]*)"/.exec(html)?.[1] ?? '';
check('root is content-fit (w-fit)', rootClass.split(/\s+/).includes('w-fit'));
check('root self-centers (mx-auto)', rootClass.split(/\s+/).includes('mx-auto'));
check('root is NOT full-width (no standalone w-full token)', !rootClass.split(/\s+/).includes('w-full'));
check('buttons are NOT exiled right (ml-auto gone anywhere)', !html.includes('ml-auto'));
check('message text renders', html.includes('Play a React card?'));
check('both buttons render', html.includes('Glitch Step') && html.includes('Pass'));

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
