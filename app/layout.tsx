import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono, Literata } from 'next/font/google';
import './globals.css';

import { signOut } from '@/app/auth/sign-in/actions';
import { Wordmark } from '@/components/wordmark';
import { getAllowedUser } from '@/lib/auth/guard';

// Two families, one job each. Literata for anything she reads or writes at
// length (notes, quotations, fichas, the instruction pages); Geist for the
// instrument around it (nav, labels, filters, badges). Literata was drawn for
// screen reading and has true italics, which the Spanish titles need.
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const literata = Literata({
  variable: '--font-literata',
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
});

export const metadata: Metadata = {
  title: 'Scriptorium',
  description: 'Reading list, bibliography, and notes.',
};

// The layout reads the session to decide whether to show a name and a sign-out
// button, which means every route touches cookies. Declaring that here stops
// Next attempting to prerender /_not-found and /auth/sign-in and reporting the
// fallback as an error on every build. Nothing was static anyway — every page
// queries the database.
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/', label: 'Workbench' },
  { href: '/lists', label: 'Lists' },
  { href: '/readiness', label: 'Readiness' },
  { href: '/works', label: 'Catalogue' },
  { href: '/search', label: 'Search' },
  { href: '/notes', label: 'Notes' },
  { href: '/axes', label: 'Axes' },
  { href: '/projects', label: 'Projects' },
  { href: '/gaps', label: 'Gaps' },
  { href: '/como', label: 'Cómo' },
];

// Typed explicitly rather than with Next's generated LayoutProps global, which
// lives in .next/types and vanishes whenever that directory is cleared.
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Display only. The guard that matters runs in each page and each Server
  // Action; this just decides whether to show a name and a sign-out button.
  const user = await getAllowedUser();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${literata.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-rule">
          <div className="mx-auto max-w-7xl px-5 py-2.5 flex items-baseline gap-6">
            {/* The wordmark goes to the introduction, not to the workbench.
                The workbench has its own link now: a name in the nav is easier
                to aim at than a logo, and it leaves the wordmark free to point
                at what this is. */}
            <Wordmark href="/about" />
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

        <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-4">{children}</main>

        <footer className="border-t border-rule">
          <div className="mx-auto flex max-w-7xl items-baseline gap-4 px-5 py-2 text-xs text-muted">
            <span>Reading list, bibliography, and notes</span>
            <Link href="/colophon" className="ml-auto text-[10px] hover:text-accent">
              colophon
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
