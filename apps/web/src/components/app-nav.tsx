'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/requests', label: 'Requests' },
  { href: '/requests/new', label: 'New request' },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="app-nav">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
