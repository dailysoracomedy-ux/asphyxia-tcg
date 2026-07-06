import type { Faction, RiftSpace, RiftSpaceId } from '@/types/game';

const RIFT_DEFS: Record<RiftSpaceId, RiftSpace> = {
  CivilWar: {
    id: 'CivilWar',
    name: 'Civil War',
    description: 'At the start of your turn, if your O2 is lower than your opponent\u2019s, gain 1 Momentum.',
  },
  HumanError: {
    id: 'HumanError',
    name: 'Human Error',
    description:
      'The first time each turn a player plays a Special, that player chooses one: gain 1 Momentum, or their next Apex attack this turn deals +100 damage.',
  },
  ControlConflict: {
    id: 'ControlConflict',
    name: 'Control Conflict',
    description:
      'At the start of your turn, you may lock 1 Support you control. Locked Supports still provide Sync but cannot activate their Sync Ability, and cannot be removed by enemy effects. They unlock at the start of your next turn.',
  },
  EchoRiot: {
    id: 'EchoRiot',
    name: 'Echo Riot',
    description:
      'The first time each turn a player loses O2 from their own card effect, they lose 1 additional O2. At the start of each player\u2019s turn, if both players have 6 or less O2, that player gains 1 Momentum.',
  },
  WhiteRoomCollapse: {
    id: 'WhiteRoomCollapse',
    name: 'White Room Collapse',
    description:
      'The first time each turn a player places a Choke Counter on an Apex, that player must discard 1 card. If they cannot discard, they lose 1 Momentum. If they have no Momentum, they lose 1 O2.',
  },
  RecursiveFailure: {
    id: 'RecursiveFailure',
    name: 'Recursive Failure',
    description:
      'The first time each turn a player gains Momentum from a card effect, place 1 Glitch Counter on one Apex they control. Apexes with Glitch Counters get -100 DEF each (max 3). At the end of your turn, you may remove 1 Glitch Counter from one Apex you control if you played 2 or fewer cards that turn.',
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
