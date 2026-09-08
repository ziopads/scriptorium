import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

import { signOut } from '@/app/auth/sign-in/actions';
import { getAllowedUser } from '@/lib/auth/guard';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Scriptorium',
  description: 'Reading list, bibliography, and notes.',
};

const NAV = [
  { href: '/', label: 'Lists' },
  { href: '/books', label: 'Catalogue' },
  { href: '/gaps', label: 'Gaps' },
];

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Display only. The guard that matters runs in each page and each Server
  // Action; this just decides whether to show a name and a sign-out button.
  const user = await getAllowedUser();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-rule">
          <div className="mx-auto max-w-5xl px-6 py-4 flex items-baseline gap-6">
            <Link href="/" className="text-lg tracking-tight">
              Scriptorium
            </Link>
            <nav className="flex gap-4 text-sm text-muted">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-accent">
                  {item.label}
                </Link>
              ))}
            </nav>

            {user ? (
              <form action={signOut} className="ml-auto flex items-baseline gap-3 text-sm">
                <span className="text-muted">{user.name ?? user.email}</span>
                <button type="submit" className="text-muted hover:text-accent">
                  Sign out
                </button>
              </form>
            ) : null}
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>

        <footer className="border-t border-rule">
          <div className="mx-auto max-w-5xl px-6 py-4 text-xs text-muted">
            Comprehensive exams, the exam date
          </div>
        </footer>
      </body>
    </html>
  );
}
