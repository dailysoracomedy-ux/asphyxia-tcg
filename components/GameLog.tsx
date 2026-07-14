'use client';

import { useEffect, useRef } from 'react';
import type { LogEntry, LogKind } from '@/types/game';

const KIND_COLOR: Record<LogKind, string> = {
  info: 'text-white/50',
  draw: 'text-sky-300',
  play: 'text-emerald-300',
  attack: 'text-orange-300',
  damage: 'text-red-300',
  o2: 'text-cyan-300',
  momentum: 'text-yellow-300',
  rift: 'text-fuchsia-300',
  support: 'text-teal-300',
  counter: 'text-purple-300',
  destroy: 'text-red-400 font-bold',
  win: 'text-yellow-200 font-bold',
  phase: 'text-white/40 italic',
  response: 'text-pink-300',
};

export default function GameLog({ log }: { log: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [log.length]);

  return (
    <div className="rounded-lg border border-white/10 bg-[#05050a] p-2 h-full flex flex-col">
      <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1 shrink-0">Game Log</div>
      <div className="flex-1 overflow-y-auto text-[11px] leading-snug space-y-0.5 font-mono pr-1">
        {log.map((entry) => (
          <div key={entry.id} className={KIND_COLOR[entry.kind]}>
            <span className="text-white/30">[T{entry.turn}]</span> {entry.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
