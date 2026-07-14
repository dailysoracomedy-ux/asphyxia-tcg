/* Regression test locking in the O2 conversion math. Rebalanced per request:
   100 damage = 1 O2 loss (was 200), direct-attack cap scaled to 4/turn (was 2)
   so the overall per-turn direct-damage ceiling stays the same (4*100 == 2*200). */
import { overflowToO2Loss, directDamageToO2Loss, DIRECT_O2_CAP_PER_TURN, STARTING_O2, MAX_O2 } from '../game/rules';

console.log('--- Pure math checks ---');
console.log('overflow 250 ->', overflowToO2Loss(250), '(expected 2)');
console.log('overflow 99 ->', overflowToO2Loss(99), '(expected 0)');
console.log('overflow 999 ->', overflowToO2Loss(999), '(expected 9, uncapped)');
console.log('direct 400 raw ->', directDamageToO2Loss(400), '(expected 4, before the 4-per-turn cap is applied)');
console.log('DIRECT_O2_CAP_PER_TURN =', DIRECT_O2_CAP_PER_TURN, '(expected 4)');
console.log('STARTING_O2 / MAX_O2 =', STARTING_O2, '/', MAX_O2, '(expected 12 / 12)');

const checks = [
  overflowToO2Loss(250) === 2,
  overflowToO2Loss(99) === 0,
  overflowToO2Loss(999) === 9,
  directDamageToO2Loss(400) === 4,
  DIRECT_O2_CAP_PER_TURN === 4,
  STARTING_O2 === 12,
  MAX_O2 === 12,
];
if (checks.every(Boolean)) {
  console.log('\nAll conversion math checks PASSED.');
} else {
  console.error('\nCONVERSION MATH CHECK FAILED.');
  process.exit(1);
}
