'use client';

import type { CardInstance, Faction, GameState, PlayerId } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { useGameStore } from '@/store/gameStore';
import { getEffectiveDef, getPreviewAttackDamage, getChainedSupportFor, getChainLabelForSupport, findApexAnywhere } from '@/game/rules';
import Card from './Card';
import EquipFlap from './EquipFlap';
import DeckVoidStack from './DeckVoidStack';
import { factionTheme } from '@/lib/theme';
import { getCardArt, getArtAspectRatio } from '@/lib/cardArt';
import { useApexVisualEvents, usePlayerVisualEvents, useSlotGhost } from '@/store/animationStore';

/** Matches Card.tsx's 'apexBoard' size preset height - the Equip flap needs this to
 *  compute a matching width, and it's cheaper to name the constant once here than
 *  import Card's internal SIZE_MAP just for one number. */
const APEX_BOARD_HEIGHT = 152;
/** Matches Card.tsx's 'supportBoard' size preset height, same reasoning as above. */
const SUPPORT_BOARD_HEIGHT = 100;

interface PlayerBoardProps {
  state: GameState;
  playerId: PlayerId;
  flipped?: boolean;
  onApexClick?: (instanceId: string) => void;
  onSupportClick?: (instanceId: string) => void;
  apexHighlight?: (instanceId: string) => 'valid-target' | 'attacked' | 'locked' | null;
  apexDisabled?: (instanceId: string) => boolean;
  supportDisabled?: (instanceId: string) => boolean;
  selectedApexId?: string | null;
  selectedSupportId?: string | null;
  onInspectCard?: (instance: CardInstance) => void;
  /** Opens the full Void inspection modal - O2/Momentum moved to the shared
   *  centered stats bar, and Deck/Void moved to visual stacks on the board itself,
   *  so this component no longer owns any of that display on its own. */
  onOpenVoid?: () => void;
  /** Optional ref attached to the board's own bordered box (not the row wrapper
   *  around it) - used by GameBoard to measure its actual content width, e.g. so
   *  Hand's container can use it as a minimum width. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

/** Compact identity chip - just Faction name and Hand count now; O2/Momentum moved
 *  to the shared centered SharedStatsBar, and Deck/Void moved to DeckVoidStack
 *  visuals on the board rows themselves. */
export function PlayerStatusChips({ state, playerId }: { state: GameState; playerId: PlayerId }) {
  const player = state.players[playerId];
  const theme = factionTheme(player.faction);
  const isActive = state.activePlayerId === playerId && state.status === 'playing';

  return (
    <div className="relative flex items-center gap-2 text-[11px] font-mono flex-wrap">
      <span
        className={`font-bold tracking-wide px-1.5 py-0.5 rounded shrink-0 ${isActive ? 'text-shadow-glow' : 'opacity-60'}`}
        style={{ color: theme.primary, border: `1px solid ${theme.border}` }}
      >
        {player.faction}
        {isActive ? ' ◂' : ''}
      </span>
      <Stat label="HAND" value={player.hand.length} colorClass="text-white/50" />
      {state.phase === 'Combat' && isActive && <Stat label="SYNC" value={player.availableSync} colorClass="text-fuchsia-300" />}
    </div>
  );
}

export default function PlayerBoard({
  state,
  playerId,
  flipped,
  onApexClick,
  onSupportClick,
  apexHighlight,
  apexDisabled,
  supportDisabled,
  selectedApexId,
  selectedSupportId,
  onInspectCard,
  onOpenVoid,
  containerRef,
}: PlayerBoardProps) {
  const player = state.players[playerId];
  const theme = factionTheme(player.faction);
  const isActiveTurn = state.status === 'playing' && state.activePlayerId === playerId;
  const reactEvents = usePlayerVisualEvents(playerId).filter((e) => e.type === 'REACT_PLAYED' || e.type === 'CARD_NEGATED');
  const reactVfxClass = reactEvents.length > 0 ? (reactEvents.some((e) => e.type === 'CARD_NEGATED') ? 'vfx-negate-glitch' : 'vfx-react-highlight') : '';

  return (
    <div
      ref={containerRef}
      className={`rounded-lg border p-1.5 scanlines min-h-0 flex flex-col w-fit max-w-full mx-auto ${isActiveTurn ? 'active-board-glow' : ''} ${reactVfxClass}`}
      style={{ borderColor: `${theme.border}55`, background: '#05050a', ['--active-glow-color' as string]: `${theme.primary}99` }}
    >
      <div
        className="flex-1 min-h-0 grid gap-3 justify-center"
        style={{ gridTemplateColumns: 'minmax(0,auto) auto minmax(0,auto)', alignItems: flipped ? 'end' : 'start' }}
      >
        <div className="flex gap-2 items-start row-start-1 col-start-1 justify-end">
          {flipped ? (
            <div className="flex gap-1.5">
              {player.supportSlots.map((support, i) => (
                <SupportSlotOrGhost
                  key={i}
                  slotIndex={i}
                  support={support}
                  state={state}
                  playerId={playerId}
                  onClick={onSupportClick}
                  disabled={support ? supportDisabled?.(support.instanceId) : false}
                  selected={support ? selectedSupportId === support.instanceId : false}
                  onInspect={onInspectCard}
                />
              ))}
            </div>
          ) : (
            <>
              <DeckVoidStack label="DECK" count={player.deck.length} accentColor={theme.primary} />
              <DeckVoidStack label="VOID" count={player.voidZone.length} accentColor={theme.primary} onClick={onOpenVoid} playerId={playerId} />
            </>
          )}
        </div>
        <div className="flex gap-1.5 row-start-1 col-start-2 justify-self-center">
          {player.apexSlots.map((apex, i) => (
            <ApexSlotOrGhost
              key={i}
              slotIndex={i}
              apex={apex}
              state={state}
              playerId={playerId}
              onClick={onApexClick}
              highlight={apex ? apexHighlight?.(apex.instanceId) ?? null : null}
              disabled={apex ? apexDisabled?.(apex.instanceId) : false}
              selected={apex ? selectedApexId === apex.instanceId : false}
              onInspect={onInspectCard}
            />
          ))}
        </div>
        <div className="flex gap-2 items-start row-start-1 col-start-3 justify-start">
          {flipped ? (
            <>
              <DeckVoidStack label="DECK" count={player.deck.length} accentColor={theme.primary} />
              <DeckVoidStack label="VOID" count={player.voidZone.length} accentColor={theme.primary} onClick={onOpenVoid} playerId={playerId} />
            </>
          ) : (
            <div className="flex gap-1.5">
              {player.supportSlots.map((support, i) => (
                <SupportSlotOrGhost
                  key={i}
                  slotIndex={i}
                  support={support}
                  state={state}
                  playerId={playerId}
                  onClick={onSupportClick}
                  disabled={support ? supportDisabled?.(support.instanceId) : false}
                  selected={support ? selectedSupportId === support.instanceId : false}
                  onInspect={onInspectCard}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, colorClass, danger }: { label: string; value: number | string; colorClass: string; danger?: boolean }) {
  return (
    <span className={danger ? 'text-red-400 animate-pulse' : colorClass}>
      {label} <b>{value}</b>
    </span>
  );
}

/** Checks for an active destroy-ghost when a slot is empty, so a just-destroyed
 *  Apex keeps rendering (with its destroy-shake animation) for the brief window
 *  it's alive in the animation store, instead of the slot jumping straight to
 *  "empty" in the same instant the card leaves play. A ghost is never interactive -
 *  no click, no selection, no inspect - it's a fading remnant, not a real piece. */
function ApexSlotOrGhost({
  slotIndex,
  apex,
  state,
  playerId,
  onClick,
  highlight,
  disabled,
  selected,
  onInspect,
}: {
  slotIndex: number;
  apex: CardInstance | null;
  state: GameState;
  playerId: PlayerId;
  onClick?: (id: string) => void;
  highlight: 'valid-target' | 'attacked' | 'locked' | null;
  disabled?: boolean;
  selected?: boolean;
  onInspect?: (instance: CardInstance) => void;
}) {
  const ghost = useSlotGhost(playerId, slotIndex, 'apex');
  if (!apex && ghost?.destroyedGhost) {
    return <ApexSlot apex={ghost.destroyedGhost.instance} state={state} playerId={playerId} highlight={null} />;
  }
  return (
    <ApexSlot
      apex={apex}
      state={state}
      playerId={playerId}
      onClick={onClick}
      highlight={highlight}
      disabled={disabled}
      selected={selected}
      onInspect={onInspect}
    />
  );
}

function ApexSlot({
  apex,
  state,
  playerId,
  onClick,
  highlight,
  disabled,
  selected,
  onInspect,
}: {
  apex: CardInstance | null;
  state: GameState;
  playerId: PlayerId;
  onClick?: (id: string) => void;
  highlight: 'valid-target' | 'attacked' | 'locked' | null;
  disabled?: boolean;
  selected?: boolean;
  onInspect?: (instance: CardInstance) => void;
}) {
  if (!apex) {
    const emptyWidth = Math.round(APEX_BOARD_HEIGHT * getArtAspectRatio('Apex'));
    return (
      <div
        className="rounded-md border border-dashed border-white/15 flex items-center justify-center text-[9px] text-white/25 text-center px-1"
        style={{ width: emptyWidth, height: APEX_BOARD_HEIGHT }}
      >
        empty Apex slot
      </div>
    );
  }
  const effDef = getEffectiveDef(state, apex.instanceId);
  const apexCardDef = getCardDef(apex.defId);
  const shownDef = effDef === 0 && apexCardDef.type === 'Apex' && !findApexAnywhere(state, apex.instanceId) ? apexCardDef.baseDef : effDef;
  const attackPreviews: Record<string, NonNullable<ReturnType<typeof getPreviewAttackDamage>>> = {};
  if (apexCardDef.type === 'Apex') {
    for (const atk of apexCardDef.attacks) {
      const preview = getPreviewAttackDamage(state, apex.instanceId, atk.id);
      if (preview) attackPreviews[atk.id] = preview;
    }
  }

  // Chain indicator: which Ability Support (if any) is chained to this Apex.
  const chainedSupport = getChainedSupportFor(state, playerId, apex.instanceId);

  const cardEl = (
    <Card
      instance={apex}
      size="apexBoard"
      compact
      effectiveDef={shownDef}
      attackPreviews={attackPreviews}
      onClick={onClick ? () => onClick(apex.instanceId) : undefined}
      onInspect={onInspect ? () => onInspect(apex) : undefined}
      highlight={apex.hasAttacked ? 'attacked' : highlight}
      disabled={disabled}
      selected={selected}
      footer={
        chainedSupport ? (
          <div className="mt-0.5 px-1 rounded bg-black/40 border border-teal-400/40 text-teal-300 truncate">
            Sup: {getCardDef(chainedSupport.defId).name}
          </div>
        ) : undefined
      }
    />
  );

  // The attached-Equip flap only applies once the Apex is rendering via its art
  // template (ApexCardRenderer) - it needs a known, stable pixel width to match
  // seamlessly against, which only the art path (not the flow-layout fallback)
  // gives us. Apexes without art keep the existing inline "Equip: Name" text line
  // (still rendered inside Card's flow-layout path) instead.
  const hasApexArt = !!getCardArt(apex.defId);
  if (apex.equip && hasApexArt) {
    const apexArtWidth = Math.round(APEX_BOARD_HEIGHT * getArtAspectRatio('Apex'));
    return (
      <div className="flex flex-col shrink-0" style={{ width: apexArtWidth }}>
        <ApexVfxOverlay apexInstanceId={apex.instanceId} faction={apexCardDef.faction} spotlight={highlight === 'valid-target'}>
          {cardEl}
        </ApexVfxOverlay>
        <EquipFlap key={apex.equip.instanceId} equipInstance={apex.equip} width={apexArtWidth} onInspect={onInspect ? () => onInspect(apex.equip!) : undefined} />
      </div>
    );
  }

  return (
    <ApexVfxOverlay apexInstanceId={apex.instanceId} faction={apexCardDef.faction} spotlight={highlight === 'valid-target'}>
      {cardEl}
    </ApexVfxOverlay>
  );
}

/** Reads live combat visual events for one Apex (Commit 23) and applies a
 *  transient CSS animation class plus a floating damage-number popup, on top of
 *  the card underneath - never touches the card's own rendering or props, so this
 *  can never affect what Card.tsx itself does. Picks at most one active animation
 *  class at a time (destroy takes priority over hit takes priority over the
 *  attack-declare pulse) since these fire in sequence during one attack, not
 *  simultaneously, and stacking classes would just fight each other visually. */
function ApexVfxOverlay({
  apexInstanceId,
  faction,
  children,
  spotlight,
}: {
  apexInstanceId: string;
  faction: Faction;
  children: React.ReactNode;
  spotlight?: boolean;
}) {
  const events = useApexVisualEvents(apexInstanceId);
  const theme = factionTheme(faction);
  const tutorialMode = useGameStore((s) => s.tutorialMode);
  const vfxClass = events.some((e) => e.type === 'CARD_DESTROYED')
    ? 'vfx-destroy-shake'
    : events.some((e) => e.type === 'CARD_HIT')
    ? 'vfx-hit-flash'
    : events.some((e) => e.type === 'ATTACK_DECLARED')
    ? 'vfx-attack-pulse'
    : events.some((e) => e.type === 'ENGINE_TRIGGER')
    ? 'vfx-engine-pulse'
    : events.some((e) => e.type === 'CARD_PLACED')
    ? 'vfx-place-glow'
    : '';
  const popups = events.filter((e) => e.label);

  return (
    <div
      className={`relative ${vfxClass} ${spotlight ? 'tutorial-spotlight' : tutorialMode ? 'tutorial-stay-bright' : ''}`}
      style={{
        ['--react-glow-color' as string]: `${theme.primary}cc`,
        ['--place-glow-color' as string]: `${theme.primary}dd`,
        ['--engine-pulse-color' as string]: `${theme.primary}cc`,
        ['--faction-primary' as string]: `${theme.primary}99`,
        ['--faction-secondary' as string]: `${theme.secondary}aa`,
        ['--faction-impact' as string]: `${theme.primary}aa`,
      }}
    >
      {children}
      {popups.map((p) => (
        <div
          key={p.id}
          className="vfx-damage-popup absolute left-1/2 top-1/3 -translate-x-1/2 z-20 pointer-events-none font-mono font-bold text-sm whitespace-nowrap"
          style={{ color: p.type === 'CARD_HIT' ? '#f87171' : '#fb923c', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}
        >
          {p.label}
        </div>
      ))}
    </div>
  );
}

/** Same reasoning as ApexSlotOrGhost - a destroyed chained Engine (Commit 26) now
 *  gets the same "stay visible through the destroy animation" treatment an Apex
 *  already had, instead of vanishing from its slot the instant it's removed from
 *  supportSlots. */
function SupportSlotOrGhost({
  slotIndex,
  support,
  state,
  playerId,
  onClick,
  disabled,
  selected,
  onInspect,
}: {
  slotIndex: number;
  support: CardInstance | null;
  state: GameState;
  playerId: PlayerId;
  onClick?: (id: string) => void;
  disabled?: boolean;
  selected?: boolean;
  onInspect?: (instance: CardInstance) => void;
}) {
  const ghost = useSlotGhost(playerId, slotIndex, 'support');
  if (!support && ghost?.destroyedGhost) {
    return <SupportSlot support={ghost.destroyedGhost.instance} state={state} playerId={playerId} />;
  }
  return (
    <SupportSlot
      support={support}
      state={state}
      playerId={playerId}
      onClick={onClick}
      disabled={disabled}
      selected={selected}
      onInspect={onInspect}
    />
  );
}

function SupportSlot({
  support,
  state,
  playerId,
  onClick,
  disabled,
  selected,
  onInspect,
}: {
  support: CardInstance | null;
  state: GameState;
  playerId: PlayerId;
  onClick?: (id: string) => void;
  disabled?: boolean;
  selected?: boolean;
  onInspect?: (instance: CardInstance) => void;
}) {
  // Hooks must run unconditionally on every render, so this is called before the
  // early "empty slot" return below, with a fallback id that will just never match
  // any real event when there's no support in this slot.
  const events = useApexVisualEvents(support?.instanceId ?? '__none__');

  if (!support) {
    const emptyWidth = Math.round(SUPPORT_BOARD_HEIGHT * getArtAspectRatio('AbilitySupport'));
    return (
      <div
        className="rounded-md border border-dashed border-white/15 flex items-center justify-center text-[8.5px] text-white/25 text-center px-1"
        style={{ width: emptyWidth, height: SUPPORT_BOARD_HEIGHT }}
      >
        empty Support slot
      </div>
    );
  }
  const chainLabel = getChainLabelForSupport(state, playerId, support.instanceId);
  const supportDef = getCardDef(support.defId);
  const placeTheme = factionTheme(supportDef.faction);
  const vfxClass = events.some((e) => e.type === 'CARD_DESTROYED')
    ? 'vfx-destroy-shake'
    : events.some((e) => e.type === 'ENGINE_TRIGGER')
    ? 'vfx-engine-pulse'
    : events.some((e) => e.type === 'CARD_PLACED')
    ? 'vfx-place-glow'
    : '';

  return (
    <div
      className={`rounded-md ${vfxClass} ${state.tutorialMode ? 'tutorial-stay-bright' : ''}`}
      style={{
        ['--place-glow-color' as string]: `${placeTheme.primary}dd`,
        ['--engine-pulse-color' as string]: `${placeTheme.primary}cc`,
      }}
    >
      <Card
        instance={support}
        size="supportBoard"
        compact
        onClick={onClick ? () => onClick(support.instanceId) : undefined}
        onInspect={onInspect ? () => onInspect(support) : undefined}
        disabled={disabled}
        selected={selected}
        footer={
          <div className="mt-0.5 text-[7.5px] leading-tight opacity-80 space-y-0.5">
            {chainLabel && (
              <div className={chainLabel === 'Unchained' ? 'text-red-300' : 'text-emerald-300'}>{chainLabel}</div>
            )}
            {support.lockedByControlConflict && <div className="text-blue-300">LOCKED</div>}
          </div>
        }
      />
    </div>
  );
}
