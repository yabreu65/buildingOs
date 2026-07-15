import Link from 'next/link';

export function Sidebar() {
  return (
    <aside>
      <nav>
        <ul>
          <li>
            <Link href="/settings/onboarding-import">Onboarding import</Link>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
