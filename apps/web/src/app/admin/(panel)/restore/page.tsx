'use client';

import { CircleAlert, CircleCheck, Loader2, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { RestoreBadge } from '@/components/admin/badges';
import { PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError, useApi } from '@/lib/api';
import type { Diagnostics, RestoreJob } from '@/lib/types';
import { formatDate, timeAgo } from '@/lib/utils';

const SNOWFLAKE = /^\d{17,20}$/;

export default function RestorePage() {
  const { data: jobs, reload } = useApi<RestoreJob[]>('/api/admin/restore', { refreshMs: 3_000 });
  const [guildId, setGuildId] = useState('');
  const [roles, setRoles] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; diagnostics?: Diagnostics } | null>(null);

  const roleIds = roles
    .split(/[\s,]+/)
    .map((r) => r.trim())
    .filter(Boolean);
  const valid = SNOWFLAKE.test(guildId.trim()) && roleIds.every((r) => SNOWFLAKE.test(r));

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    const confirmed = window.confirm(
      `Add every active verified member to guild ${guildId.trim()}? This runs in the background and respects Discord rate limits.`,
    );
    if (!confirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/admin/restore', { method: 'POST', body: { guildId: guildId.trim(), roleIds } });
      setGuildId('');
      setRoles('');
      await reload();
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ message: err.message, diagnostics: (err.body as { diagnostics?: Diagnostics })?.diagnostics });
      } else setError({ message: 'Failed to start restore' });
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(job: RestoreJob) {
    if (!window.confirm('Cancel this restore? Members already added stay in the guild.')) return;
    await apiFetch(`/api/admin/restore/${job.id}/cancel`, { method: 'POST' }).catch(() => undefined);
    await reload();
  }

  return (
    <>
      <PageHeader title="Guild restore" description="Pull all actively authorized members into a new or existing guild." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Start a restore</CardTitle>
          <CardDescription>
            The bot must already be in the target guild with the <b>Create Invite</b> permission, plus <b>Manage Roles</b> if roles are
            assigned. Roles must sit below the bot&apos;s highest role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={start} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="guild">Target guild ID</Label>
              <Input id="guild" value={guildId} onChange={(e) => setGuildId(e.target.value)} placeholder="123456789012345678" inputMode="numeric" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="roles">Role IDs to assign (optional)</Label>
              <Input id="roles" value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="Comma separated" />
            </div>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Play />}
              Start restore
            </Button>
          </form>

          {error && (
            <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-destructive">
                <CircleAlert className="size-4" /> {error.message}
              </p>
              {error.diagnostics && (
                <ul className="mt-2 space-y-1">
                  {error.diagnostics.checks.map((check) => (
                    <li key={check.id} className="flex items-start gap-2">
                      {check.ok ? <CircleCheck className="mt-0.5 size-4 text-success" /> : <CircleAlert className="mt-0.5 size-4 text-destructive" />}
                      <span>
                        {check.label}
                        {check.detail && <span className="block text-xs text-muted-foreground">{check.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {jobs?.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No restore jobs yet.</p>}
        {jobs?.map((job) => {
          const processed = job.added + job.alreadyMember + job.skipped + job.failed;
          const percent = job.total ? Math.round((processed / job.total) * 100) : job.status === 'COMPLETED' ? 100 : 0;
          return (
            <Card key={job.id}>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{job.guildId}</span>
                      <RestoreBadge status={job.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground" title={formatDate(job.createdAt)}>
                      Started {timeAgo(job.createdAt)}
                      {job.finishedAt && ` · finished ${timeAgo(job.finishedAt)}`}
                      {job.roleIds.length > 0 && ` · ${job.roleIds.length} role(s)`}
                    </p>
                  </div>
                  {(job.status === 'RUNNING' || job.status === 'PENDING') && (
                    <Button variant="outline" size="sm" onClick={() => cancel(job)}>
                      <Square /> Cancel
                    </Button>
                  )}
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {processed} / {job.total} ({percent}%)
                  </span>
                  <span className="text-success">{job.added} added</span>
                  <span>{job.alreadyMember} already member</span>
                  <span className="text-warning">{job.skipped} skipped</span>
                  <span className="text-destructive">{job.failed} failed</span>
                </div>
                {job.error && <p className="mt-2 text-xs text-destructive">{job.error}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
