'use client';

import { DatabaseBackup, LayoutDashboard, LogOut, ScrollText, Settings, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { avatarUrl, cn } from '@/lib/utils';
import { useAdmin } from './admin-provider';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/members', label: 'Members', icon: Users },
  { href: '/admin/restore', label: 'Restore', icon: DatabaseBackup },
  { href: '/admin/audit', label: 'Audit Log', icon: ScrollText },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const admin = useAdmin();

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/admin/login';
  }

  return (
    <aside className="flex w-full flex-col border-b bg-card/50 md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
      <BrandMark className="px-5 py-5" />
      <nav className="flex gap-1 overflow-x-auto px-3 md:flex-1 md:flex-col">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/admin' ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="hidden items-center gap-3 border-t px-4 py-4 md:flex">
        <img src={avatarUrl(admin.discordId, admin.avatar)} alt="" className="size-8 rounded-full" />
        <span className="flex-1 truncate text-sm">{admin.username}</span>
        <Button variant="ghost" size="icon" onClick={logout} title="Sign out">
          <LogOut />
        </Button>
      </div>
    </aside>
  );
}
