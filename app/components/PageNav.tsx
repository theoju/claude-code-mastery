import Link from "next/link";

type PageKey =
  | "dashboard"
  | "methodology"
  | "probes"
  | "progression"
  | "dimension"
  | "tip"
  | "docs";

interface NavItem {
  key: PageKey;
  label: string;
  href: string;
}

const PRIMARY: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "methodology", label: "Methodology", href: "/methodology" },
  { key: "probes", label: "Probes", href: "/methodology/probes" },
  { key: "progression", label: "Progression", href: "/progression" },
];

interface Props {
  current: PageKey;
  // Optional trailing breadcrumb for context pages (dimension detail, tip).
  // The rendered label is non-linked text appended after the primary nav.
  context?: { label: string; parentKey?: PageKey };
}

const ITEM_BASE =
  "rounded-lg px-3 py-1.5 text-xs uppercase tracking-[0.14em] transition-colors";

export default function PageNav({ current, context }: Props) {
  return (
    <nav
      aria-label="Primary"
      className="flex flex-wrap items-center gap-1 mb-8 -mx-1 px-1 py-2 border-b border-[color:var(--color-line)]"
    >
      {PRIMARY.map((item) => {
        const active =
          item.key === current ||
          (context?.parentKey === item.key && current !== "dashboard");
        return active ? (
          <span
            key={item.key}
            aria-current="page"
            className={`${ITEM_BASE} font-semibold text-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] border border-[color:color-mix(in_srgb,var(--color-accent)_35%,transparent)]`}
          >
            {item.label}
          </span>
        ) : (
          <Link
            key={item.key}
            href={item.href}
            className={`${ITEM_BASE} border border-transparent text-[color:var(--color-mute)] hover:text-[color:var(--color-text)] hover:bg-white/5`}
          >
            {item.label}
          </Link>
        );
      })}
      {context && (
        <span className="flex items-center gap-2 ml-1">
          <span aria-hidden="true" className="text-[color:var(--color-line-2)]">
            ›
          </span>
          <span className="text-[color:var(--color-text)] font-medium text-sm">
            {context.label}
          </span>
        </span>
      )}
    </nav>
  );
}
