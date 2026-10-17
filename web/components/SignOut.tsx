"use client";

// Ends the demo session and returns to the invite page.
export function SignOut({ label = "Sign out", className = "btn btn-quiet" }: { label?: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={async () => {
      await fetch("/api/session", { method: "DELETE" }).catch(() => {});
      window.location.assign("/");
    }}>{label}</button>
  );
}
