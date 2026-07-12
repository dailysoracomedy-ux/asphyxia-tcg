import type { CardType, PlayerId } from '@/types/game';

/**
 * Commit 30 - drag-and-drop is purely an input-layer addition. Every drop this
 * system resolves calls the exact same store actions the existing click flow
 * already calls (playApexCard, playSupportCard, playEquipCard, equipSwap,
 * playSpecialCard, declareAttack) - see dragDropLogic.ts's resolveDrop. This
 * file only describes what's being dragged and where it can legally land;
 * it never decides game rules itself.
 */

export type DragSourceKind = 'hand-card' | 'apex-attack';

export interface DragSource {
  kind: DragSourceKind;
  playerId: PlayerId;
  /** hand-card: the card being dragged. apex-attack: the attacking Apex. */
  instanceId: string;
  cardType?: CardType;
  /** apex-attack only - which attack was already chosen before the drag began
   *  (attacker and attack are still selected by click, per the spec's
   *  "keep existing click Apex -> choose attack flow" guidance - drag/drop
   *  is added specifically for the final target-selection step). */
  attackId?: string;
}

/** A zone tagged in the DOM via data-dropzone-id, matched against on drop. */
export type DropZoneKind =
  | 'apex-slot'
  | 'support-slot'
  | 'own-apex'
  | 'enemy-apex'
  | 'enemy-o2'
  | 'action-zone';

export interface DropZoneId {
  kind: DropZoneKind;
  playerId: PlayerId;
  /** apex-slot / support-slot only - which slot index. */
  slotIndex?: number;
  /** own-apex / enemy-apex only - which Apex instance. */
  instanceId?: string;
}

export interface DragState {
  active: boolean;
  source: DragSource | null;
  /** Screen-space pointer position, updated on every pointermove - drives the
   *  ghost card's position and (via elementFromPoint) which zone is hovered. */
  pointer: { x: number; y: number };
  /** Serialized ids of currently-legal zones, computed once when the drag
   *  starts. Kept as strings (via zoneKey) for cheap Set membership checks
   *  during pointermove/hover, without re-deriving legality every frame. */
  legalZoneKeys: Set<string>;
  hoveredZoneKey: string | null;
}

export function zoneKey(z: DropZoneId): string {
  return [z.kind, z.playerId, z.slotIndex ?? '', z.instanceId ?? ''].join(':');
}

export const EMPTY_DRAG_STATE: DragState = {
  active: false,
  source: null,
  pointer: { x: 0, y: 0 },
  legalZoneKeys: new Set(),
  hoveredZoneKey: null,
};
