'use client';

import type { CardInstance, ApexDef } from '@/types/game';
import { APEX_TEMPLATE_ZONES, getValueDeltaState, type ValueDeltaState } from '@/lib/apexOverlay';
import { getCardArt } from '@/lib/cardArt';
import { factionTheme } from '@/lib/theme';

const BOOST_GREEN = '#4ade80';
const NERF_RED = '#f87171';

function deltaColor(deltaState: ValueDeltaState): string {
  if (deltaState === 'boosted') return BOOST_GREEN;
  if (deltaState === 'reduced') return NERF_RED;
  return '#ffffff';
}

/** Percentage-positioned absolutely-placed box - the one primitive every overlay
 *  zone is built from, so board/hand/inspect/gallery sizes all scale identically
 *  without any pixel math. */
function Zone({
  zone,
  children,
  debugLabel,
  debug,
}: {
  zone: { left: number; top: number; width: number; height: number };
  children?: React.ReactNode;
  debugLabel?: string;
  debug?: boolean;
}) {
  return (
    <div
      className="absolute flex items-center"
      style={{ left: `${zone.left}%`, top: `${zone.top}%`, width: `${zone.width}%`, height: `${zone.height}%` }}
    >
      {debug && (
        <div className="absolute inset-0 border border-dashed border-cyan-300/80 bg-cyan-400/10">
          {debugLabel && (
            <span className="absolute -top-3 left-0 text-[6px] text-cyan-200 bg-black/80 px-0.5 whitespace-nowrap leading-none">
              {debugLabel}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/** A single bold, color-coded number/text value - the shared building block for
 *  every dynamic number rendered on the card face (DEF, attack damage). */
export function DynamicStatText({
  value,
  deltaState,
  align = 'center',
  size = 'inherit',
}: {
  value: string | number;
  deltaState: ValueDeltaState;
  align?: 'center' | 'right' | 'left';
  size?: string;
}) {
  return (
    <span
      className="font-mono font-bold w-full leading-none"
      style={{ color: deltaColor(deltaState), textAlign: align, fontSize: size, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
    >
      {value}
    </span>
  );
}

/** Compact pill-badge cluster for Choke/Upgrade/Glitch counters - wraps to a second
 *  row automatically if it runs out of horizontal room; renders nothing for any
 *  counter at 0. */
export function CounterBadges({ counters }: { counters?: { choke: number; upgrade: number; glitch: number } }) {
  if (!counters) return null;
  const badges: { label: string; value: number; border: string; text: string }[] = [
    { label: 'CHK', value: counters.choke, border: 'border-red-400', text: 'text-red-300' },
    { label: 'UPG', value: counters.upgrade, border: 'border-amber-300', text: 'text-amber-200' },
    { label: 'GLT', value: counters.glitch, border: 'border-fuchsia-400', text: 'text-fuchsia-200' },
  ].filter((b) => b.value > 0);
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5 items-start justify-end w-full h-full content-start">
      {badges.map((b) => (
        <span
          key={b.label}
          className={`px-1 rounded bg-black/70 border ${b.border} ${b.text} text-[7px] font-bold leading-tight whitespace-nowrap`}
        >
          {b.label} {b.value}
        </span>
      ))}
    </div>
  );
}

/** Optional status-flag strip, reserved for future effects (Protected, Locked,
 *  Chained, Overclocked, etc.) - renders nothing today since no card currently sets
 *  a status flag; the zone exists so a future effect has somewhere to render without
 *  needing new layout work. */
export function StatusFlags({ flags }: { flags?: string[] }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div className="flex gap-0.5 items-center justify-end w-full h-full">
      {flags.map((f) => (
        <span key={f} className="px-1 rounded bg-black/70 border border-cyan-300 text-cyan-200 text-[6.5px] font-bold whitespace-nowrap">
          {f}
        </span>
      ))}
    </div>
  );
}

/** Layer 1: the baked art image, or a themed gradient placeholder when no art is
 *  mapped for this card yet (see lib/cardArt.ts). The gallery can force the
 *  placeholder on for zone-tuning even before real art exists. */
export function CardArtLayer({ defId, faction, forcePlaceholder }: { defId: string; faction: Parameters<typeof factionTheme>[0]; forcePlaceholder?: boolean }) {
  const art = forcePlaceholder ? undefined : getCardArt(defId);
  const theme = factionTheme(faction);
  if (art) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={art} alt="" className="absolute inset-0 w-full h-full object-contain" draggable={false} />;
  }
  return (
    <div
      className="absolute inset-0"
      style={{ background: `linear-gradient(160deg, ${theme.bg} 0%, ${theme.border}55 55%, ${theme.bg} 100%)` }}
    />
  );
}

/** Layer 2: every dynamic value/badge overlaid on top of the art - DEF, attack
 *  damage per row, counters, and the reserved status strip. This is the piece
 *  `debugZones` outlines when tuning the template against a new base image. */
export function ApexOverlayLayer({
  instance,
  apexDef,
  effectiveDef,
  attackDamages,
  bakedAttackNames,
  debugZones,
}: {
  instance: CardInstance;
  apexDef: ApexDef;
  effectiveDef: number;
  /** Final (already-modified) damage per attack id - callers compute this once via
   *  getDisplayedAttackValue so the overlay never duplicates the calculation. */
  attackDamages: Record<string, number>;
  /** If true, attack names are baked into the art and should not be re-rendered. */
  bakedAttackNames?: boolean;
  debugZones?: boolean;
}) {
  const z = APEX_TEMPLATE_ZONES;
  const defDelta = getValueDeltaState(apexDef.baseDef, effectiveDef);

  return (
    <div className="absolute inset-0">
      <Zone zone={z.def} debug={debugZones} debugLabel="DEF">
        <DynamicStatText value={effectiveDef} deltaState={defDelta} align="center" />
      </Zone>

      {apexDef.attacks.slice(0, 4).map((atk, i) => {
        const top = z.attacks.rows[i];
        const shown = attackDamages[atk.id] ?? atk.baseDamage;
        const delta = getValueDeltaState(atk.baseDamage, shown);
        return (
          <div key={atk.id}>
            {!bakedAttackNames && (
              <Zone
                zone={{ left: z.attacks.leftZone.left, top, width: z.attacks.leftZone.width, height: z.attacks.leftZone.height }}
                debug={debugZones}
                debugLabel={`ATK ${i + 1} name`}
              >
                <span className="text-white/90 text-[8px] leading-none truncate w-full" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                  [{atk.syncCost}] {atk.name}
                </span>
              </Zone>
            )}
            <Zone
              zone={{ left: z.attacks.valueZone.left, top, width: z.attacks.valueZone.width, height: z.attacks.valueZone.height }}
              debug={debugZones}
              debugLabel={`ATK ${i + 1} value`}
            >
              <DynamicStatText value={shown} deltaState={delta} align="right" />
            </Zone>
          </div>
        );
      })}

      <Zone zone={z.counters} debug={debugZones} debugLabel="Counters">
        <CounterBadges counters={instance.counters} />
      </Zone>

      <Zone zone={z.status} debug={debugZones} debugLabel="Status">
        <StatusFlags flags={undefined} />
      </Zone>
    </div>
  );
}
