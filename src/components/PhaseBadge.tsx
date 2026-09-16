import type { CoachingPhase } from '@/lib/types';

const STYLE: Record<CoachingPhase, { label: string; className: string }> = {
  unknown: { label: 'はじめまして', className: 'bg-sunken text-muted' },
  habit: { label: '習慣づくり', className: 'bg-good-soft text-good' },
  goal: { label: '目標に挑戦中', className: 'bg-accent-soft text-accent' },
  recovery: { label: '回復に専念', className: 'bg-warn-soft text-warn' },
};

export default function PhaseBadge({ phase }: { phase: CoachingPhase }) {
  const { label, className } = STYLE[phase];
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${className}`}>{label}</span>
  );
}
