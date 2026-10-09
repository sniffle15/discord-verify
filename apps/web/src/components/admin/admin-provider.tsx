'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch, ApiError, setCsrfToken } from '@/lib/api';
import type { AdminMe } from '@/lib/types';

const AdminContext = createContext<AdminMe | null>(null);

export function useAdmin(): AdminMe {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error('useAdmin must be used inside <AdminProvider>');
  return admin;
}

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AdminMe>('/api/admin/me')
      .then((me) => {
        setCsrfToken(me.csrfToken);
        setAdmin(me);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login');
        else setFailed(err instanceof Error ? err.message : 'Failed to load session');
      });
  }, [router]);

  if (!admin) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {failed ? <p className="text-sm text-destructive">{failed}</p> : <Loader2 className="size-6 animate-spin" />}
      </div>
    );
  }

  return <AdminContext.Provider value={admin}>{children}</AdminContext.Provider>;
}
