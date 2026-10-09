import { CircleCheck, CircleSlash, Server } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Member, RestoreStatus } from '@/lib/types';

export function MemberBadges({ member }: { member: Pick<Member, 'status' | 'inTargetGuild'> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {member.status === 'ACTIVE' ? (
        <Badge variant="success">
          <CircleCheck /> Active
        </Badge>
      ) : (
        <Badge variant="destructive">
          <CircleSlash /> Revoked
        </Badge>
      )}
      {member.inTargetGuild && (
        <Badge variant="default">
          <Server /> Joined Guild
        </Badge>
      )}
    </div>
  );
}

const RESTORE_VARIANTS: Record<RestoreStatus, 'default' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  PENDING: 'outline',
  RUNNING: 'default',
  COMPLETED: 'success',
  CANCELLED: 'warning',
  FAILED: 'destructive',
};

export function RestoreBadge({ status }: { status: RestoreStatus }) {
  return <Badge variant={RESTORE_VARIANTS[status]}>{status.toLowerCase()}</Badge>;
}

const AUDIT_TONES: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  MEMBER_VERIFIED: 'success',
  ROLE_ASSIGNED: 'success',
  RESTORE_COMPLETED: 'success',
  MEMBER_DEAUTHORIZED: 'destructive',
  ROLE_REVOKED: 'warning',
  ROLE_ASSIGN_FAILED: 'destructive',
  ROLE_REVOKE_FAILED: 'destructive',
  RESTORE_FAILED: 'destructive',
  VERIFICATION_BLOCKED: 'warning',
  VERIFICATION_FAILED: 'warning',
  SUSPICIOUS_ACTIVITY: 'warning',
  ADMIN_LOGIN_DENIED: 'destructive',
  SYSTEM_ALERT: 'destructive',
  RESTORE_STARTED: 'default',
};

export function AuditTypeBadge({ type }: { type: string }) {
  return (
    <Badge variant={AUDIT_TONES[type] ?? 'outline'} className="font-mono text-[10px] uppercase">
      {type.replaceAll('_', ' ')}
    </Badge>
  );
}
