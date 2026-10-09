export type MemberStatus = 'ACTIVE' | 'REVOKED';

export interface Member {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  status: MemberStatus;
  scopes: string[];
  inTargetGuild: boolean;
  roleAssigned: boolean;
  lastJoinedGuildId: string | null;
  lastJoinedAt: string | null;
  verifiedAt: string;
  lastVerifiedAt: string;
  lastCheckedAt: string | null;
  checkFailures: number;
  revokedAt: string | null;
  revokeReason: string | null;
  tokenExpiresAt: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditEntry {
  id: string;
  type: string;
  actorType: 'SYSTEM' | 'ADMIN' | 'USER';
  actorId: string | null;
  memberId: string | null;
  targetDiscordId: string | null;
  guildId: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type QueueCounts = Partial<Record<'waiting' | 'active' | 'delayed' | 'failed' | 'completed', number>>;

export interface Stats {
  totals: {
    total: number;
    active: number;
    revoked: number;
    inGuild: number;
    activeTokens: number;
    verified24h: number;
    revoked24h: number;
  };
  recent: Member[];
  daily: { day: string; verified: number; revoked: number }[];
  lastSweep: { at: string; queued: number; trigger: string } | null;
  queues: { tokenCheck: QueueCounts; restore: QueueCounts };
}

export interface SyncStatus {
  nextRunAt: string | null;
  intervalMs: number | null;
  lastSweep: Stats['lastSweep'];
  counts: QueueCounts;
}

export type RestoreStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

export interface RestoreJob {
  id: string;
  guildId: string;
  roleIds: string[];
  status: RestoreStatus;
  total: number;
  added: number;
  alreadyMember: number;
  skipped: number;
  failed: number;
  error: string | null;
  createdBy: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface Settings {
  clientId: string | null;
  targetGuildId: string | null;
  verifiedRoleId: string | null;
  logChannelId: string | null;
  syncIntervalMinutes: number;
  dmConfirmation: boolean;
  autoJoinOnVerify: boolean;
  blockVpn: boolean;
  botTokenConfigured: boolean;
  clientSecretConfigured: boolean;
}

export interface Diagnostics {
  botUser: { id: string; username: string } | null;
  guild: { id: string; name: string } | null;
  checks: { id: string; label: string; ok: boolean; detail?: string }[];
}

export interface AdminMe {
  discordId: string;
  username: string;
  avatar: string | null;
  csrfToken: string;
}

export type GuildActionResult = { ok: true } | { ok: false; reason: string; message: string };
