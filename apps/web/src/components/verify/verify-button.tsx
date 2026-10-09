'use client';

import { Loader2, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { computeFingerprint } from '@/lib/fingerprint';

export function VerifyButton() {
  const [pending, setPending] = useState(false);

  async function start(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const fp = await computeFingerprint();
    window.location.href = fp ? `/api/verify/start?fp=${fp}` : '/api/verify/start';
  }

  return (
    <Button asChild size="lg" className="w-full shadow-[0_0_24px_-6px_var(--color-primary)]">
      <a href="/api/verify/start" onClick={start} aria-disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <LogIn />}
        {pending ? 'Redirecting to Discord…' : 'Verify with Discord'}
      </a>
    </Button>
  );
}
