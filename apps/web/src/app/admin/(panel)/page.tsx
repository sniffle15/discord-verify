'use client';

import { Activity, KeyRound, Loader2, RefreshCw, Server, UserCheck, UserX, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { MemberBadges } from '@/components/admin/badges';
import { PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch, useApi } from '@/lib/api';
import type { Stats, SyncStatus } from '@/lib/types';
import { avatarUrl, timeAgo } from '@/lib/utils';

function StatCard({ label, value, hint, icon: Icon }: { label: string; value: number | string; hint?: string; icon: typeof Users }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function DailyChart({ daily }: { daily: Stats['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => Math.max(d.verified, d.revoked)));
  return (
    <div className="flex h-40 items-end gap-1.5">
      {daily.map((d) => (
        <div key={d.day} className="group relative flex h-full flex-1 items-end gap-0.5">
          <div className="flex-1 rounded-t bg-success/80" style={{ height: `${(d.verified / max) * 100}%` }} />
          <div className="flex-1 rounded-t bg-primary/80" style={{ height: `${(d.revoked / max) * 100}%` }} />
          <div className="pointer-events-none absolute -top-9 left-1/2 hidden -translate-x-1/2 rounded bg-popover px-2 py-1 text-xs whitespace-nowrap shadow group-hover:block">
            {new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: +{d.verified} / −{d.revoked}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const { data: stats, reload } = useApi<Stats>('/api/admin/stats', { refreshMs: 30_000 });
  const { data: sync, reload: reloadSync } = useApi<SyncStatus>('/api/admin/sync/status', { refreshMs: 15_000 });
  const [running, setRunning] = useState(false);

  async function runSweep() {
    setRunning(true);
    try {
      await apiFetch('/api/admin/sync/run', { method: 'POST' });
      setTimeout(() => {
        void reloadSync();
        void reload();
      }, 1500);
    } finally {
      setRunning(false);
    }
  }

  if (!stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const { totals } = stats;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Verification health and deauthorization monitoring."
        actions={
          <Button variant="outline" onClick={runSweep} disabled={running}>
            {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Run token check now
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total verified" value={totals.total} hint={`+${totals.verified24h} in the last 24h`} icon={Users} />
        <StatCard label="Active tokens" value={totals.activeTokens} hint={`${totals.active} active members`} icon={KeyRound} />
        <StatCard label="Revoked" value={totals.revoked} hint={`${totals.revoked24h} in the last 24h`} icon={UserX} />
        <StatCard label="In target guild" value={totals.inGuild} icon={Server} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Last 14 days</CardTitle>
            <CardDescription>
              <span className="text-success">■</span> verified &nbsp; <span className="text-primary">■</span> revoked
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DailyChart daily={stats.daily} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" /> Deauthorization sweep
            </CardTitle>
            <CardDescription>Checks every stored token against Discord.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Interval" value={sync?.intervalMs ? `${Math.round(sync.intervalMs / 60_000)} min` : '—'} />
            <Row label="Next run" value={sync?.nextRunAt ? timeAgo(sync.nextRunAt) : '—'} />
            <Row
              label="Last run"
              value={sync?.lastSweep ? `${timeAgo(sync.lastSweep.at)} (${sync.lastSweep.queued} checked)` : 'never'}
            />
            <Row label="Queued checks" value={String((sync?.counts.waiting ?? 0) + (sync?.counts.delayed ?? 0))} />
            <Row label="Failed checks" value={String(sync?.counts.failed ?? 0)} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="size-4" /> Recent verifications
            </CardTitle>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/members">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {stats.recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No verifications yet.</p>
          ) : (
            <ul className="divide-y">
              {stats.recent.map((member) => (
                <li key={member.id} className="flex items-center gap-3 py-2.5">
                  <img src={avatarUrl(member.discordId, member.avatar)} alt="" className="size-8 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{member.globalName ?? member.username}</p>
                    <p className="truncate text-xs text-muted-foreground">@{member.username}</p>
                  </div>
                  <MemberBadges member={member} />
                  <span className="w-28 text-right text-xs text-muted-foreground">{timeAgo(member.lastVerifiedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
