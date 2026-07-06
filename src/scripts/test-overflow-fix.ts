/* Targeted regression test for the overflow -> O2 conversion bug report. */
import { overflowToO2Loss, directDamageToO2Loss, DIRECT_O2_CAP_PER_TURN } from '../game/rules';

console.log('--- Pure math checks (the actual bug) ---');
console.log('overflow 500 ->', overflowToO2Loss(500), '(expected 2)');
console.log('overflow 199 ->', overflowToO2Loss(199), '(expected 0)');
console.log('overflow 999 ->', overflowToO2Loss(999), '(expected 4, uncapped)');
console.log('direct 800 raw ->', directDamageToO2Loss(800), '(expected 4, before the 2-per-turn cap is applied)');
console.log('DIRECT_O2_CAP_PER_TURN =', DIRECT_O2_CAP_PER_TURN, '(expected 2)');

const checks = [
  overflowToO2Loss(500) === 2,
  overflowToO2Loss(199) === 0,
  overflowToO2Loss(999) === 4,
  directDamageToO2Loss(800) === 4,
  DIRECT_O2_CAP_PER_TURN === 2,
];
if (checks.every(Boolean)) {
  console.log('\nAll conversion math checks PASSED.');
} else {
  console.error('\nCONVERSION MATH CHECK FAILED.');
  process.exit(1);
}
