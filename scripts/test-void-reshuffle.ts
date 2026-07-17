/**
 * Verifies Commit 41.19's void-reshuffle safety net: when a player's last
 * reachable Apex (none on board, none in hand, none in deck - all copies
 * sitting in the Void) gets destroyed, the whole Void shuffles back into
 * the deck and they draw immediately, so a player can never be locked out
 * of ever playing an Apex again.
 */
import { useGameStore } from '@/store/gameStore';
import { destroyApexFn } from '@/game/rules';
import { createInstance } from '@/data/decks';
import { produce } from 'immer';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

function main() {
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', true, false, false);

  // --- Case 1: destroying the last reachable Apex triggers the reshuffle ---
  const lastApex = createInstance('nu-alley-wraith', 'Apex');
  const oldVoidCard1 = createInstance('nu-spark-plug', 'BatterySupport');
  const oldVoidCard2 = createInstance('nu-glitch-step', 'Reaction');

  useGameStore.setState((st) => ({
    players: {
      ...st.players,
      player1: {
        ...st.players.player1,
        apexSlots: [lastApex, null],
        hand: [], // no Apex in hand
        deck: [createInstance('nu-data-thief', 'Special')], // no Apex in deck
        voidZone: [oldVoidCard1, oldVoidCard2], // pre-existing void content
      },
    },
  }));

  useGameStore.setState((st) => produce(st, (draft) => {
    destroyApexFn(draft, lastApex.instanceId);
  }));

  const s1 = useGameStore.getState();
  check('the destroyed Apex is genuinely gone from the board', s1.players.player1.apexSlots.every((a) => a === null));
  check('the Void genuinely reshuffled back into the deck (Void is empty again)', s1.players.player1.voidZone.length === 0);
  check(
    'the deck genuinely contains the old void cards + the destroyed Apex, minus whatever was drawn',
    s1.players.player1.deck.length + s1.players.player1.hand.length === 1 /* original deck card */ + 2 /* old void cards */ + 1 /* destroyed apex */
  );
  check('a card was genuinely drawn immediately after the reshuffle', s1.players.player1.hand.length >= 1);
  const log1 = s1.log.map((l) => l.message).join(' | ');
  check('the log genuinely records the reshuffle happening', log1.includes('reshuffles back into the deck'));

  // --- Case 2: destroying an Apex when another still exists elsewhere does NOT trigger it ---
  useGameStore.getState().startNewGame('Neon Underground', 'Dark White', true, false, false);
  const apexA = createInstance('nu-alley-wraith', 'Apex');
  const apexB = createInstance('nu-street-beast', 'Apex'); // still in hand - a real reachable Apex remains
  useGameStore.setState((st) => ({
    players: {
      ...st.players,
      player1: {
        ...st.players.player1,
        apexSlots: [apexA, null],
        hand: [apexB],
        deck: [],
        voidZone: [],
      },
    },
  }));
  useGameStore.setState((st) => produce(st, (draft) => {
    destroyApexFn(draft, apexA.instanceId);
  }));
  const s2 = useGameStore.getState();
  check('reshuffle is genuinely NOT triggered when another Apex still exists in hand', !s2.log.some((l) => l.message.includes('reshuffles back into the deck')));

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
