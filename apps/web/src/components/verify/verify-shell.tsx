import { Logo } from '@/components/brand';

export function VerifyShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--color-primary)_30%,transparent),transparent_62%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-[radial-gradient(ellipse_at_bottom,color-mix(in_oklch,var(--color-primary)_12%,transparent),transparent_70%)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-7 flex flex-col items-center gap-3">
          <Logo size={80} glow />
          <div className="text-center">
            <p className="text-xl font-semibold tracking-wide">Elysian</p>
            <p className="text-xs font-medium tracking-[0.35em] text-primary uppercase">Verification</p>
          </div>
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground/70">© Elysian Menu</p>
      </div>
    </main>
  );
}
