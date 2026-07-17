import type { ApexDef, AbilitySupportDef, BatterySupportDef, EquipDef, SpecialDef, ReactionDef } from '@/types/game';

const F = 'Dark White' as const;

export const dwOverseerPrime: ApexDef = {
  id: 'dw-overseer-prime',
  name: 'Overseer Prime',
  faction: F,
  type: 'Apex',
  baseDef: 400,
  rulesText: '',
  attacks: [
    { id: 'order-strike', name: 'Order Strike', syncCost: 0, baseDamage: 300, description: '300 damage.' },
    { id: 'sterile-pressure', name: 'Sterile Pressure', syncCost: 1, baseDamage: 400, description: '400 damage.' },
    { id: 'command-pulse', name: 'Command Pulse', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'absolute-command',
      name: 'Absolute Command',
      syncCost: 3,
      baseDamage: 700,
      description: '700 damage. If the target has a Choke Counter, opponent loses 1 O2.',
      onResolve: (ctx) => {
        if (ctx.targetHadChoke) {
          ctx.helpers.loseO2(ctx.helpers.getOpponentId(ctx.ownerId), 1);
          ctx.helpers.log('Absolute Command punishes the Choke Counter for 1 O2.', 'o2');
        }
      },
    },
  ],
};

export const dwEnforcerV4: ApexDef = {
  id: 'dw-enforcer-v4',
  name: 'Enforcer-V4',
  faction: F,
  type: 'Apex',
  baseDef: 500,
  rulesText: '',
  attacks: [
    { id: 'baton-crush', name: 'Baton Crush', syncCost: 0, baseDamage: 200, description: '200 damage.' },
    { id: 'compliance-strike', name: 'Compliance Strike', syncCost: 1, baseDamage: 400, description: '400 damage.' },
    { id: 'punitive-force', name: 'Punitive Force', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'full-suppression',
      name: 'Full Suppression',
      syncCost: 3,
      baseDamage: 700,
      description: '700 damage. Place 1 Choke Counter on the target.',
      onResolve: (ctx) => {
        if (ctx.targetInstanceId) ctx.helpers.addCounter(ctx.targetInstanceId, 'choke', 1, ctx.ownerId);
      },
    },
  ],
};

export const dwGlassWarden: ApexDef = {
  id: 'dw-glass-warden',
  name: 'Glass Warden',
  faction: F,
  type: 'Apex',
  baseDef: 600,
  rulesText: '',
  attacks: [
    { id: 'guard-tap', name: 'Guard Tap', syncCost: 0, baseDamage: 100, description: '100 damage.' },
    { id: 'shield-bash', name: 'Shield Bash', syncCost: 1, baseDamage: 300, description: '300 damage.' },
    { id: 'containment-break', name: 'Containment Break', syncCost: 2, baseDamage: 500, description: '500 damage.' },
    {
      id: 'white-room-collapse-atk',
      name: 'White Room Collapse',
      syncCost: 3,
      baseDamage: 700,
      description: '700 damage. If this destroys an Apex, gain 1 O2.',
      onResolve: (ctx) => {
        if (ctx.destroyedTarget) ctx.helpers.gainO2(ctx.ownerId, 1);
      },
    },
  ],
};

export const dwPaleExecutioner: ApexDef = {
  id: 'dw-pale-executioner',
  name: 'Pale Executioner',
  faction: F,
  type: 'Apex',
  baseDef: 300,
  rulesText: '',
  attacks: [
    { id: 'clean-cut', name: 'Clean Cut', syncCost: 0, baseDamage: 300, description: '300 damage.' },
    { id: 'surgical-strike', name: 'Surgical Strike', syncCost: 1, baseDamage: 500, description: '500 damage.' },
    { id: 'final-procedure', name: 'Final Procedure', syncCost: 2, baseDamage: 600, description: '600 damage.' },
    {
      id: 'public-erasure',
      name: 'Public Erasure',
      syncCost: 3,
      baseDamage: 800,
      description: '800 damage. If this destroys an Apex with a Choke Counter, draw 1 card.',
      onResolve: (ctx) => {
        if (ctx.destroyedTarget && ctx.targetHadChoke) ctx.helpers.drawCards(ctx.ownerId, 1);
      },
    },
  ],
};

export const dwOxygenSiphon: AbilitySupportDef = {
  id: 'dw-oxygen-siphon',
  name: 'Oxygen Siphon',
  faction: F,
  type: 'AbilitySupport',
  rulesText:
    'After the chained Apex attacks, if the target had a Choke Counter, gain 1 Momentum immediately. If the attack dealt O2 damage, gain 1 O2.',
  syncAbilityText: 'Momentum on choked kills, O2 on O2 damage.',
  syncAbility: (ctx) => {
    if (ctx.targetHadChoke) {
      ctx.helpers.gainMomentum(ctx.ownerId, 1);
    }
    if (ctx.dealtO2Damage) {
      ctx.helpers.gainO2(ctx.ownerId, 1);
    }
  },
};

export const dwGatekeeperDrone: AbilitySupportDef = {
  id: 'dw-gatekeeper-drone',
  name: 'Gatekeeper Drone',
  faction: F,
  type: 'AbilitySupport',
  rulesText:
    'After the chained Apex attacks, mark it for protection. At the end of your turn, that Apex takes 100 less damage from the next attack during your opponent\u2019s next turn. If an enemy Apex has a Choke Counter, reduce by 200 instead.',
  syncAbilityText: 'Arm protection, applied at End Phase.',
  syncAbility: (ctx) => {
    const reduction = ctx.targetHadChoke ? 200 : 100;
    ctx.helpers.markPendingEndPhaseProtection(ctx.chainedApexId, reduction);
    ctx.helpers.log('Gatekeeper Drone arms protection for its chained Apex.', 'support');
  },
};

export const dwBlankDirective: BatterySupportDef = {
  id: 'dw-blank-directive',
  name: 'Blank Directive',
  faction: F,
  type: 'BatterySupport',
  rulesText: 'No Sync ability.',
};

export const dwReserveGrid: BatterySupportDef = {
  id: 'dw-reserve-grid',
  name: 'Reserve Grid',
  faction: F,
  type: 'BatterySupport',
  rulesText: 'When this Support is returned to hand by Reconfigure, the next damage your O2 would take this turn is reduced by 1.',
  onReconfigureReturn: (ctx) => {
    const state = ctx.helpers.getState();
    state.players[ctx.ownerId].reserveGridShield += 1;
    ctx.helpers.log('Reserve Grid primes an O2 shield for this turn.', 'support');
  },
};

export const dwMonomolecularBlade: EquipDef = {
  id: 'dw-monomolecular-blade',
  name: 'Monomolecular Blade',
  faction: F,
  type: 'Equip',
  rulesText:
    'Equipped Apex\u2019s attacks deal +100 damage. If the target has a Choke Counter, equipped Apex\u2019s attacks deal +200 damage instead.',
  damageBonus: (ctx) => {
    const target = ctx.targetInstanceId ? ctx.helpers.getApex(ctx.targetInstanceId) : undefined;
    return target && (target.counters?.choke ?? 0) > 0 ? 200 : 100;
  },
};

export const dwSterileMantle: EquipDef = {
  id: 'dw-sterile-mantle',
  name: 'Sterile Mantle',
  faction: F,
  type: 'Equip',
  rulesText: 'Equipped Apex gains +200 DEF. When equipped Apex is destroyed, gain 1 Momentum.',
  defBonus: 200,
  onEquippedDestroyed: (ctx) => {
    ctx.helpers.gainMomentum(ctx.ownerId, 1);
    ctx.helpers.log('Sterile Mantle pays out 1 Momentum on destruction.', 'momentum');
  },
};

export const dwSystemScan: SpecialDef = {
  id: 'dw-system-scan',
  name: 'System Scan',
  faction: F,
  type: 'Special',
  rulesText: 'Draw 1 card. Then you may reveal a Dark White card from your hand. If you do, place 1 Choke Counter on an enemy Apex.',
  requiresTarget: 'enemyApex',
  resolve: (ctx) => {
    ctx.helpers.drawCards(ctx.ownerId, 1);
    const hand = ctx.helpers.getPlayer(ctx.ownerId).hand;
    const hasDarkWhite = hand.some((c) => c.instanceId !== ctx.cardInstanceId);
    if (hasDarkWhite && ctx.targetApexInstanceId) {
      ctx.helpers.addCounter(ctx.targetApexInstanceId, 'choke', 1, ctx.ownerId);
      ctx.helpers.log('System Scan reveals a Dark White card and marks the target.', 'counter');
    }
  },
};

export const dwChokeProtocol: SpecialDef = {
  id: 'dw-choke-protocol',
  name: 'Choke Protocol',
  faction: F,
  type: 'Special',
  rulesText: 'Place 1 Choke Counter on an enemy Apex. If that Apex already had a Choke Counter, it gets -200 DEF until end of turn.',
  requiresTarget: 'enemyApex',
  resolve: (ctx) => {
    if (!ctx.targetApexInstanceId) return;
    const target = ctx.helpers.getApex(ctx.targetApexInstanceId);
    const alreadyHad = (target?.counters?.choke ?? 0) > 0;
    ctx.helpers.addCounter(ctx.targetApexInstanceId, 'choke', 1, ctx.ownerId);
    if (alreadyHad) {
      const state = ctx.helpers.getState();
      ctx.helpers.applyTempDefBuff(ctx.targetApexInstanceId, -200, state.turnNumber);
    }
  },
};

export const dwVerdictProtocol: SpecialDef = {
  id: 'dw-verdict-protocol',
  name: 'Verdict Protocol',
  faction: F,
  type: 'Special',
  rulesText:
    'Choose one enemy Apex with at least 1 Choke Counter. Choose one: it cannot attack next turn; it gets -300 DEF until end of turn; your next attack against it deals +200 damage.',
  requiresTarget: 'enemyApexWithChoke',
  resolve: (ctx) => {
    // Default (demo simplification): apply the -300 DEF until end of turn mode automatically.
    // TODO: expose a real 3-way choice modal; other two modes implemented in engine helpers below.
    if (!ctx.targetApexInstanceId) return;
    const state = ctx.helpers.getState();
    ctx.helpers.applyTempDefBuff(ctx.targetApexInstanceId, -300, state.turnNumber);
    ctx.helpers.log('Verdict Protocol saps -300 DEF until end of turn.', 'counter');
  },
};

export const dwEmergencyAuthority: ReactionDef = {
  id: 'dw-emergency-authority',
  name: 'Emergency Authority',
  faction: F,
  type: 'Reaction',
  cost: 1,
  trigger: 'opponentAttackDealsO2Damage',
  tags: ['INSTANT', 'REACTION', 'ON_O2_DAMAGE'],
  rulesText:
    'When your opponent\u2019s attack would deal O2 damage: reduce that O2 damage by 1. If your O2 is 4 or lower, place 1 Choke Counter on the attacking Apex.',
  resolve: (ctx) => {
    ctx.helpers.log('Emergency Authority softens the O2 damage.', 'response');
    return { o2Reduction: 1 };
  },
};

export const dwAbsoluteRefusal: ReactionDef = {
  id: 'dw-absolute-refusal',
  name: 'Absolute Refusal',
  faction: F,
  type: 'Reaction',
  cost: 2,
  tags: ['INSTANT', 'NEGATE', 'ON_SPECIAL_PLAYED', 'ON_REACTION_PLAYED', 'ON_EQUIP_PLAYED'],
  rulesText: 'Cancel an enemy Special, Reaction, or Equip. If the canceled card was Neon Underground, gain 1 Momentum.',
  canCancel: (type) => type === 'Special' || type === 'Reaction' || type === 'Equip',
  resolve: (ctx) => {
    if (ctx.cancelledFaction === 'Neon Underground') ctx.helpers.gainMomentum(ctx.ownerId, 1);
  },
};

export const DARK_WHITE_CARDS = [
  dwOverseerPrime,
  dwEnforcerV4,
  dwGlassWarden,
  dwPaleExecutioner,
  dwOxygenSiphon,
  dwGatekeeperDrone,
  dwBlankDirective,
  dwReserveGrid,
  dwMonomolecularBlade,
  dwSterileMantle,
  dwSystemScan,
  dwChokeProtocol,
  dwVerdictProtocol,
  dwEmergencyAuthority,
  dwAbsoluteRefusal,
];
