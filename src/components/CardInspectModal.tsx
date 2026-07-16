'use client';

import { useEffect } from 'react';
import type { CardInstance, GameState, PlayerId } from '@/types/game';
import { getCardDef } from '@/data/cards';
import { getEffectiveDef, getPreviewAttackDamage, getChainedSupportFor, getChainLabelForSupport } from '@/game/rules';
import { factionTheme, getCardTypeLabel } from '@/lib/theme';

export type InspectZone = 'Hand' | 'Field' | 'Void' | 'Attached';

interface CardInspectModalProps {
  instance: CardInstance;
  state: GameState;
  /** Whose card this is, if known - needed to compute board-specific info (DEF, chain, etc). */
  ownerId: PlayerId | null;
  zone: InspectZone;
  onClose: () => void;
}

function findEquippedOwner(state: GameState, equipInstanceId: string): { ownerId: PlayerId; apexName: string } | null {
  for (const pid of ['player1', 'player2'] as const) {
    for (const apex of state.players[pid].apexSlots) {
      if (apex?.equip?.instanceId === equipInstanceId) {
        return { ownerId: pid, apexName: getCardDef(apex.defId).name };
      }
    }
  }
  return null;
}

export default function CardInspectModal({ instance, state, ownerId, zone, onClose }: CardInspectModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const def = getCardDef(instance.defId);
  const theme = factionTheme(def.faction);
  const isApex = def.type === 'Apex';
  const isSupport = def.type === 'AbilitySupport' || def.type === 'BatterySupport';

  const effDef = isApex && ownerId ? getEffectiveDef(state, instance.instanceId, state.tutorialMode) : null;
  const chainedSupport = isApex && ownerId ? getChainedSupportFor(state, ownerId, instance.instanceId) : null;
  const chainLabel = isSupport && ownerId ? getChainLabelForSupport(state, ownerId, instance.instanceId) : null;
  const equippedTo = def.type === 'Equip' ? findEquippedOwner(state, instance.instanceId) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="max-w-sm w-full rounded-xl border-2 p-4 max-h-[85vh] overflow-y-auto"
        style={{ borderColor: theme.border, background: '#0a0512', boxShadow: `0 0 30px ${theme.primary}55` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <div className="text-lg font-bold" style={{ color: theme.primary }}>
              {def.name}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-white/50">
              {def.faction} · {getCardTypeLabel(def)}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white text-lg leading-none px-1">
            ×
          </button>
        </div>

        <div className="text-[10px] text-white/40 mb-2">
          Zone: <span className="text-white/70">{zone}</span>
          {'cost' in def && (
            <span className="ml-3">
              Cost: <span className="text-yellow-300">{(def as { cost: number }).cost} Momentum</span>
            </span>
          )}
          {def.tags && def.tags.length > 0 && <span className="ml-3 text-fuchsia-300/80">{def.tags.join(' · ')}</span>}
        </div>

        {def.rulesText && <div className="text-xs text-white/80 leading-snug mb-3 whitespace-pre-wrap">{def.rulesText}</div>}

        {isApex && (
          <div className="space-y-2 text-xs">
            <div>
              DEF:{' '}
              <span className="font-mono font-bold" style={{ color: effDef !== null && effDef !== def.baseDef ? (effDef! > def.baseDef ? '#4ade80' : '#f87171') : undefined }}>
                {effDef ?? def.baseDef}
              </span>
              {effDef !== null && effDef !== def.baseDef && <span className="text-white/40"> (base {def.baseDef})</span>}
            </div>
            <div className="space-y-1">
              {def.attacks.map((atk) => {
                const preview = ownerId ? getPreviewAttackDamage(state, instance.instanceId, atk.id) : null;
                const dmg = preview?.modifiedDamage ?? atk.baseDamage;
                return (
                  <div key={atk.id} className="border border-white/10 rounded px-2 py-1">
                    <div className="flex justify-between">
                      <span>
                        [{atk.syncCost}] {atk.name}
                      </span>
                      <span className="font-mono font-bold">
                        {preview && preview.modifiedDamage !== preview.baseDamage ? `${preview.baseDamage} → ${dmg}` : dmg}
                      </span>
                    </div>
                    {atk.description && <div className="text-white/40 text-[10px] mt-0.5">{atk.description}</div>}
                    {preview && preview.modifiers.length > 0 && (
                      <div className="mt-0.5 space-y-0.5">
                        {preview.modifiers.map((m, i) => (
                          <div key={i} className={m.amount >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                            {m.amount >= 0 ? '+' : ''}
                            {m.amount} {m.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {instance.counters && (instance.counters.choke > 0 || instance.counters.glitch > 0) && (
              <div className="flex gap-2">
                {instance.counters.choke > 0 && <span className="px-1.5 py-0.5 rounded bg-red-900/40 border border-red-500/50 text-red-200">CHK {instance.counters.choke}</span>}
                {instance.counters.glitch > 0 && <span className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 border border-fuchsia-500/50 text-fuchsia-200">GLT {instance.counters.glitch}</span>}
              </div>
            )}
            {instance.equip && (
              <div>
                Equip: <span className="text-white/80">{getCardDef(instance.equip.defId).name}</span>
              </div>
            )}
            <div>Chained Support: {chainedSupport ? <span className="text-teal-300">{getCardDef(chainedSupport.defId).name}</span> : <span className="text-white/40">none</span>}</div>
            {zone === 'Field' && <div>Attacked this turn: <span className="text-white/80">{instance.hasAttacked ? 'Yes' : 'No'}</span></div>}
          </div>
        )}

        {isSupport && (
          <div className="space-y-1 text-xs">
            <div>Provides: <span className="text-fuchsia-300">+1 Sync</span></div>
            {def.type === 'AbilitySupport' && (
              <>
                {chainLabel && <div className={chainLabel === 'Unchained' ? 'text-red-300' : 'text-emerald-300'}>{chainLabel}</div>}
                <div className="text-white/60 mt-1">Sync Ability: {def.syncAbilityText}</div>
                {instance.enteredViaReconfigureTurn === state.turnNumber && (
                  <div className="text-blue-300">Sync Ability locked this turn (played via Reconfigure).</div>
                )}
                <div className="text-amber-300/70 text-[10px] mt-1">
                  Risk: if the chained Apex is destroyed, this Support is destroyed too and sent to the Void.
                </div>
              </>
            )}
            {instance.lockedByControlConflict && <div className="text-blue-300">LOCKED (Control Conflict)</div>}
          </div>
        )}

        {def.type === 'Equip' && (
          <div className="text-xs">
            Attached to: {equippedTo ? <span className="text-white/80">{equippedTo.apexName}</span> : <span className="text-white/40">not attached</span>}
          </div>
        )}

        {def.type === 'Special' && (
          <div className="text-xs text-white/50">Timing: Main Phase only{def.requiresTarget ? `, requires a target (${def.requiresTarget})` : ''}.</div>
        )}

        {def.type === 'Reaction' && (
          <div className="text-xs text-white/50">Timing: response window only (see tags above).</div>
        )}
      </div>
    </div>
  );
}
