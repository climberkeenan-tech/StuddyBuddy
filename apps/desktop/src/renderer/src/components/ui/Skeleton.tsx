import { type CSSProperties } from 'react';
import { cn } from '@renderer/lib/cn';

export interface SkeletonProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  /** Fully rounded (avatars, dots). */
  circle?: boolean;
  style?: CSSProperties;
}

/**
 * A shimmering placeholder for loading content. Compose several to mirror the
 * final layout so the page doesn't jump when data arrives.
 */
export function Skeleton({ className, width, height, circle, style }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer bg-[linear-gradient(90deg,rgb(var(--sb-t3)/0.08)_25%,rgb(var(--sb-t3)/0.16)_37%,rgb(var(--sb-t3)/0.08)_63%)] bg-[length:400%_100%]',
        circle ? 'rounded-full' : 'rounded-lg',
        className,
      )}
      style={{ width, height: height ?? (circle ? width : '1em'), ...style }}
    />
  );
}
