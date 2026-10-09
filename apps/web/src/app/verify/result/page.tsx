import { CircleAlert, CircleCheck, Clock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { VerifyShell } from '@/components/verify/verify-shell';

export const metadata: Metadata = { title: 'Verification result' };

const ERRORS: Record<string, string> = {
  access_denied: 'You cancelled the authorization on Discord.',
  invalid_state: 'Your verification session expired or was tampered with. Please start again.',
  invalid_request: 'The request from Discord was incomplete. Please start again.',
  code_expired: 'The authorization code expired. Please start again.',
  missing_scopes: 'All requested permissions are required to verify. Please approve every permission.',
  bot_account: 'Bot accounts cannot be verified.',
  rate_limited: 'Too many attempts from your network. Please wait 15 minutes and try again.',
  vpn_blocked: 'Verification through VPNs or proxies is not allowed. Disable it and try again.',
  not_configured: 'Verification is not configured yet. Please contact a server administrator.',
  oauth_error: 'Discord returned an error. Please try again.',
  internal_error: 'Something went wrong on our side. Please try again shortly.',
};

export default async function ResultPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { status, reason } = await searchParams;
  const success = status === 'success';
  const rolePending = success && reason === 'role_pending';

  const Icon = !success ? CircleAlert : rolePending ? Clock : CircleCheck;
  const tone = !success ? 'text-destructive' : rolePending ? 'text-warning' : 'text-success';

  return (
    <VerifyShell>
      <Card>
        <CardHeader className="items-center text-center">
          <Icon className={`mb-2 size-12 ${tone}`} />
          <CardTitle className="text-2xl">
            {!success ? 'Verification failed' : rolePending ? 'Verified, role pending' : "You're verified!"}
          </CardTitle>
          <CardDescription>
            {!success
              ? (ERRORS[reason ?? ''] ?? ERRORS.internal_error)
              : rolePending
                ? 'Your account is verified, but the role could not be assigned yet. The server team can see this and will fix it.'
                : 'Your role has been assigned. You can close this tab and return to Discord.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          {success ? (
            <Button asChild variant="secondary">
              <a href="https://discord.com/channels/@me">Open Discord</a>
            </Button>
          ) : (
            <Button asChild>
              <Link href="/verify">Try again</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </VerifyShell>
  );
}
