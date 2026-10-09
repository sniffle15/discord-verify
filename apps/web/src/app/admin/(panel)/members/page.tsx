'use client';

import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MemberBadges } from '@/components/admin/badges';
import { PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch, ApiError, useApi } from '@/lib/api';
import type { GuildActionResult, Member, Paginated } from '@/lib/types';
import { avatarUrl, cn, formatDate, timeAgo } from '@/lib/utils';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'REVOKED', label: 'Revoked' },
  { value: 'IN_GUILD', label: 'Joined Guild' },
];

type Action = 'check' | 'resync' | 'delete';

export default function MembersPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<{ id: string; action: Action } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (debounced) params.set('search', debounced);
  if (status) params.set('status', status);
  const { data, loading, reload, setData } = useApi<Paginated<Member>>(`/api/admin/members?${params}`);

  const replaceMember = (member: Member | null | undefined) => {
    if (!member) return;
    setData((current) => current && { ...current, items: current.items.map((m) => (m.id === member.id ? member : m)) });
  };

  async function run(member: Member, action: Action) {
    if (action === 'delete') {
      const confirmed = window.confirm(
        `Delete all stored data for ${member.username}? Their OAuth grant is revoked and the verified role removed. This cannot be undone.`,
      );
      if (!confirmed) return;
    }
    setBusy({ id: member.id, action });
    setNotice(null);
    try {
      if (action === 'check') {
        const res = await apiFetch<{ result: { status: string; reason?: string }; member: Member | null }>(
          `/api/admin/members/${member.id}/check`,
          { method: 'POST' },
        );
        replaceMember(res.member);
        setNotice({
          tone: res.result.status === 'revoked' ? 'error' : 'ok',
          text:
            res.result.status === 'active'
              ? `${member.username} is still authorized.`
              : res.result.status === 'revoked'
                ? `${member.username} has revoked access. Role removal was attempted.`
                : `Check skipped (${res.result.reason}).`,
        });
      } else if (action === 'resync') {
        const res = await apiFetch<{ result: GuildActionResult; member: Member | null }>(
          `/api/admin/members/${member.id}/resync-role`,
          { method: 'POST' },
        );
        replaceMember(res.member);
        setNotice(res.result.ok ? { tone: 'ok', text: `Role synced for ${member.username}.` } : { tone: 'error', text: res.result.message });
      } else {
        await apiFetch(`/api/admin/members/${member.id}`, { method: 'DELETE' });
        setNotice({ tone: 'ok', text: `Deleted data for ${member.username}.` });
        await reload();
      }
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Action failed' });
    } finally {
      setBusy(null);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Members" description={data ? `${data.total} member(s)` : 'Loading…'} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by username or Discord ID" className="pl-9" />
        </div>
        <div className="flex gap-1 rounded-lg border p-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => {
                setStatus(filter.value);
                setPage(1);
              }}
              className={cn(
                'rounded-md px-3 py-1 text-sm transition-colors',
                status === filter.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div
          className={cn(
            'mb-4 rounded-lg border px-4 py-2.5 text-sm',
            notice.tone === 'ok' ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive',
          )}
        >
          {notice.text}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>User</TableHead>
                <TableHead>Discord ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Last check</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <img src={avatarUrl(member.discordId, member.avatar)} alt="" className="size-7 rounded-full" />
                      <div>
                        <p className="font-medium">{member.globalName ?? member.username}</p>
                        <p className="text-xs text-muted-foreground">@{member.username}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{member.discordId}</TableCell>
                  <TableCell>
                    <MemberBadges member={member} />
                    {member.status === 'REVOKED' && member.revokeReason && (
                      <p className="mt-1 text-xs text-muted-foreground">{member.revokeReason.replaceAll('_', ' ')}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs" title={formatDate(member.lastVerifiedAt)}>
                    {formatDate(member.verifiedAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {timeAgo(member.lastCheckedAt)}
                    {member.checkFailures > 0 && <span className="ml-1 text-warning">({member.checkFailures} failed)</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <ActionButton title="Check status now" busy={busy?.id === member.id && busy.action === 'check'} disabled={member.status !== 'ACTIVE' || Boolean(busy)} onClick={() => run(member, 'check')}>
                        <RefreshCw />
                      </ActionButton>
                      <ActionButton title="Re-sync role" busy={busy?.id === member.id && busy.action === 'resync'} disabled={Boolean(busy)} onClick={() => run(member, 'resync')}>
                        <ShieldCheck />
                      </ActionButton>
                      <ActionButton title="Delete data" destructive busy={busy?.id === member.id && busy.action === 'delete'} disabled={Boolean(busy)} onClick={() => run(member, 'delete')}>
                        <Trash2 />
                      </ActionButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {data && data.items.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No members found.
                  </TableCell>
                </TableRow>
              )}
              {!data && loading && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-10 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <span>
          Page {page} of {totalPages}
        </span>
        <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </>
  );
}

function ActionButton({
  children,
  title,
  busy,
  disabled,
  destructive,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  busy: boolean;
  disabled: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn('size-8', destructive && 'text-destructive hover:text-destructive')}
    >
      {busy ? <Loader2 className="animate-spin" /> : children}
    </Button>
  );
}
