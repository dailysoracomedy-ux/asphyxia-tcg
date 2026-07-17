'use client';

import type { CardInstance, Faction, GameState, PlayerId } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { useGameStore } from '@/store/gameStore';
import { getEffectiveDef, getPreviewAttackDamage, getChainedSupportFor, getChainLabelForSupport, findApexAnywhere } from '@/game/rules';
import Card from './Card';
import EquipFlap from './EquipFlap';
import DeckVoidStack from './DeckVoidStack';
import ActionZone from './ActionZone';
import { factionTheme } from '@/lib/theme';
import { getPlaymat } from '@/lib/cosmetics';
import { useCosmeticsStore } from '@/store/cosmeticsStore';
import { getCardArt, getArtAspectRatio } from '@/lib/cardArt';
import { fluidBoardDimension } from '@/lib/responsiveCard';
import { useApexVisualEvents, usePlayerVisualEvents, useSlotGhost } from '@/store/animationStore';
import type { DragState } from '@/ui/dragDrop/dragDropTypes';
import { zoneKey } from '@/ui/dragDrop/dragDropTypes';

/** Matches Card.tsx's 'apexBoard' size preset height - the Equip flap needs this to
 *  compute a matching width, and it's cheaper to name the constant once here than
 *  import Card's internal SIZE_MAP just for one number. */
const APEX_BOARD_HEIGHT = 262;
/** Matches Card.tsx's 'supportBoard' size preset height, same reasoning as above. */
const SUPPORT_BOARD_HEIGHT = 185;

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
  /** Commit 30 - current drag state (null outside an active drag). Threaded
   *  down so slots can tag themselves as drop zones and glow when legal/
   *  hovered, using the exact same DragState the drag started from - one
   *  source of truth, not a parallel highlight computation. */
  drag?: DragState | null;
  /** Commit 30 - starts an attack-target drag from the player's own attacking
   *  Apex, once an attacker and attack are already chosen by click (see
   *  GameBoard.tsx's mode === 'attackAwaitingTarget'). Only relevant for the
   *  active player's own board. */
  onApexAttackDragStart?: (e: React.PointerEvent, instanceId: string) => void;
  /** Commit 38 - optional content rendered directly under the Support/Engine
   *  slots column, in the board's own grid (not centered under the whole
   *  board from outside) - used for End Turn/Engine Reconfig, so they
   *  genuinely align under the Engines regardless of dynamic sizing. */
  footer?: React.ReactNode;
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
  drag,
  onApexAttackDragStart,
  footer,
}: PlayerBoardProps) {
  const player = state.players[playerId];
  const theme = factionTheme(player.faction);
  // Commit 42 - this seat's equipped playmat (cosmeticsStore). 'faction'
  // means the original per-faction radial, so default behavior is unchanged.
  const playmat = useCosmeticsStore((s) => getPlaymat(s.loadouts[playerId].playmat));
  const isActiveTurn = state.status === 'playing' && state.activePlayerId === playerId;
  const reactEvents = usePlayerVisualEvents(playerId).filter((e) => e.type === 'REACT_PLAYED' || e.type === 'CARD_NEGATED');
  const reactVfxClass = reactEvents.length > 0 ? (reactEvents.some((e) => e.type === 'CARD_NEGATED') ? 'vfx-negate-glitch' : 'vfx-react-highlight') : '';

  return (
    <div
      ref={containerRef}
      className={`relative rounded-lg border p-1.5 scanlines min-h-0 flex flex-col w-fit max-w-full mx-auto ${isActiveTurn ? 'active-board-glow' : ''} ${reactVfxClass}`}
      style={{
        borderColor: playmat.edge ? `${playmat.edge}66` : `${theme.border}55`,
        background:
          playmat.background ??
          `radial-gradient(ellipse at 50% ${flipped ? '0%' : '100%'}, ${theme.primary}14, #05050a 70%)`,
        transform: 'perspective(1100px) rotateX(11deg)',
        transformOrigin: 'center center',
        // Commit 44 - the board's 11-degree tilt existed since Commit 23, but
        // everything on it rendered flat. preserve-3d (here and on the grid
        // below) lets the slot columns take small translateZ lifts, which the
        // existing tilt turns into true parallax against the mat.
        transformStyle: 'preserve-3d',
        ['--active-glow-color' as string]: `${theme.primary}99`,
      }}
    >
      {/* Mat surface treatment (Commit 44): bevel - the top edge catches the
          light, the bottom falls into shadow - plus a soft specular sheen
          sweeping from the top-left, per the app-wide unified light
          convention (globals.css). Purely paint: pointer-transparent, and it
          sits under the (relative) content grid. */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-lg pointer-events-none"
        style={{
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -3px 9px rgba(0,0,0,0.45)',
          background:
            'linear-gradient(115deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 26%, transparent 45%)',
        }}
      />
      <div
        className="relative flex-1 min-h-0 grid gap-3 justify-center"
        style={{ gridTemplateColumns: 'minmax(0,auto) auto minmax(0,auto)', alignItems: flipped ? 'end' : 'start', transformStyle: 'preserve-3d' }}
      >
        <div className={`flex gap-2 items-start row-start-1 col-start-1 justify-end ${flipped ? 'lift-support' : 'lift-piles'}`}>
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
                  drag={drag}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1 items-center">
              <div className="flex gap-1">
                <DeckVoidStack label="DECK" count={player.deck.length} accentColor={theme.primary} playerId={playerId} />
                <DeckVoidStack label="VOID" count={player.voidZone.length} accentColor={theme.primary} onClick={onOpenVoid} playerId={playerId} />
              </div>
              <ActionZone playerId={playerId} drag={drag} tutorialMode={state.tutorialMode} />
            </div>
          )}
        </div>
        <div className="flex gap-1.5 row-start-1 col-start-2 justify-self-center lift-apex">
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
              drag={drag}
              onAttackDragStart={onApexAttackDragStart}
              flipped={flipped}
            />
          ))}
        </div>
        <div className={`flex flex-col gap-1.5 row-start-1 col-start-3 items-start relative ${flipped ? 'lift-piles' : 'lift-support'}`}>
          <div className="flex gap-2 items-start justify-start">
            {flipped ? (
              <div className="flex flex-col gap-1 items-center">
                <div className="flex gap-1">
                  <DeckVoidStack label="DECK" count={player.deck.length} accentColor={theme.primary} playerId={playerId} />
                  <DeckVoidStack label="VOID" count={player.voidZone.length} accentColor={theme.primary} onClick={onOpenVoid} playerId={playerId} />
                </div>
                <ActionZone playerId={playerId} drag={drag} tutorialMode={state.tutorialMode} />
              </div>
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
                    drag={drag}
                  />
                ))}
              </div>
            )}
          </div>
          {footer && <div className="absolute top-full left-0 w-full flex justify-center mt-1.5">{footer}</div>}
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
  drag,
  onAttackDragStart,
  flipped,
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
  drag?: DragState | null;
  onAttackDragStart?: (e: React.PointerEvent, instanceId: string) => void;
  /** Commit 43 - which way this board faces on screen: battle animations
   *  (lunge, knockback) are direction-aware, and screen direction is a view
   *  concern, so it's threaded from PlayerBoard rather than derived from
   *  player identity (which hotseat view-flipping would get wrong). */
  flipped?: boolean;
}) {
  const ghost = useSlotGhost(playerId, slotIndex, 'apex');
  if (!apex && ghost?.destroyedGhost) {
    return <ApexSlot apex={ghost.destroyedGhost.instance} state={state} playerId={playerId} highlight={null} flipped={flipped} />;
  }

  // Commit 30 - which drop zone (if any) this slot represents right now.
  // Empty slot: a legal spot to drag a new Apex into. Occupied slot: a legal
  // target for a dragged Equip, targeted Special, or (via onAttackDragStart)
  // the drag SOURCE for an already-chosen attack.
  const dropZone = apex
    ? { kind: 'own-apex' as const, playerId, instanceId: apex.instanceId }
    : { kind: 'apex-slot' as const, playerId, slotIndex };
  const key = zoneKey(dropZone);
  const isLegalDropTarget = !!drag?.active && drag.source?.kind !== 'apex-attack' && drag.legalZoneKeys.has(key);
  const isHovered = drag?.hoveredZoneKey === key;

  const body = (
    <ApexSlot
      apex={apex}
      state={state}
      playerId={playerId}
      onClick={onClick}
      highlight={highlight}
      disabled={disabled}
      selected={selected}
      onInspect={onInspect}
      flipped={flipped}
    />
  );

  return (
    <div
      data-dropzone={isLegalDropTarget ? JSON.stringify(dropZone) : undefined}
      onPointerDown={apex && onAttackDragStart ? (e) => onAttackDragStart(e, apex.instanceId) : undefined}
      className={
        isLegalDropTarget
          ? `rounded-md transition-shadow ${isHovered ? 'ring-4 ring-emerald-300 shadow-[0_0_30px_rgba(52,211,153,0.9)]' : 'ring-2 ring-emerald-400/70 shadow-[0_0_16px_rgba(52,211,153,0.5)]'}`
          : undefined
      }
    >
      {body}
    </div>
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
  flipped,
}: {
  apex: CardInstance | null;
  state: GameState;
  playerId: PlayerId;
  onClick?: (id: string) => void;
  highlight: 'valid-target' | 'attacked' | 'locked' | null;
  disabled?: boolean;
  selected?: boolean;
  onInspect?: (instance: CardInstance) => void;
  flipped?: boolean;
}) {
  if (!apex) {
    // Commit 50.2 - fluid-matched to a real Apex card (see the EquipFlap fix
    // below for the actual reported bug this is adjacent to): an empty slot
    // now shrinks in lockstep with filled ones instead of staying pinned at
    // the old static size, so slots don't visually mismatch on short screens.
    const emptyHeight = fluidBoardDimension(APEX_BOARD_HEIGHT);
    const emptyWidth = `calc(${emptyHeight} * ${getArtAspectRatio('Apex').toFixed(4)})`;
    return (
      <div
        className={`rounded-md slot-etched flex items-center justify-center text-[10px] text-white/35 text-center px-1 ${state.tutorialMode ? 'tutorial-stay-bright' : ''}`}
        style={{ width: emptyWidth, height: emptyHeight }}
      >
        empty Apex slot
      </div>
    );
  }
  // Commit 29.13: display the Apex's real, normal DEF during tutorial mode,
  // even while it's internally protected by survivorDefOverride (a real,
  // existing game mechanic used to guarantee the tutorial's scripted sequence
  // survives an unscripted opponent attack - see tutorialProtectSurvivor in
  // gameStore.ts). Reported directly, correctly: showing "DEF 1500" on a card
  // that's normally 400 looks absurd and completely unrealistic to a player
  // who has no way to know it's a temporary safety mechanism. The actual
  // combat math used to resolve attacks elsewhere is completely untouched -
  // this only ever affects what number the player sees on the card itself.
  const effDef = getEffectiveDef(state, apex.instanceId, state.tutorialMode);
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
    // Commit 50.2 - BUG FIX: this was `Math.round(APEX_BOARD_HEIGHT * ratio)`,
    // a static number computed from the OLD fixed apex height. Commit 50 made
    // the actual Apex card (Card.tsx) shrink fluidly on short viewports via
    // fluidBoardDimension() - this width fed to EquipFlap never followed, so
    // the flap silently drifted wider than the real card on any window under
    // ~1000px tall (the reported bug: "EQUIP is much larger than it should
    // be"). Now built from the exact same shared formula Card.tsx uses, so
    // the two are always pixel-identical, not just usually close.
    const apexArtWidth = `calc(${fluidBoardDimension(APEX_BOARD_HEIGHT)} * ${getArtAspectRatio('Apex').toFixed(4)})`;
    return (
      <div className="flex flex-col shrink-0" style={{ width: apexArtWidth }}>
        <ApexVfxOverlay apexInstanceId={apex.instanceId} faction={apexCardDef.faction} spotlight={highlight === 'valid-target'} flipped={flipped}>
          {cardEl}
        </ApexVfxOverlay>
        <EquipFlap key={apex.equip.instanceId} equipInstance={apex.equip} width={apexArtWidth} onInspect={onInspect ? () => onInspect(apex.equip!) : undefined} />
      </div>
    );
  }

  return (
    <ApexVfxOverlay apexInstanceId={apex.instanceId} faction={apexCardDef.faction} spotlight={highlight === 'valid-target'} flipped={flipped}>
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
  flipped,
}: {
  apexInstanceId: string;
  faction: Faction;
  children: React.ReactNode;
  spotlight?: boolean;
  /** Screen orientation of this card's board - drives lunge/knockback
   *  direction (Commit 43). Bottom board attacks upward, top board downward. */
  flipped?: boolean;
}) {
  const events = useApexVisualEvents(apexInstanceId);
  const theme = factionTheme(faction);
  const tutorialMode = useGameStore((s) => s.tutorialMode);
  // Commit 43 - the battle animation set: real motion (lunge, knockback,
  // shatter, slam) replacing the old scale/brightness pulses. Same one-class-
  // at-a-time priority order as before - these fire in sequence during one
  // attack, and stacking transform animations would fight each other.
  const hitEvent = events.find((e) => e.type === 'CARD_HIT');
  const vfxClass = events.some((e) => e.type === 'CARD_DESTROYED')
    ? 'vfx-destroy-shatter'
    : hitEvent
    ? 'vfx-impact-hit'
    : events.some((e) => e.type === 'ATTACK_DECLARED')
    ? 'vfx-attack-lunge'
    : events.some((e) => e.type === 'ENGINE_TRIGGER')
    ? 'vfx-engine-pulse'
    : events.some((e) => e.type === 'CARD_PLACED')
    ? 'vfx-place-slam vfx-place-glow'
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
        // Toward-the-enemy sign for lunge (attacker) and knockback (defender):
        // bottom board = up (-Y on screen means multiplying by -1 inside the
        // keyframes' calc, so the var itself is +1), flipped board = opposite.
        ['--lunge' as string]: flipped ? -1 : 1,
        ['--impact-color' as string]: theme.secondary,
      }}
    >
      {children}
      {/* Impact garnish - shockwave ring + spark burst, keyed to the specific
          hit event so back-to-back hits each get their own fresh burst. */}
      {hitEvent && (
        <div key={hitEvent.id} className="pointer-events-none absolute inset-0 z-[19]">
          <div className="vfx-shockwave-ring" />
          <div className="vfx-impact-sparks" />
        </div>
      )}
      {/* Commit 47 particles: debris chunks + faction embers when destroyed,
          a dust puff when a card lands on the slot. */}
      {(() => {
        const destroyEvent = events.find((e) => e.type === 'CARD_DESTROYED');
        if (destroyEvent) return <div key={destroyEvent.id} className="vfx-debris" />;
        const placedEvent = events.find((e) => e.type === 'CARD_PLACED');
        if (placedEvent) return <div key={placedEvent.id} className="vfx-place-dust" />;
        return null;
      })()}
      {popups.map((p) => {
        // Severity read straight off the label the game store already
        // formatted ("-650", "-200 O2") - no new rule knowledge here.
        const dmg = p.label ? Math.abs(parseInt(p.label, 10)) || 0 : 0;
        const heavy = p.type === 'CARD_HIT' && dmg >= 500;
        // Deterministic per-event tilt/offset from the event id, so numbers
        // from rapid consecutive hits scatter instead of stacking exactly.
        const seed = p.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
        const tilt = ((seed % 11) - 5) * 1.2;
        const xOff = ((seed % 7) - 3) * 5;
        return (
          <div
            key={p.id}
            className={`${heavy ? 'vfx-damage-pop-heavy text-2xl' : 'vfx-damage-popup text-base'} absolute left-1/2 top-1/3 z-20 pointer-events-none font-mono font-black whitespace-nowrap`}
            style={{
              marginLeft: xOff,
              ['--pop-tilt' as string]: `${tilt}deg`,
              transform: heavy ? undefined : 'translateX(-50%)',
              color: heavy ? '#ff3b3b' : p.type === 'CARD_HIT' ? '#f87171' : '#fb923c',
              textShadow: heavy
                ? '0 0 12px rgba(255,59,59,0.8), 0 2px 4px rgba(0,0,0,0.95)'
                : '0 0 8px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.9)',
            }}
          >
            {p.label}
          </div>
        );
      })}
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
  drag,
}: {
  slotIndex: number;
  support: CardInstance | null;
  state: GameState;
  playerId: PlayerId;
  onClick?: (id: string) => void;
  disabled?: boolean;
  selected?: boolean;
  onInspect?: (instance: CardInstance) => void;
  drag?: DragState | null;
}) {
  const ghost = useSlotGhost(playerId, slotIndex, 'support');
  if (!support && ghost?.destroyedGhost) {
    return <SupportSlot support={ghost.destroyedGhost.instance} state={state} playerId={playerId} />;
  }

  const body = (
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

  // Commit 30 - only empty slots are drop zones (Engines don't have an
  // in-place swap/re-target mechanic the way Equips do).
  if (support) return body;
  const dropZone = { kind: 'support-slot' as const, playerId, slotIndex };
  const key = zoneKey(dropZone);
  const isLegalDropTarget = !!drag?.active && drag.legalZoneKeys.has(key);
  const isHovered = drag?.hoveredZoneKey === key;
  return (
    <div
      data-dropzone={isLegalDropTarget ? JSON.stringify(dropZone) : undefined}
      className={
        isLegalDropTarget
          ? `rounded-md transition-shadow ${isHovered ? 'ring-4 ring-emerald-300 shadow-[0_0_30px_rgba(52,211,153,0.9)]' : 'ring-2 ring-emerald-400/70 shadow-[0_0_16px_rgba(52,211,153,0.5)]'}`
          : undefined
      }
    >
      {body}
    </div>
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
        className={`rounded-md slot-etched flex items-center justify-center text-[9.5px] text-white/35 text-center px-1 ${state.tutorialMode ? 'tutorial-stay-bright' : ''}`}
        style={{ width: emptyWidth, height: SUPPORT_BOARD_HEIGHT }}
      >
        empty Support slot
      </div>
    );
  }
  const chainLabel = getChainLabelForSupport(state, playerId, support.instanceId);
  const supportDef = getCardDef(support.defId);
  const placeTheme = factionTheme(supportDef.faction);
  // Commit 47 - Engines short-circuit: played or triggering engines get an
  // erratic electric spark burst plus an arc-flicker on the card itself.
  const engineSparkEvent = events.find((e) => e.type === 'CARD_PLACED' || e.type === 'ENGINE_TRIGGER');
  const supportDestroyEvent = events.find((e) => e.type === 'CARD_DESTROYED');
  const vfxClass = events.some((e) => e.type === 'CARD_DESTROYED')
    ? 'vfx-destroy-shatter'
    : events.some((e) => e.type === 'ENGINE_TRIGGER')
    ? 'vfx-engine-pulse vfx-engine-arc'
    : events.some((e) => e.type === 'CARD_PLACED')
    ? 'vfx-place-slam vfx-place-glow vfx-engine-arc'
    : '';

  return (
    <div
      className={`relative rounded-md ${vfxClass} ${state.tutorialMode ? 'tutorial-stay-bright' : ''}`}
      style={{
        ['--place-glow-color' as string]: `${placeTheme.primary}dd`,
        ['--engine-pulse-color' as string]: `${placeTheme.primary}cc`,
        ['--impact-color' as string]: placeTheme.secondary,
      }}
    >
      {engineSparkEvent && <div key={engineSparkEvent.id} className="vfx-engine-sparks" />}
      {supportDestroyEvent && <div key={supportDestroyEvent.id} className="vfx-debris" />}
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
