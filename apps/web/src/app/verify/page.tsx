import { Eye, KeyRound, UserPlus } from 'lucide-react';
import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { VerifyButton } from '@/components/verify/verify-button';
import { VerifyShell } from '@/components/verify/verify-shell';

export const metadata: Metadata = { title: 'Verify' };

const permissions = [
  { icon: Eye, title: 'Read your public profile', detail: 'Username and avatar, nothing else. No email, no messages.' },
  { icon: UserPlus, title: 'Join servers for you', detail: 'Used to add you back if the server ever has to be rebuilt.' },
  { icon: KeyRound, title: 'Revocable at any time', detail: 'Remove access in Discord under Settings > Authorized Apps.' },
];

export default function VerifyPage() {
  return (
    <VerifyShell>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Verify your account</CardTitle>
          <CardDescription>Sign in with Discord to confirm you are human and unlock the server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ul className="space-y-3">
            {permissions.map(({ icon: Icon, title, detail }) => (
              <li key={title} className="flex gap-3 rounded-lg border bg-muted/30 p-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <VerifyButton />
          <p className="text-center text-xs text-muted-foreground">
            Revoking access later automatically removes your verified role.
          </p>
        </CardContent>
      </Card>
    </VerifyShell>
  );
}
