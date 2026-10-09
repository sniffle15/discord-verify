import { ShieldCheck } from 'lucide-react';

export function VerifyShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--color-primary)_22%,transparent),transparent_60%)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-muted-foreground">
          <ShieldCheck className="size-5 text-primary" />
          <span className="text-sm font-medium tracking-wide">Secure Verification</span>
        </div>
        {children}
      </div>
    </main>
  );
}
