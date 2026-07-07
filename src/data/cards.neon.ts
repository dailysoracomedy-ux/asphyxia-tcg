import type { ApexDef, AbilitySupportDef, BatterySupportDef, EquipDef, SpecialDef, ReactionDef, NegateDef } from '@/types/game';

const F = 'Neon Underground' as const;

export const nuStreetBeast: ApexDef = {
  id: 'nu-street-beast',
  name: 'Street-Beast',
  faction: F,
  type: 'Apex',
  baseDef: 300,
  rulesText: '',
  attacks: [
    { id: 'razor-swipe', name: 'Razor Swipe', syncCost: 0, baseDamage: 300, description: '300 damage.' },
    { id: 'neon-pounce', name: 'Neon Pounce', syncCost: 1, baseDamage: 500, description: '500 damage.' },
    { id: 'backstreet-maul', name: 'Backstreet Maul', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'alleyway-execution',
      name: 'Alleyway Execution',
      syncCost: 3,
      baseDamage: 700,
      description: '700 damage. If this attack deals O2 damage, gain 1 Momentum.',
      onResolve: (ctx) => {
        if (ctx.dealtO2Damage) ctx.helpers.gainMomentum(ctx.ownerId, 1);
      },
    },
  ],
};

export const nuStaticJack: ApexDef = {
  id: 'nu-static-jack',
  name: 'Static Jack',
  faction: F,
  type: 'Apex',
  baseDef: 300,
  rulesText: '',
  attacks: [
    { id: 'shock-jab', name: 'Shock Jab', syncCost: 0, baseDamage: 200, description: '200 damage.' },
    { id: 'circuit-breaker', name: 'Circuit Breaker', syncCost: 1, baseDamage: 400, description: '400 damage.' },
    { id: 'blackout-burst', name: 'Blackout Burst', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'citywide-surge',
      name: 'Citywide Surge',
      syncCost: 3,
      baseDamage: 700,
      description: '700 damage. If this destroys an Apex, opponent loses 1 O2.',
      onResolve: (ctx) => {
        if (ctx.destroyedTarget) {
          ctx.helpers.loseO2(ctx.helpers.getOpponentId(ctx.ownerId), 1);
          ctx.helpers.log('Citywide Surge burns 1 additional O2.', 'o2');
        }
      },
    },
  ],
};

export const nuAlleyWraith: ApexDef = {
  id: 'nu-alley-wraith',
  name: 'Alley Wraith',
  faction: F,
  type: 'Apex',
  baseDef: 200,
  rulesText: '',
  attacks: [
    { id: 'cheap-shot', name: 'Cheap Shot', syncCost: 0, baseDamage: 300, description: '300 damage.' },
    { id: 'smoke-cut', name: 'Smoke Cut', syncCost: 1, baseDamage: 400, description: '400 damage.' },
    { id: 'vanish-strike', name: 'Vanish Strike', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'ghost-in-the-alley',
      name: 'Ghost in the Alley',
      syncCost: 3,
      baseDamage: 600,
      description: '600 damage. This attack cannot be redirected by Reactions.',
      cannotBeRedirected: true,
    },
  ],
};

export const nuRiotRunner: ApexDef = {
  id: 'nu-riot-runner',
  name: 'Riot Runner',
  faction: F,
  type: 'Apex',
  baseDef: 400,
  rulesText: '',
  attacks: [
    { id: 'pipe-swing', name: 'Pipe Swing', syncCost: 0, baseDamage: 200, description: '200 damage.' },
    { id: 'mob-charge', name: 'Mob Charge', syncCost: 1, baseDamage: 400, description: '400 damage.' },
    { id: 'riot-break', name: 'Riot Break', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'last-breath-rush',
      name: 'Last Breath Rush',
      syncCost: 3,
      baseDamage: 700,
      description: '700 damage. If your O2 is 4 or lower, this attack deals +100 damage.',
      bonusDamage: (ctx) => (ctx.helpers.getPlayer(ctx.ownerId).o2 <= 4 ? 100 : 0),
    },
  ],
};

export const nuJuiceBox: AbilitySupportDef = {
  id: 'nu-juice-box',
  name: 'Juice-Box',
  faction: F,
  type: 'AbilitySupport',
  rulesText:
    'After the chained Apex attacks, mark it for +200 DEF. At the end of your turn, that Apex gains +200 DEF until the end of your opponent\u2019s next turn.',
  syncAbilityText: 'Arm +200 DEF for the chained Apex, applied at End Phase.',
  syncAbility: (ctx) => {
    ctx.helpers.markPendingEndPhaseBuff(ctx.chainedApexId, 200);
    ctx.helpers.log('Juice-Box arms +200 DEF for its chained Apex.', 'support');
  },
};

export const nuSparkPlug: AbilitySupportDef = {
  id: 'nu-spark-plug',
  name: 'Spark-Plug',
  faction: F,
  type: 'AbilitySupport',
  rulesText:
    'After the chained Apex attacks, arm it for +200 damage. During your next turn, that Apex\u2019s next attack deals +200 damage.',
  syncAbilityText: 'Arm the chained Apex for +200 damage on its next attack.',
  syncAbility: (ctx) => {
    ctx.helpers.armAttackBonus(ctx.chainedApexId, 200);
    ctx.helpers.log('Spark-Plug arms +200 damage for its chained Apex.', 'support');
  },
};

export const nuDeadBattery: BatterySupportDef = {
  id: 'nu-dead-battery',
  name: 'Dead Battery',
  faction: F,
  type: 'BatterySupport',
  rulesText: 'No Sync ability.',
};

export const nuBlackMarketCell: BatterySupportDef = {
  id: 'nu-black-market-cell',
  name: 'Black-Market Cell',
  faction: F,
  type: 'BatterySupport',
  rulesText: 'When this Support is discarded by Reconfigure, gain 1 Momentum.',
  onReconfigureDiscard: (ctx) => {
    ctx.helpers.gainMomentum(ctx.ownerId, 1);
    ctx.helpers.log('Black-Market Cell pays out 1 Momentum.', 'support');
  },
};

export const nuPlasmaEdge: EquipDef = {
  id: 'nu-plasma-edge',
  name: 'Plasma Edge',
  faction: F,
  type: 'Equip',
  rulesText:
    'Equipped Apex\u2019s attacks deal +100 damage. If equipped Apex is Neon Underground, its 3-Sync attack deals +200 damage instead of +100.',
  damageBonus: (ctx) => {
    const apex = ctx.helpers.getApex(ctx.attackerInstanceId);
    if (!apex) return 100;
    return ctx.syncCost === 3 ? 200 : 100;
  },
};

export const nuSmogJacket: EquipDef = {
  id: 'nu-smog-jacket',
  name: 'Smog Jacket',
  faction: F,
  type: 'Equip',
  rulesText:
    'Equipped Apex gains +100 DEF. The first time each turn equipped Apex would take overflow damage, reduce that overflow by 100.',
  defBonus: 100,
  // NOTE: simplified to "every time" rather than tracking a per-turn flag. In practice this is
  // equivalent: overflow only occurs when the equipped Apex is destroyed, and a destroyed Apex
  // leaves play immediately, so it can only trigger this once per turn anyway under normal play.
  onOverflowDamage: (overflow) => Math.max(0, overflow - 100),
};

export const nuOverclock: SpecialDef = {
  id: 'nu-overclock',
  name: 'Overclock',
  faction: F,
  type: 'Special',
  rulesText:
    'Choose one Apex. Its next attack this turn deals +200 damage. After that attack resolves, lose 1 O2. If that attack does not deal O2 damage, lose 1 additional O2.',
  requiresTarget: 'ownApex',
  resolve: (ctx) => {
    if (!ctx.targetApexInstanceId) return;
    ctx.helpers.armOverclockBonus(ctx.targetApexInstanceId, 200);
    ctx.helpers.log('Overclock arms +200 damage (O2 cost triggers when that attack resolves).', 'play');
  },
};

export const nuDataThief: SpecialDef = {
  id: 'nu-data-thief',
  name: 'Data Thief',
  faction: F,
  type: 'Special',
  rulesText: 'Draw 1 card. If you control at least 2 Supports, gain 1 Momentum.',
  resolve: (ctx) => {
    ctx.helpers.drawCards(ctx.ownerId, 1);
    const p = ctx.helpers.getPlayer(ctx.ownerId);
    const supportCount = p.supportSlots.filter(Boolean).length;
    if (supportCount >= 2) ctx.helpers.gainMomentum(ctx.ownerId, 1);
  },
};

export const nuNoGodsInTheGutters: SpecialDef = {
  id: 'nu-no-gods',
  name: 'No Gods in the Gutters',
  faction: F,
  type: 'Special',
  rulesText:
    'Draw 1 card. If your O2 is 4 or lower, gain 1 Momentum and your next Apex attack this turn deals +200 damage.',
  resolve: (ctx) => {
    ctx.helpers.drawCards(ctx.ownerId, 1);
    const p = ctx.helpers.getPlayer(ctx.ownerId);
    if (p.o2 <= 4) {
      ctx.helpers.gainMomentum(ctx.ownerId, 1);
      const state = ctx.helpers.getState();
      state.players[ctx.ownerId].pendingAttackBonus += 200;
      ctx.helpers.log('No Gods in the Gutters primes the next attack for +200 damage.', 'play');
    }
  },
};

export const nuGlitchStep: ReactionDef = {
  id: 'nu-glitch-step',
  name: 'Glitch Step',
  faction: F,
  type: 'Reaction',
  cost: 1,
  trigger: 'enemyApexAttacks',
  tags: ['INSTANT', 'REACTION', 'ON_ATTACK_DECLARED'],
  rulesText:
    'When an enemy Apex attacks: reduce that attack\u2019s damage by 200. If you control a Neon Underground Apex with 300 DEF or less, gain 1 Momentum after the attack resolves.',
  resolve: (ctx) => {
    ctx.helpers.log('Glitch Step cuts the incoming attack by 200 damage.', 'response');
    return { damageReduction: 200 };
  },
};

export const nuFeedbackLoop: NegateDef = {
  id: 'nu-feedback-loop',
  name: 'Feedback Loop',
  faction: F,
  type: 'Negate',
  cost: 2,
  tags: ['INSTANT', 'NEGATE', 'ON_SPECIAL_PLAYED', 'ON_REACTION_PLAYED'],
  rulesText: 'Cancel an enemy Special or Reaction. Then deal 100 damage to one enemy Apex.',
  canCancel: (type) => type === 'Special' || type === 'Reaction',
  resolve: (ctx) => {
    ctx.helpers.log('Feedback Loop cancels the effect and crackles for 100 damage.', 'response');
  },
};

export const NEON_CARDS = [
  nuStreetBeast,
  nuStaticJack,
  nuAlleyWraith,
  nuRiotRunner,
  nuJuiceBox,
  nuSparkPlug,
  nuDeadBattery,
  nuBlackMarketCell,
  nuPlasmaEdge,
  nuSmogJacket,
  nuOverclock,
  nuDataThief,
  nuNoGodsInTheGutters,
  nuGlitchStep,
  nuFeedbackLoop,
];
