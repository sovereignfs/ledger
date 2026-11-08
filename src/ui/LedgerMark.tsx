/** The app's mark, one path in `currentColor`: the same shape as `public/icons/icon.svg`, for the places that have room for it (sign-in). */
export function LedgerMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label="Ledger"
      fill="none"
      stroke="currentColor"
      strokeWidth={28}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M132 124h200a48 48 0 0 1 48 48v216H180a48 48 0 0 1-48-48z" />
      <path d="M196 124v264" />
      <path d="M244 200h92M244 256h92M244 312h56" />
    </svg>
  );
}
