'use client';

import type { MembershipRole } from '@trp/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/requests', label: 'Requests' },
  { href: '/requests/new', label: 'New request' },
];

/** Navigation only; the API still refuses non-admins on /admin endpoints. */
export function AppNav({ role }: { role: MembershipRole }) {
  const pathname = usePathname();
  const links = role === 'ADMIN' ? [...LINKS, { href: '/admin/audit', label: 'Audit' }] : LINKS;
  return (
    <nav aria-label="Main" className="app-nav">
      {links.map((link) => (
        <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
