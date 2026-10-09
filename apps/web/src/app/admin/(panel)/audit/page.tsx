'use client';

import { Bot, Loader2, Shield, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AuditTypeBadge } from '@/components/admin/badges';
import { PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import type { AuditEntry } from '@/lib/types';
import { cn, formatDate, timeAgo } from '@/lib/utils';

const TYPES = [
  'MEMBER_VERIFIED',
  'MEMBER_DEAUTHORIZED',
  'ROLE_ASSIGNED',
  'ROLE_ASSIGN_FAILED',
  'ROLE_REVOKED',
  'ROLE_REVOKE_FAILED',
  'VERIFICATION_BLOCKED',
  'VERIFICATION_FAILED',
  'SUSPICIOUS_ACTIVITY',
  'RESTORE_STARTED',
  'RESTORE_COMPLETED',
  'RESTORE_CANCELLED',
  'RESTORE_FAILED',
  'MEMBER_CHECKED',
  'MEMBER_DATA_DELETED',
  'SETTINGS_UPDATED',
  'ADMIN_LOGIN',
  'ADMIN_LOGIN_DENIED',
  'ADMIN_LOGOUT',
  'SYSTEM_ALERT',
];

const ACTOR_ICONS = { SYSTEM: Bot, ADMIN: Shield, USER: User } as const;
const MAX_LIVE_ITEMS = 500;

export default function AuditPage() {
  const [type, setType] = useState('');
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      const params = new URLSearchParams({ limit: '50' });
      if (type) params.set('type', type);
      if (after) params.set('cursor', after);
      try {
        const res = await apiFetch<{ items: AuditEntry[]; nextCursor: string | null }>(`/api/admin/audit?${params}`);
        setItems((current) => (after ? [...current, ...res.items] : res.items));
        setCursor(res.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [type],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  useEffect(() => {
    const source = new EventSource('/api/admin/audit/stream', { withCredentials: true });
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.addEventListener('audit', (event) => {
      const entry = JSON.parse((event as MessageEvent<string>).data) as AuditEntry;
      if (type && entry.type !== type) return;
      setItems((current) => (current.some((e) => e.id === entry.id) ? current : [entry, ...current].slice(0, MAX_LIVE_ITEMS)));
    });
    return () => source.close();
  }, [type]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every verification, revocation, role change and admin action."
        actions={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn('size-2 rounded-full', live ? 'animate-pulse bg-success' : 'bg-muted-foreground')} />
              {live ? 'Live' : 'Reconnecting…'}
            </span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All events</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll('_', ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {items.map((entry) => {
              const ActorIcon = ACTOR_ICONS[entry.actorType];
              return (
                <li key={entry.id} className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="w-44 shrink-0">
                    <AuditTypeBadge type={entry.type} />
                  </div>
                  <p className="min-w-0 flex-1 text-sm">{entry.message}</p>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1" title={entry.actorId ?? 'system'}>
                      <ActorIcon className="size-3.5" />
                      {entry.actorType.toLowerCase()}
                    </span>
                    <span className="w-24 text-right" title={formatDate(entry.createdAt)}>
                      {timeAgo(entry.createdAt)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {!loading && items.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No events yet.</p>}
          {loading && (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </CardContent>
      </Card>

      {cursor && !loading && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => load(cursor)}>
            Load older events
          </Button>
        </div>
      )}
    </>
  );
}
