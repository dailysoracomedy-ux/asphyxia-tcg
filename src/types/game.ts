// ==========================================================================
// ASPHYXIA v0.2.1 - Core Type Definitions
// ==========================================================================

export type Faction = 'Neon Underground' | 'Dark White' | 'Synth Ascendancy';

// ASPHYXIA has 5 card types: Apex, Engine, Equip, Special, React.
// "Engine" is the umbrella term for AbilitySupport/BatterySupport (still mechanically
// distinct internally - chaining only applies to AbilitySupport). "React" is the
// umbrella term for Reaction (still internally just 'Reaction') - cancel-style Reacts
// (formerly the separate 'Negate' type) are identified by the NEGATE tag, not a
// separate CardType. See getCardTypeLabel() in lib/theme.ts for the display strings
// ("Engine — Ability", "React — Negate", etc.) used throughout the UI.
export type CardType =
  | 'Apex'
  | 'AbilitySupport'
  | 'BatterySupport'
  | 'Equip'
  | 'Special'
  | 'Reaction';

export type SyncCost = 0 | 1 | 2 | 3;

export type PlayerId = 'player1' | 'player2';

export type CounterType = 'choke' | 'upgrade' | 'glitch';

// --------------------------------------------------------------------------
// Effect context objects passed to card effect functions.
// These are intentionally loose (engine passes in helper functions) so that
// card definitions can stay declarative-ish while still doing real logic.
// --------------------------------------------------------------------------

export interface EngineHelpers {
  log: (message: string, kind?: LogKind) => void;
  drawCards: (playerId: PlayerId, count: number) => void;
  gainMomentum: (playerId: PlayerId, amount: number) => void;
  loseMomentum: (playerId: PlayerId, amount: number) => void;
  gainO2: (playerId: PlayerId, amount: number) => void;
  loseO2: (playerId: PlayerId, amount: number, opts?: { fromOwnEffect?: boolean }) => void;
  addCounter: (apexInstanceId: string, type: CounterType, amount?: number, placedByPlayerId?: PlayerId) => void;
  removeCounter: (apexInstanceId: string, type: CounterType, amount?: number) => void;
  destroyApex: (apexInstanceId: string, opts?: { viaCombat?: boolean }) => void;
  discardFromHand: (playerId: PlayerId, cardInstanceId: string) => boolean;
  getApex: (apexInstanceId: string) => CardInstance | undefined;
  getPlayer: (playerId: PlayerId) => PlayerState;
  getOpponentId: (playerId: PlayerId) => PlayerId;
  getState: () => GameState;
  applyTempDefBuff: (apexInstanceId: string, amount: number, expiresAfterTurn: number) => void;
  applyProtection: (apexInstanceId: string, reduction: number, expiresAfterTurn: number) => void;
  armAttackBonus: (apexInstanceId: string, amount: number) => void;
  armOverclockBonus: (apexInstanceId: string, amount: number) => void;
  markPendingEndPhaseBuff: (apexInstanceId: string, amount: number) => void;
  markPendingEndPhaseProtection: (apexInstanceId: string, reduction: number) => void;
}

export interface EffectContext {
  helpers: EngineHelpers;
  ownerId: PlayerId; // the controller of the card/apex generating this effect
  cardInstanceId?: string;
  apexInstanceId?: string;
}

export interface AttackContext extends EffectContext {
  attackerInstanceId: string;
  targetInstanceId?: string; // apex instance id, absent if direct O2 attack
  syncCost: SyncCost;
  baseDamage: number;
}

// --------------------------------------------------------------------------
// Card Definitions (static data, may embed effect functions - not persisted)
// --------------------------------------------------------------------------

export interface AttackDef {
  id: string;
  name: string;
  syncCost: SyncCost;
  baseDamage: number;
  description: string;
  /** Extra damage on top of baseDamage + universal modifiers, computed at declare-attack time */
  bonusDamage?: (ctx: AttackContext) => number;
  /** Side effects resolved after damage/O2 loss has been applied */
  onResolve?: (ctx: AttackContext & { destroyedTarget: boolean; dealtO2Damage: boolean }) => void;
  /** Prevents attack from being redirected/cancelled by reactions (flavor flag, informational) */
  cannotBeRedirected?: boolean;
}

// --------------------------------------------------------------------------
// Engine Tag System - a scalable, data-driven way for the engine to answer
// "can this card create a Response Window for this event?" without hardcoding
// checks by card name or card type. Cards opt into instant-speed behavior by
// carrying tags; the engine only ever looks at tags to decide eligibility.
// This is an internal rules-engine concept and need not be shown to players.
// --------------------------------------------------------------------------

export type EngineTag =
  | 'INSTANT'
  | 'REACTION'
  | 'NEGATE'
  | 'ON_ATTACK_DECLARED'
  | 'ON_SPECIAL_PLAYED'
  | 'ON_EQUIP_PLAYED'
  | 'ON_REACTION_PLAYED'
  | 'ON_O2_DAMAGE'
  | 'ON_APEX_WOULD_BE_DESTROYED';

/** The event kinds the engine can open a Response Window for. */
export type ResponseEventKind =
  | 'ATTACK_DECLARED'
  | 'SPECIAL_PLAYED'
  | 'EQUIP_PLAYED'
  | 'REACTION_PLAYED'
  | 'O2_DAMAGE_PENDING'
  | 'APEX_WOULD_BE_DESTROYED';

/** Maps each response event to the single engine tag that makes a card eligible for it. */
export const RESPONSE_EVENT_TAG: Record<ResponseEventKind, EngineTag> = {
  ATTACK_DECLARED: 'ON_ATTACK_DECLARED',
  SPECIAL_PLAYED: 'ON_SPECIAL_PLAYED',
  EQUIP_PLAYED: 'ON_EQUIP_PLAYED',
  REACTION_PLAYED: 'ON_REACTION_PLAYED',
  O2_DAMAGE_PENDING: 'ON_O2_DAMAGE',
  APEX_WOULD_BE_DESTROYED: 'ON_APEX_WOULD_BE_DESTROYED',
};

/** Context describing a card that was just played, for SPECIAL_PLAYED / EQUIP_PLAYED / REACTION_PLAYED events. */
export interface PlayedCardEventData {
  cardType: 'Special' | 'Equip' | 'Reaction';
  cardFaction: Faction;
  cardOwnerId: PlayerId;
  cardInstanceId: string;
}

export type ResponseEvent =
  | { kind: 'ATTACK_DECLARED'; data: AttackTriggerData }
  | { kind: 'O2_DAMAGE_PENDING'; data: O2DamageTriggerData }
  | { kind: 'APEX_WOULD_BE_DESTROYED'; data: DestroyTriggerData }
  | { kind: 'SPECIAL_PLAYED'; data: PlayedCardEventData }
  | { kind: 'EQUIP_PLAYED'; data: PlayedCardEventData }
  | { kind: 'REACTION_PLAYED'; data: PlayedCardEventData };

export interface BaseCardDef {
  id: string;
  name: string;
  faction: Faction;
  rulesText: string;
  /** Internal engine tags (see EngineTag). Optional - most cards carry none. */
  tags?: EngineTag[];
}

export interface ApexDef extends BaseCardDef {
  type: 'Apex';
  baseDef: number;
  attacks: AttackDef[];
  onEnterPlay?: (ctx: EffectContext) => void;
  /** Fires when this Apex's attack destroys an enemy Apex */
  onDestroyEnemyApex?: (ctx: AttackContext & { destroyedApexInstanceId: string }) => void;
  /** Flat additive damage bonus applied to every attack by this apex, based on game state */
  passiveDamageBonus?: (ctx: AttackContext) => number;
  /** Flat additive DEF bonus based on game state (recomputed live) */
  passiveDefBonus?: (apex: CardInstance, state: GameState) => number;
  /** Reduce incoming damage from a specific attack (Glass Warden) */
  incomingDamageReduction?: (incomingSyncCost: SyncCost, incomingDamage: number) => number;
  /** Fires when this apex attacks a target that has a choke counter */
  onAttackTargetWithChoke?: (ctx: AttackContext) => void;
}

export interface AbilitySupportDef extends BaseCardDef {
  type: 'AbilitySupport';
  /** Fires after the chained Apex attacks (if allowed to activate) */
  syncAbility: (ctx: AttackContext & { chainedApexId: string; destroyedTarget: boolean; dealtO2Damage: boolean }) => void;
  syncAbilityText: string;
  /** Flat damage bonus applied immediately to the chained Apex's CURRENT attack (evaluated
   *  live during damage calculation, same as any other modifier) - distinct from
   *  syncAbility, which fires only after the attack has already resolved. Respects
   *  chained/locked/Reconfigure-locked state exactly like syncAbility does. */
  chainedAttackBonus?: (ctx: AttackContext) => number;
}

export interface BatterySupportDef extends BaseCardDef {
  type: 'BatterySupport';
  /** Fires when discarded/returned via Reconfigure */
  onReconfigureReturn?: (ctx: EffectContext) => void;
}

export interface EquipDef extends BaseCardDef {
  type: 'Equip';
  defBonus?: number;
  damageBonus?: (ctx: AttackContext) => number;
  onOverflowDamage?: (overflow: number) => number; // returns reduced overflow
  onEquippedDestroyed?: (ctx: EffectContext) => void;
}

export interface SpecialDef extends BaseCardDef {
  type: 'Special';
  canPlay?: (playerId: PlayerId, state: GameState) => boolean;
  resolve: (ctx: EffectContext & { targetApexInstanceId?: string }) => void;
  requiresTarget?: 'enemyApex' | 'ownApex' | 'enemyApexWithChoke' | 'ownApexWithUpgrade';
}

// A React (internally still 'Reaction') is either attack-triggered (sets `trigger`,
// no `canCancel`) or cancel-style (sets `canCancel`, no `trigger`, tagged NEGATE) -
// never both. This single interface replaces the old separate NegateDef; the NEGATE
// tag is what the UI/engine use to tell the two flavors apart, not the CardType.
export interface ReactionDef extends BaseCardDef {
  type: 'Reaction';
  cost: number;
  trigger?: 'enemyApexAttacks' | 'opponentAttackDealsO2Damage' | 'ownApexWouldBeDestroyed';
  canCancel?: (targetCardType: CardType, targetFaction: Faction) => boolean;
  resolve: (
    ctx: EffectContext & { eventData?: Record<string, unknown>; cancelledCardInstanceId?: string; cancelledFaction?: Faction }
  ) => Record<string, unknown> | void;
}

export type CardDef =
  | ApexDef
  | AbilitySupportDef
  | BatterySupportDef
  | EquipDef
  | SpecialDef
  | ReactionDef;

// --------------------------------------------------------------------------
// Runtime instances
// --------------------------------------------------------------------------

export interface TempModifier {
  id: string;
  amount: number; // can be negative
  expiresAfterTurn: number; // active while state.turnNumber <= expiresAfterTurn
  label: string;
}

export interface ProtectionInstance {
  id: string;
  reduction: number;
  expiresAfterTurn: number;
  label: string;
}

export interface CardInstance {
  instanceId: string;
  defId: string;
  type: CardType;
  // Apex runtime fields
  counters?: { choke: number; upgrade: number; glitch: number };
  equip?: CardInstance; // attached equip instance
  hasAttacked?: boolean;
  attackLockedForTurn?: number | null; // absolute turn number this apex is locked for
  armedBonus?: number; // consumed on this apex's next attack
  armedBonusIsOverclock?: boolean; // if true, the armed bonus came from Overclock (triggers its O2 cost on use)
  pendingEndPhaseDefBuff?: number; // accumulated DEF to apply at End Phase (Juice-Box / Logic Bloom)
  pendingJuiceBoxOverdrive?: boolean; // set for one attack only - consumed and cleared by Juice-Box's own syncAbility
  pendingEndPhaseProtection?: number; // accumulated protection to apply at End Phase (Gatekeeper Drone)
  survivorDefOverride?: number; // set by Backup Consciousness - overrides all DEF math while active
  tempDefBuffs?: TempModifier[];
  protections?: ProtectionInstance[];
  // Support runtime fields
  chainedApexId?: string | null;
  lockedByControlConflict?: boolean;
  enteredViaReconfigureTurn?: number | null; // if set to current turn, sync ability can't activate this turn
  // Equip runtime fields
  equippedTurn?: number | null; // turn number this Equip was attached - can't be Equip Swapped out the same turn
}

export interface TurnFlags {
  specialsPlayedThisTurn: number;
  supportsPlayedThisTurn: number;
  instantsPlayedThisTurn: number;
  cardsPlayedThisTurn: number;
  reconfigureUsedThisTurn: boolean;
  equipSwapUsedThisTurn: boolean;
  directO2LossThisTurn: number;
  firstSpecialResolved: boolean;
  chokeCounterPlacedThisTurn: boolean;
  ownEffectO2LossThisTurn: boolean;
  recursiveGlitchPlacedThisTurn: boolean;
  civilWarBonusArmedThisTurn: boolean;
}

export function freshTurnFlags(): TurnFlags {
  return {
    specialsPlayedThisTurn: 0,
    supportsPlayedThisTurn: 0,
    instantsPlayedThisTurn: 0,
    cardsPlayedThisTurn: 0,
    reconfigureUsedThisTurn: false,
    equipSwapUsedThisTurn: false,
    directO2LossThisTurn: 0,
    firstSpecialResolved: false,
    chokeCounterPlacedThisTurn: false,
    ownEffectO2LossThisTurn: false,
    recursiveGlitchPlacedThisTurn: false,
    civilWarBonusArmedThisTurn: false,
  };
}

export interface PlayerState {
  id: PlayerId;
  faction: Faction;
  deck: CardInstance[];
  hand: CardInstance[];
  voidZone: CardInstance[];
  apexSlots: (CardInstance | null)[]; // length 2
  supportSlots: (CardInstance | null)[]; // length 3
  o2: number;
  momentum: number;
  availableSync: number;
  turnFlags: TurnFlags;
  pendingAttackBonus: number; // "next attack this turn" flat bonus (Overclock, rift choice, etc.)
  pendingTargetedAttackBonus: { amount: number; targetInstanceId: string } | null;
  reserveGridShield: number; // Reserve Grid: reduces next O2 loss this turn by 1, per stack
  lockedSupportInstanceId: string | null; // Control Conflict: one locked support at a time
}

export type Phase = 'Start' | 'Main' | 'Combat' | 'End';

export type RiftSpaceId =
  | 'CivilWar'
  | 'HumanError'
  | 'ControlConflict'
  | 'EchoRiot'
  | 'WhiteRoomCollapse'
  | 'RecursiveFailure';

export interface RiftSpace {
  id: RiftSpaceId;
  name: string;
  description: string;
  /** Short one-line summary for the compact Rift strip - full text stays in `description`
   *  for the game-start log and the strip's hover tooltip. */
  shortDescription: string;
}

export type LogKind =
  | 'info'
  | 'draw'
  | 'play'
  | 'attack'
  | 'damage'
  | 'o2'
  | 'momentum'
  | 'rift'
  | 'support'
  | 'counter'
  | 'destroy'
  | 'win'
  | 'phase'
  | 'response';

export interface LogEntry {
  id: string;
  turn: number;
  message: string;
  kind: LogKind;
}

export interface AttackTriggerData {
  kind: 'enemyApexAttacks';
  attackerId: PlayerId;
  attackerInstanceId: string;
  attackDefId: string;
  targetInstanceId?: string;
  syncCost: SyncCost;
  totalDamage: number;
  cannotBeRedirected?: boolean;
}

export interface O2DamageTriggerData {
  kind: 'opponentAttackDealsO2Damage';
  attackerId: PlayerId;
  defenderId: PlayerId;
  amount: number;
  isOverflow: boolean;
  attackerInstanceId: string;
  attackDefId: string;
  targetInstanceId?: string;
  destroyedTarget: boolean;
}

export interface DestroyTriggerData {
  kind: 'ownApexWouldBeDestroyed';
  apexInstanceId: string;
  ownerId: PlayerId;
  fromAttack?: {
    attackerId: PlayerId;
    attackerInstanceId: string;
    attackDefId: string;
    syncCost: SyncCost;
    totalDamage: number;
    overflow: number;
  };
}

export type TriggerData = AttackTriggerData | O2DamageTriggerData | DestroyTriggerData;

export type ContinuationPayload =
  | { kind: 'resolveSpecial'; ownerId: PlayerId; targetApexInstanceId?: string }
  | { kind: 'resolveEquip'; ownerId: PlayerId; apexInstanceId: string }
  | { kind: 'resolveEquipSwap'; ownerId: PlayerId; apexInstanceId: string; oldEquipInstanceId: string }
  | { kind: 'resolveReactionThenFinishTrigger'; reactionOwnerId: PlayerId; trigger: TriggerData };

export interface ReactionChoiceWindow {
  id: string;
  stage: 'reactionChoice';
  respondingPlayerId: PlayerId;
  trigger: TriggerData;
}

export interface NegateWindow {
  id: string;
  stage: 'negateWindow';
  negatingPlayerId: PlayerId;
  cardOwnerId: PlayerId;
  cardInstanceId: string;
  cardDefId: string;
  cardType: 'Special' | 'Equip' | 'Reaction';
  cardFaction: Faction;
  continuation: ContinuationPayload;
  pendingCardInstance?: CardInstance; // held here for Equip cards until negate/pass resolves
}

export interface HumanErrorChoiceWindow {
  id: string;
  stage: 'humanErrorChoice';
  playerId: PlayerId;
}

export interface CivilWarChoiceWindow {
  id: string;
  stage: 'civilWarChoice';
  playerId: PlayerId;
}

export type PendingResponseItem = ReactionChoiceWindow | NegateWindow | HumanErrorChoiceWindow | CivilWarChoiceWindow;

export interface GameState {
  status: 'menu' | 'mulligan' | 'selectingOpeningApex' | 'playing' | 'gameover';
  players: Record<PlayerId, PlayerState>;
  activePlayerId: PlayerId;
  firstPlayerId: PlayerId | null;
  /** Commit 34 - set by resolveCoinFlip before opening-Apex selection even
   *  begins, for real player-initiated matches (Vs AI, Hotseat). Read by
   *  selectOpeningApex's own "who goes first" determination once both
   *  players have picked, taking priority over the older balance-based
   *  fallback (lower opening 0-Sync attack goes first) - that fallback still
   *  applies for AI vs AI and Tutorial, neither of which show the coin flip. */
  coinFlipFirstPlayerId?: PlayerId | null;
  turnNumber: number;
  phase: Phase;
  riftSpace: RiftSpace | null;
  log: LogEntry[];
  winnerId: PlayerId | null;
  pendingResponseQueue: PendingResponseItem[];
  isFirstTurnOverall: boolean;
  selectedFactions: { player1: Faction | null; player2: Faction | null };
  openingApexSelectionPlayerId: PlayerId | null;
  reconfigureAwaitingPlay: boolean;
  startPhasePending: boolean;
  debugMode: boolean; // when true, verbose response-eligibility checks are logged
  gameOverReason: string | null;
  /** When true, player2 is controlled by the simple built-in AI instead of a human. */
  vsAI: boolean;
  /** AI vs AI Showcase mode (Commit 29) - both players are AI-controlled. Kept as
   *  a separate flag from vsAI rather than overloading it, since vsAI's existing
   *  meaning ("player2 is AI, player1 is the human") drives several UI decisions
   *  (which side of the board is "the viewer", hiding player2's response popups,
   *  etc.) that don't apply here - in this mode nobody is the human, so the board
   *  behaves like Hotseat (flips to whoever's active) while both sides are driven
   *  by the AI. */
  aiVsAiMode?: boolean;
  /** Learn To Play tutorial mode (Commit 29) - a real, playable match with a
   *  fixed Neon Underground vs Dark White matchup, guided by TutorialPanel. The
   *  underlying game engine runs completely normally underneath - tutorial
   *  "scripting" is milestone-based (watching real state for "an Engine was
   *  played", "an attack was declared", etc.) rather than forcing specific plays,
   *  which keeps it from ever needing special-cased rule exceptions of its own. */
  tutorialMode?: boolean;
  /** True only from tutorial start until the player successfully plays their
   *  first Apex (Commit 29.4). Without this, maybeRunEmergencyApexDraw's normal
   *  "no Apex at Main Phase start" safety valve would auto-play Street-Beast the
   *  instant the tutorial's first Main Phase began - correct behavior for a
   *  normal match, but it would completely skip over Step 1's actual teaching
   *  moment (the player manually playing their first Apex) before the player
   *  ever got a chance to. Cleared the moment the real play happens, so Step 8's
   *  own recovery demonstration later in the same match is entirely unaffected. */
  tutorialAwaitingFirstApex?: boolean;
}
