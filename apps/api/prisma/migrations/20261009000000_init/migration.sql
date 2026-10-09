-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('MEMBER_VERIFIED', 'MEMBER_DEAUTHORIZED', 'MEMBER_CHECKED', 'MEMBER_DATA_DELETED', 'ROLE_ASSIGNED', 'ROLE_ASSIGN_FAILED', 'ROLE_REVOKED', 'ROLE_REVOKE_FAILED', 'VERIFICATION_BLOCKED', 'VERIFICATION_FAILED', 'SUSPICIOUS_ACTIVITY', 'RESTORE_STARTED', 'RESTORE_COMPLETED', 'RESTORE_CANCELLED', 'RESTORE_FAILED', 'SETTINGS_UPDATED', 'ADMIN_LOGIN', 'ADMIN_LOGIN_DENIED', 'ADMIN_LOGOUT', 'SYSTEM_ALERT');

-- CreateEnum
CREATE TYPE "RestoreStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "discord_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "global_name" TEXT,
    "avatar" TEXT,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "access_token_enc" TEXT,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "in_target_guild" BOOLEAN NOT NULL DEFAULT false,
    "role_assigned" BOOLEAN NOT NULL DEFAULT false,
    "last_joined_guild_id" TEXT,
    "last_joined_at" TIMESTAMP(3),
    "ip_hash" TEXT,
    "fingerprint_hash" TEXT,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_checked_at" TIMESTAMP(3),
    "check_failures" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "type" "AuditEventType" NOT NULL,
    "actor_type" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "actor_id" TEXT,
    "member_id" TEXT,
    "target_discord_id" TEXT,
    "guild_id" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_jobs" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "role_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RestoreStatus" NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "already_member" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_by" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restore_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "members_discord_id_key" ON "members"("discord_id");

-- CreateIndex
CREATE INDEX "members_status_last_checked_at_idx" ON "members"("status", "last_checked_at");

-- CreateIndex
CREATE INDEX "members_verified_at_idx" ON "members"("verified_at");

-- CreateIndex
CREATE INDEX "members_fingerprint_hash_idx" ON "members"("fingerprint_hash");

-- CreateIndex
CREATE INDEX "members_ip_hash_idx" ON "members"("ip_hash");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_id_idx" ON "audit_logs"("created_at" DESC, "id");

-- CreateIndex
CREATE INDEX "audit_logs_type_created_at_idx" ON "audit_logs"("type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_member_id_idx" ON "audit_logs"("member_id");

-- CreateIndex
CREATE INDEX "restore_jobs_status_idx" ON "restore_jobs"("status");

-- CreateIndex
CREATE INDEX "restore_jobs_created_at_idx" ON "restore_jobs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
