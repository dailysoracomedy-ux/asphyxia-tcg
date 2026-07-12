import type { CardInstance, Faction } from '@/types/game';
import { NEON_CARDS } from './cards.neon';
import { DARK_WHITE_CARDS } from './cards.darkwhite';
import { SYNTH_CARDS } from './cards.synth';

let instanceCounter = 0;
function nextInstanceId(defId: string): string {
  instanceCounter += 1;
  return `${defId}__${instanceCounter}__${Math.random().toString(36).slice(2, 7)}`;
}

export function createInstance(defId: string, type: CardInstance['type']): CardInstance {
  const instance: CardInstance = {
    instanceId: nextInstanceId(defId),
    defId,
    type,
  };
  if (type === 'Apex') {
    instance.counters = { choke: 0, upgrade: 0, glitch: 0 };
    instance.hasAttacked = false;
    instance.attackLockedForTurn = null;
    instance.armedBonus = 0;
    instance.tempDefBuffs = [];
    instance.protections = [];
    instance.equip = undefined;
  }
  if (type === 'AbilitySupport' || type === 'BatterySupport') {
    instance.chainedApexId = null;
    instance.lockedByControlConflict = false;
    instance.enteredViaReconfigureTurn = null;
  }
  return instance;
}

function buildDeckList(faction: Faction): string[] {
  const source = faction === 'Neon Underground' ? NEON_CARDS : faction === 'Dark White' ? DARK_WHITE_CARDS : SYNTH_CARDS;
  const ids: string[] = [];
  for (const card of source) {
    ids.push(card.id, card.id); // 2 copies of every card = 30 cards
  }
  return ids;
}

export function buildStarterDeck(faction: Faction): CardInstance[] {
  const ids = buildDeckList(faction);
  return ids.map((defId) => {
    const source = faction === 'Neon Underground' ? NEON_CARDS : faction === 'Dark White' ? DARK_WHITE_CARDS : SYNTH_CARDS;
    const def = source.find((c) => c.id === defId)!;
    return createInstance(defId, def.type);
  });
}

export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
