import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Elysian Verification', template: '%s · Elysian Verification' },
  description: 'Verify your Discord account to get access to Elysian Menu.',
  applicationName: 'Elysian Verification',
  robots: { index: false, follow: false },
  icons: { icon: '/logo.webp', shortcut: '/logo.webp', apple: '/logo.webp' },
  openGraph: {
    title: 'Elysian Verification',
    description: 'Verify your Discord account to get access to Elysian Menu.',
    images: ['/logo.webp'],
  },
};

export const viewport: Viewport = { themeColor: '#0f0a0a', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
