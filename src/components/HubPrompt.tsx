'use client';

import type { CardInstance } from '@/types/game';
import { useButtonCardHoverPreview } from './Card';
import { playSfx } from '@/audio/sfx';

export interface HubPromptOption {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** If present, hovering this button shows the real enlarged card preview,
   *  same as hovering the card itself anywhere else in the game. */
  cardInstance?: CardInstance;
  /** The Pass/Cancel/Skip-style option - visually de-emphasized, sits last. */
  muted?: boolean;
  /** Tutorial guided-step spotlight - this is the one correct choice right now. */
  highlighted?: boolean;
  /** Tutorial guided-step - dimmed because it's not the correct choice right now. */
  dimmed?: boolean;
}

/**
 * Commit 41.14 - the single shared "shared center hub" prompt style. Every
 * popup in the game (Rift choices, Overdrive, Control Conflict, React
 * window, attack targeting, Confirm-style card placement) renders through
 * this one component now, matching one reference design exactly instead of
 * each prompt type having its own bespoke box/border/color scheme.
 */
export default function HubPrompt({ text, options }: { text: string; options: HubPromptOption[] }) {
  return (
    <div className="rounded-lg bg-[#050505f5] border border-white/15 px-4 py-2.5 flex items-center gap-4 text-sm w-full">
      <span className="text-white/90">{text}</span>
      <div className="flex items-center gap-2 ml-auto flex-wrap shrink-0">
        {options.map((opt) => (
          <HubPromptButton key={opt.key} option={opt} />
        ))}
      </div>
    </div>
  );
}

function HubPromptButton({ option }: { option: HubPromptOption }) {
  const { onMouseEnter, onMouseLeave, preview } = useButtonCardHoverPreview(option.cardInstance ?? null);
  return (
    <>
      {preview}
      <button
        type="button"
        disabled={option.disabled}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={() => {
          playSfx(option.muted ? 'ui.click' : 'ui.confirm');
          option.onClick();
        }}
        className={`px-3 py-1.5 rounded text-xs font-bold whitespace-nowrap transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          option.highlighted
            ? 'bg-emerald-300 text-black ring-2 ring-emerald-300 animate-pulse'
            : option.dimmed
            ? 'bg-white/5 text-white/30'
            : option.muted
            ? 'bg-white/10 text-white/70 hover:bg-white/20'
            : 'bg-white text-black hover:bg-white/90'
        }`}
      >
        {option.label}
      </button>
    </>
  );
}
