import { CircleAlert, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { VerifyShell } from '@/components/verify/verify-shell';

export const metadata: Metadata = { title: 'Admin login' };

const ERRORS: Record<string, string> = {
  forbidden: 'This Discord account is not authorized to access the dashboard.',
  invalid_state: 'Login session expired. Please try again.',
  access_denied: 'Login was cancelled.',
  not_configured: 'Discord OAuth credentials are not configured (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET).',
  login_failed: 'Login failed. Please try again.',
  invalid_request: 'Invalid login request.',
};

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <VerifyShell>
      <Card>
        <CardHeader className="items-center text-center">
          <Lock className="mb-2 size-8 text-primary" />
          <CardTitle className="text-2xl">Admin dashboard</CardTitle>
          <CardDescription>Access is restricted to configured administrator accounts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {ERRORS[error] ?? 'Login failed.'}
            </div>
          )}
          <Button asChild size="lg" className="w-full">
            <a href="/api/auth/login">Sign in with Discord</a>
          </Button>
        </CardContent>
      </Card>
    </VerifyShell>
  );
}
