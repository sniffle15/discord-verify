import type { Metadata } from 'next';
import { AdminProvider } from '@/components/admin/admin-provider';
import { Sidebar } from '@/components/admin/sidebar';

export const metadata: Metadata = { title: 'Dashboard' };

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </AdminProvider>
  );
}
