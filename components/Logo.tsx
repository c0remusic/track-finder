// Two overlapping discs — same motif as app/icon.tsx (the favicon), reused
// here at UI scale next to the page title. Uses currentColor so it inherits
// text-foreground and needs no dark-mode variant of its own.
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="10" r="6.5" stroke="var(--primary)" strokeWidth="2" />
      <circle cx="13" cy="10" r="6.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
