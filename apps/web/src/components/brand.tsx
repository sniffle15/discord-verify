import { cn } from '@/lib/utils';

export const BRAND_NAME = 'Elysian Verification';

/** The logo ships on a dark background, so it is shown as a rounded tile with a soft red glow. */
export function Logo({ size = 40, glow = false, className }: { size?: number; glow?: boolean; className?: string }) {
  return (
    <img
      src="/logo.webp"
      alt="Elysian"
      width={size}
      height={size}
      className={cn(
        'shrink-0 rounded-xl ring-1 ring-primary/40',
        glow && 'shadow-[0_0_40px_-4px_color-mix(in_oklch,var(--color-primary)_70%,transparent)]',
        className,
      )}
    />
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Logo size={32} />
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-wide">Elysian</p>
        <p className="text-[10px] font-medium tracking-[0.2em] text-primary uppercase">Verification</p>
      </div>
    </div>
  );
}
