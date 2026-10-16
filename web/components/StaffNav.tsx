export function StaffNav({ current }: { current: string }) {
  const links = [["/staff/handoffs", "Handoffs"], ["/staff/dashboard", "Dashboard"], ["/staff/review", "Review queue"], ["/evaluation", "Evaluation"], ["/chat", "Chat"]];
  return (
    <header className="topbar">
      <div className="brand"><span style={{ fontWeight: 600 }}>Meridian · staff console</span><span className="pill">DEMO</span></div>
      <nav className="nav" aria-label="Staff">
        {links.map(([href, label]) => <a key={href} href={href} aria-current={current === href ? "page" : undefined} style={current === href ? { fontWeight: 600 } : undefined}>{label}</a>)}
      </nav>
    </header>
  );
}
