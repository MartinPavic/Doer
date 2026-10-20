/** The Doer mark: the same indigo tile and thick rounded check as the app icon, so the app, bubble and tray read as one product. */
export const BRAND = "#6366f1";

export function Logo({ size = 32, shape = "square", className = "" }: { size?: number; shape?: "square" | "circle"; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Doer">
      {shape === "circle" ? <circle cx="32" cy="32" r="32" fill={BRAND} /> : <rect width="64" height="64" rx="14.4" fill={BRAND} />}
      <path d="M17.9 33.3 27.5 42.9 46.1 23" fill="none" stroke="#fff" strokeWidth="10.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Same tile with a bell instead of the check: shown while a reminder needs attention. */
export function BellMark({ size = 32, shape = "circle", className = "" }: { size?: number; shape?: "square" | "circle"; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Reminder">
      {shape === "circle" ? <circle cx="32" cy="32" r="32" fill={BRAND} /> : <rect width="64" height="64" rx="14.4" fill={BRAND} />}
      <path
        d="M32 15c-7 0-12 5.2-12 12v6.5c0 1.6-.6 3.1-1.7 4.3L16 40.2c-.8.9-.2 2.3 1 2.3h30c1.2 0 1.8-1.4 1-2.3l-2.3-2.4a6.3 6.3 0 0 1-1.7-4.3V27c0-6.8-5-12-12-12Z"
        fill="#fff"
      />
      <path d="M27 47.5a5 5 0 0 0 10 0" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
