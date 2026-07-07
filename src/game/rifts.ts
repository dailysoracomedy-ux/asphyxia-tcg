import type { Faction, RiftSpace, RiftSpaceId } from '@/types/game';

const RIFT_DEFS: Record<RiftSpaceId, RiftSpace> = {
  CivilWar: {
    id: 'CivilWar',
    name: 'Civil War',
    description:
      'At the start of your turn, if your O2 is lower than your opponent\u2019s, choose one: gain 1 Momentum, or your first Apex attack this turn deals +100 damage.',
  },
  HumanError: {
    id: 'HumanError',
    name: 'Human Error',
    description:
      'The first time each turn a player plays a Special, that player chooses one: gain 1 Momentum, or their next Apex attack this turn deals +100 damage. If that Special is negated, they do not gain this Rift bonus.',
  },
  ControlConflict: {
    id: 'ControlConflict',
    name: 'Control Conflict',
    description:
      'At the start of your turn, you may lock 1 Support you control until the start of your next turn. If you do, gain 1 Momentum. Locked Supports still provide Sync but cannot activate Sync Abilities, cannot be returned by Reconfigure, and cannot be removed or disabled by enemy effects.',
  },
  EchoRiot: {
    id: 'EchoRiot',
    name: 'Echo Riot',
    description:
      'The first time each turn a player loses O2 from their own card effect, they gain 1 Momentum. If both players are at 6 O2 or lower, Apex Break Reward grants +2 Momentum instead of +1.',
  },
  WhiteRoomCollapse: {
    id: 'WhiteRoomCollapse',
    name: 'White Room Collapse',
    description:
      'The first time each turn a player places a Choke Counter on an enemy Apex, that player gains 1 Momentum. At the end of each turn, each Apex with 3 or more Choke Counters loses 1 Choke Counter.',
  },
  RecursiveFailure: {
    id: 'RecursiveFailure',
    name: 'Recursive Failure',
    description:
      'The first time each turn a player plays their second voluntary card, they gain 1 Momentum, then place 1 Glitch Counter on one Apex they control. At the end of your turn, if you played 2 or fewer voluntary cards this turn, remove 1 Glitch Counter from one Apex you control.',
  },
};

export function determineRiftSpace(p1: Faction, p2: Faction): RiftSpace {
  const pair = [p1, p2].sort().join(' vs ');
  const N = 'Neon Underground';
  const D = 'Dark White';
  const S = 'Synth Ascendancy';

  if ((p1 === N && p2 === D) || (p1 === D && p2 === N)) return RIFT_DEFS.CivilWar;
  if ((p1 === N && p2 === S) || (p1 === S && p2 === N)) return RIFT_DEFS.HumanError;
  if ((p1 === S && p2 === D) || (p1 === D && p2 === S)) return RIFT_DEFS.ControlConflict;
  if (p1 === N && p2 === N) return RIFT_DEFS.EchoRiot;
  if (p1 === D && p2 === D) return RIFT_DEFS.WhiteRoomCollapse;
  if (p1 === S && p2 === S) return RIFT_DEFS.RecursiveFailure;

  // Fallback (should be unreachable given 3x3 faction matrix)
  void pair;
  return RIFT_DEFS.CivilWar;
}

export { RIFT_DEFS };
