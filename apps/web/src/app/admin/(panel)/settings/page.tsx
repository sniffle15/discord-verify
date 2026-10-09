'use client';

import { CircleAlert, CircleCheck, FlaskConical, Loader2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { apiFetch, ApiError, useApi } from '@/lib/api';
import type { Diagnostics, Settings } from '@/lib/types';
import { cn } from '@/lib/utils';

interface FormState {
  botToken: string;
  clientId: string;
  clientSecret: string;
  targetGuildId: string;
  verifiedRoleId: string;
  logChannelId: string;
  syncIntervalMinutes: string;
  dmConfirmation: boolean;
  autoJoinOnVerify: boolean;
  blockVpn: boolean;
}

const toForm = (s: Settings): FormState => ({
  botToken: '',
  clientId: s.clientId ?? '',
  clientSecret: '',
  targetGuildId: s.targetGuildId ?? '',
  verifiedRoleId: s.verifiedRoleId ?? '',
  logChannelId: s.logChannelId ?? '',
  syncIntervalMinutes: String(s.syncIntervalMinutes),
  dmConfirmation: s.dmConfirmation,
  autoJoinOnVerify: s.autoJoinOnVerify,
  blockVpn: s.blockVpn,
});

export default function SettingsPage() {
  const { data: settings, setData } = useApi<Settings>('/api/admin/settings');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  useEffect(() => {
    if (settings && !form) setForm(toForm(settings));
  }, [settings, form]);

  if (!settings || !form) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => f && { ...f, [key]: value });
  const nullable = (value: string) => (value.trim() === '' ? null : value.trim());

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setMessage(null);
    const body: Record<string, unknown> = {
      targetGuildId: nullable(form.targetGuildId),
      verifiedRoleId: nullable(form.verifiedRoleId),
      logChannelId: nullable(form.logChannelId),
      syncIntervalMinutes: Number(form.syncIntervalMinutes),
      dmConfirmation: form.dmConfirmation,
      autoJoinOnVerify: form.autoJoinOnVerify,
      blockVpn: form.blockVpn,
    };
    if (form.clientId.trim()) body.clientId = form.clientId.trim();
    if (form.botToken.trim()) body.botToken = form.botToken.trim();
    if (form.clientSecret.trim()) body.clientSecret = form.clientSecret.trim();

    try {
      const updated = await apiFetch<Settings>('/api/admin/settings', { method: 'PUT', body });
      setData(updated);
      setForm(toForm(updated));
      setMessage({ tone: 'ok', text: 'Settings saved. Workers and the bot pick up changes automatically.' });
    } catch (err) {
      const issues = err instanceof ApiError ? (err.body as { issues?: { path: string[]; message: string }[] })?.issues : undefined;
      setMessage({
        tone: 'error',
        text: issues?.length ? issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ') : err instanceof Error ? err.message : 'Save failed',
      });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setDiagnostics(null);
    try {
      setDiagnostics(await apiFetch<Diagnostics>('/api/admin/settings/test', { method: 'POST', body: {} }));
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Values saved here override the environment defaults. Secrets are stored encrypted and never sent back to the browser."
        actions={
          <Button variant="outline" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : <FlaskConical />}
            Test configuration
          </Button>
        }
      />

      {diagnostics && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Configuration check</CardTitle>
            <CardDescription>
              {diagnostics.botUser ? `Bot: ${diagnostics.botUser.username}` : 'Bot not reachable'}
              {diagnostics.guild && ` · Guild: ${diagnostics.guild.name}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {diagnostics.checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2">
                  {check.ok ? <CircleCheck className="mt-0.5 size-4 text-success" /> : <CircleAlert className="mt-0.5 size-4 text-destructive" />}
                  <span>
                    {check.label}
                    {check.detail && <span className="block text-xs text-muted-foreground">{check.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <form onSubmit={save} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Discord application</CardTitle>
            <CardDescription>From the Discord Developer Portal. Leave secret fields empty to keep the current value.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Client ID" id="clientId">
              <Input id="clientId" value={form.clientId} onChange={(e) => set('clientId', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Client secret" id="clientSecret" configured={settings.clientSecretConfigured}>
              <Input
                id="clientSecret"
                type="password"
                autoComplete="off"
                value={form.clientSecret}
                onChange={(e) => set('clientSecret', e.target.value)}
                placeholder={settings.clientSecretConfigured ? '•••••••••••• (unchanged)' : 'Not configured'}
              />
            </Field>
            <Field label="Bot token" id="botToken" configured={settings.botTokenConfigured} className="md:col-span-2">
              <Input
                id="botToken"
                type="password"
                autoComplete="off"
                value={form.botToken}
                onChange={(e) => set('botToken', e.target.value)}
                placeholder={settings.botTokenConfigured ? '•••••••••••• (unchanged)' : 'Not configured'}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Guild</CardTitle>
            <CardDescription>The bot&apos;s highest role must be above the verified role.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field label="Target guild ID" id="targetGuildId">
              <Input id="targetGuildId" value={form.targetGuildId} onChange={(e) => set('targetGuildId', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Verified role ID" id="verifiedRoleId">
              <Input id="verifiedRoleId" value={form.verifiedRoleId} onChange={(e) => set('verifiedRoleId', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Log channel ID (optional)" id="logChannelId">
              <Input id="logChannelId" value={form.logChannelId} onChange={(e) => set('logChannelId', e.target.value)} inputMode="numeric" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Behaviour</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="Deauthorization sync interval (minutes)" id="syncIntervalMinutes" className="max-w-xs">
              <Input
                id="syncIntervalMinutes"
                type="number"
                min={5}
                max={1440}
                value={form.syncIntervalMinutes}
                onChange={(e) => set('syncIntervalMinutes', e.target.value)}
              />
            </Field>
            <Toggle
              id="autoJoinOnVerify"
              label="Add users to the guild on verification"
              description="Uses guilds.join to add users who are not yet members."
              checked={form.autoJoinOnVerify}
              onChange={(v) => set('autoJoinOnVerify', v)}
            />
            <Toggle
              id="dmConfirmation"
              label="Send confirmation DM"
              description="The bot DMs users an embed once they are verified."
              checked={form.dmConfirmation}
              onChange={(v) => set('dmConfirmation', v)}
            />
            <Toggle
              id="blockVpn"
              label="Block VPNs and proxies"
              description="Requires IP_INTEL_PROVIDER to be configured on the server."
              checked={form.blockVpn}
              onChange={(v) => set('blockVpn', v)}
            />
          </CardContent>
        </Card>

        {message && (
          <div
            className={cn(
              'rounded-lg border px-4 py-2.5 text-sm',
              message.tone === 'ok' ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive',
            )}
          >
            {message.text}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save settings
          </Button>
        </div>
      </form>
    </>
  );
}

function Field({
  label,
  id,
  configured,
  className,
  children,
}: {
  label: string;
  id: string;
  configured?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id} className="flex items-center gap-2">
        {label}
        {configured !== undefined && (
          <span className={cn('text-xs font-normal', configured ? 'text-success' : 'text-warning')}>
            {configured ? 'configured' : 'missing'}
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}

function Toggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
