import { Link, useLocation } from 'react-router-dom';

export default function Nav() {
  const { pathname } = useLocation();
  const links = [
    { to: '/', label: 'Search' },
    { to: '/sections', label: 'Projects' },
    { to: '/saved', label: 'Saved' },
  ] as const;
  return (
    <nav style={{ display: 'flex', gap: '2px' }}>
      {links.map(({ to, label }) => {
        const active = pathname === to;
        return (
          <Link key={to} to={to} style={{
            padding: '3px 10px', fontSize: '0.8rem', borderRadius: 12,
            textDecoration: 'none',
            background: active ? '#1a73e8' : 'transparent',
            color: active ? '#fff' : '#666',
            fontWeight: active ? 500 : 400,
          }}>{label}</Link>
        );
      })}
    </nav>
  );
}
