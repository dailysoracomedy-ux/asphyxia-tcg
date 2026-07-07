import type { ApexDef, AbilitySupportDef, BatterySupportDef, EquipDef, SpecialDef, ReactionDef, NegateDef } from '@/types/game';

const F = 'Synth Ascendancy' as const;

export const saModel00Crown: ApexDef = {
  id: 'sa-model-00-crown',
  name: 'Model-00 "Crown"',
  faction: F,
  type: 'Apex',
  baseDef: 500,
  rulesText: '',
  attacks: [
    { id: 'steel-command', name: 'Steel Command', syncCost: 0, baseDamage: 200, description: '200 damage.' },
    { id: 'precision-rule', name: 'Precision Rule', syncCost: 1, baseDamage: 400, description: '400 damage.' },
    { id: 'crown-protocol', name: 'Crown Protocol', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'ascendant-decree',
      name: 'Ascendant Decree',
      syncCost: 3,
      baseDamage: 800,
      description: '800 damage. If this destroys an Apex, place 1 Upgrade Counter on this Apex.',
      onResolve: (ctx) => {
        if (ctx.destroyedTarget) ctx.helpers.addCounter(ctx.attackerInstanceId, 'upgrade', 1);
      },
    },
  ],
};

export const saChromeSeraph: ApexDef = {
  id: 'sa-chrome-seraph',
  name: 'Chrome Seraph',
  faction: F,
  type: 'Apex',
  baseDef: 400,
  rulesText: '',
  attacks: [
    { id: 'sever-pattern', name: 'Sever Pattern', syncCost: 0, baseDamage: 300, description: '300 damage.' },
    { id: 'optimization-cut', name: 'Optimization Cut', syncCost: 1, baseDamage: 400, description: '400 damage.' },
    { id: 'wing-array', name: 'Wing Array', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'seraphim-execution',
      name: 'Seraphim Execution',
      syncCost: 3,
      baseDamage: 700,
      description: '700 damage. Gain 1 Momentum if this is the second card you played this turn.',
      onResolve: (ctx) => {
        const p = ctx.helpers.getPlayer(ctx.ownerId);
        if (p.turnFlags.cardsPlayedThisTurn === 2) ctx.helpers.gainMomentum(ctx.ownerId, 1);
      },
    },
  ],
};

export const saVirex: ApexDef = {
  id: 'sa-virex',
  name: 'Virex, Severed General',
  faction: F,
  type: 'Apex',
  baseDef: 300,
  rulesText: '',
  attacks: [
    { id: 'split-blade', name: 'Split Blade', syncCost: 0, baseDamage: 300, description: '300 damage.' },
    { id: 'war-calculation', name: 'War Calculation', syncCost: 1, baseDamage: 500, description: '500 damage.' },
    { id: 'archive-kill', name: 'Archive Kill', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'severed-timeline',
      name: 'Severed Timeline',
      syncCost: 3,
      baseDamage: 800,
      description: '800 damage. If this destroys an Apex, draw 1 card.',
      onResolve: (ctx) => {
        if (ctx.destroyedTarget) ctx.helpers.drawCards(ctx.ownerId, 1);
      },
    },
  ],
};

export const saHalcyonMaw: ApexDef = {
  id: 'sa-halcyon-maw',
  name: 'Halcyon Maw',
  faction: F,
  type: 'Apex',
  baseDef: 400,
  rulesText: '',
  attacks: [
    { id: 'bite-sequence', name: 'Bite Sequence', syncCost: 0, baseDamage: 200, description: '200 damage.' },
    { id: 'hydraulic-crush', name: 'Hydraulic Crush', syncCost: 1, baseDamage: 400, description: '400 damage.' },
    { id: 'apex-consumption', name: 'Apex Consumption', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'perfect-predator',
      name: 'Perfect Predator',
      syncCost: 3,
      baseDamage: 700,
      description: '700 damage. If this deals O2 damage, gain 1 Momentum.',
      onResolve: (ctx) => {
        if (ctx.dealtO2Damage) ctx.helpers.gainMomentum(ctx.ownerId, 1);
      },
    },
  ],
};

export const saLogicBloom: AbilitySupportDef = {
  id: 'sa-logic-bloom',
  name: 'Logic Bloom',
  faction: F,
  type: 'AbilitySupport',
  rulesText:
    'After the chained Apex attacks, mark it for +200 DEF. At the end of your turn, that Apex gains +200 DEF until the end of your opponent\u2019s next turn.',
  syncAbilityText: 'Arm +200 DEF for the chained Apex, applied at End Phase.',
  syncAbility: (ctx) => {
    ctx.helpers.markPendingEndPhaseBuff(ctx.chainedApexId, 200);
    ctx.helpers.log('Logic Bloom arms +200 DEF for its chained Apex.', 'support');
  },
};

export const saDroneChoir: AbilitySupportDef = {
  id: 'sa-drone-choir',
  name: 'Drone Choir',
  faction: F,
  type: 'AbilitySupport',
  rulesText:
    'After the chained Apex attacks, arm it for +100 damage. During your next turn, that Apex\u2019s next attack deals +100 damage. If that Apex is Synth Ascendancy, it deals +200 damage instead.',
  syncAbilityText: 'Arm +100 (or +200 for Synth Ascendancy) damage for the chained Apex.',
  // NOTE: engine bumps this to +200 automatically when the chained Apex's faction is Synth Ascendancy
  // (see resolveSyncAbility in gameStore.ts) so the base card definition just arms the common case.
  syncAbility: (ctx) => {
    ctx.helpers.armAttackBonus(ctx.chainedApexId, 100);
  },
};

export const saBlankCore: BatterySupportDef = {
  id: 'sa-blank-core',
  name: 'Blank Core',
  faction: F,
  type: 'BatterySupport',
  rulesText: 'No Sync ability.',
};

export const saEmergencyShell: BatterySupportDef = {
  id: 'sa-emergency-shell',
  name: 'Emergency Shell',
  faction: F,
  type: 'BatterySupport',
  rulesText:
    'When this Support is discarded by Reconfigure, choose one Apex. That Apex gains +100 DEF until the end of your opponent\u2019s next turn.',
  // NOTE: demo simplification - auto-targets the controller's first Apex on board (cleanest practical
  // behavior per spec; a manual target picker for a passive discard trigger is out of scope for this pass).
  onReconfigureDiscard: (ctx) => {
    const p = ctx.helpers.getPlayer(ctx.ownerId);
    const apex = p.apexSlots.find(Boolean);
    if (apex) {
      const state = ctx.helpers.getState();
      ctx.helpers.applyTempDefBuff(apex.instanceId, 100, state.turnNumber + 1);
      ctx.helpers.log('Emergency Shell reinforces an Apex with +100 DEF.', 'support');
    }
  },
};

export const saChromeHalo: EquipDef = {
  id: 'sa-chrome-halo',
  name: 'Chrome Halo',
  faction: F,
  type: 'Equip',
  rulesText: 'Equipped Apex gains +200 DEF. Once per turn, if equipped Apex destroys an enemy Apex, gain 1 Momentum.',
  defBonus: 200,
};

export const saPatternBlade: EquipDef = {
  id: 'sa-pattern-blade',
  name: 'Pattern Blade',
  faction: F,
  type: 'Equip',
  rulesText:
    'Equipped Apex\u2019s attacks deal +100 damage. If you played 2 or more cards this turn, equipped Apex\u2019s attacks deal +200 damage instead.',
  damageBonus: (ctx) => {
    const p = ctx.helpers.getPlayer(ctx.ownerId);
    return p.turnFlags.cardsPlayedThisTurn >= 2 ? 200 : 100;
  },
};

export const saCompileSequence: SpecialDef = {
  id: 'sa-compile-sequence',
  name: 'Compile Sequence',
  faction: F,
  type: 'Special',
  rulesText: 'Draw 1 card. If this is the second card you played this turn, gain 1 Momentum.',
  resolve: (ctx) => {
    ctx.helpers.drawCards(ctx.ownerId, 1);
    const p = ctx.helpers.getPlayer(ctx.ownerId);
    if (p.turnFlags.cardsPlayedThisTurn === 2) ctx.helpers.gainMomentum(ctx.ownerId, 1);
  },
};

export const saUpgradePath: SpecialDef = {
  id: 'sa-upgrade-path',
  name: 'Upgrade Path',
  faction: F,
  type: 'Special',
  rulesText: 'Place 1 Upgrade Counter on one Apex. That Apex\u2019s attacks deal +100 damage.',
  requiresTarget: 'ownApex',
  resolve: (ctx) => {
    if (ctx.targetApexInstanceId) ctx.helpers.addCounter(ctx.targetApexInstanceId, 'upgrade', 1);
  },
};

export const saAscensionComplete: SpecialDef = {
  id: 'sa-ascension-complete',
  name: 'Ascension Complete',
  faction: F,
  type: 'Special',
  rulesText:
    'Play this only if you played another card earlier this turn. Choose one Apex with an Upgrade Counter. That Apex gains +100 DEF and its next attack deals +200 damage. If that Apex is Model-00 "Crown," gain 1 Momentum.',
  requiresTarget: 'ownApexWithUpgrade',
  canPlay: (playerId, state) => state.players[playerId].turnFlags.cardsPlayedThisTurn >= 1,
  resolve: (ctx) => {
    if (!ctx.targetApexInstanceId) return;
    const state = ctx.helpers.getState();
    ctx.helpers.applyTempDefBuff(ctx.targetApexInstanceId, 100, state.turnNumber + 1);
    ctx.helpers.armAttackBonus(ctx.targetApexInstanceId, 200);
    const apex = ctx.helpers.getApex(ctx.targetApexInstanceId);
    if (apex?.defId === 'sa-model-00-crown') ctx.helpers.gainMomentum(ctx.ownerId, 1);
  },
};

export const saBackupConsciousness: ReactionDef = {
  id: 'sa-backup-consciousness',
  name: 'Backup Consciousness',
  faction: F,
  type: 'Reaction',
  cost: 1,
  trigger: 'ownApexWouldBeDestroyed',
  tags: ['INSTANT', 'REACTION', 'ON_APEX_WOULD_BE_DESTROYED'],
  rulesText:
    'When one of your Apexes would be destroyed: that Apex remains in play with 100 DEF. If your O2 is 4 or lower, place 1 Upgrade Counter on that Apex, then place 1 Glitch Counter on it.',
  resolve: (ctx) => {
    ctx.helpers.log('Backup Consciousness reboots the Apex at 100 DEF.', 'response');
    return { preventDestruction: true, survivorDef: 100 };
  },
};

export const saLogicDenial: NegateDef = {
  id: 'sa-logic-denial',
  name: 'Logic Denial',
  faction: F,
  type: 'Negate',
  cost: 2,
  tags: ['INSTANT', 'NEGATE', 'ON_SPECIAL_PLAYED', 'ON_REACTION_PLAYED', 'ON_EQUIP_PLAYED'],
  rulesText: 'Cancel an enemy Special, Reaction, or Equip. If this is the second card you played this turn, draw 1 card.',
  canCancel: (type) => type === 'Special' || type === 'Reaction' || type === 'Equip',
  resolve: (ctx) => {
    const p = ctx.helpers.getPlayer(ctx.ownerId);
    if (p.turnFlags.cardsPlayedThisTurn === 2) ctx.helpers.drawCards(ctx.ownerId, 1);
  },
};

export const SYNTH_CARDS = [
  saModel00Crown,
  saChromeSeraph,
  saVirex,
  saHalcyonMaw,
  saLogicBloom,
  saDroneChoir,
  saBlankCore,
  saEmergencyShell,
  saChromeHalo,
  saPatternBlade,
  saCompileSequence,
  saUpgradePath,
  saAscensionComplete,
  saBackupConsciousness,
  saLogicDenial,
];
