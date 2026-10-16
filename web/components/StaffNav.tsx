const LINKS: [string, string][] = [["/staff/handoffs", "Handoffs"], ["/staff/dashboard", "Dashboard"], ["/staff/review", "Review queue"], ["/evaluation", "Evaluation"], ["/chat", "Chat"]];

// Matches the canvas staff nav. `waiting` is the open handoff count shown next to Handoffs.
export function StaffNav({ current, waiting, staff = true }: { current: string; waiting?: number; staff?: boolean }) {
  const links = staff ? LINKS : LINKS.filter(([href]) => href === "/evaluation" || href === "/chat");
  return (
    <nav className="staffnav" aria-label={staff ? "Staff" : "Site"}>
      <span className="brand-name">{staff ? "Meridian · Staff" : "Meridian Home Comfort"}</span>
      {links.map(([href, label]) => (
        <a key={href} href={href} aria-current={current === href ? "page" : undefined}>
          {label}{href === "/staff/handoffs" && waiting ? <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span> : null}
        </a>
      ))}
    </nav>
  );
}
