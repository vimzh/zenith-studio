import Link from "next/link";

type SiteFooterProps = {
  brand: string;
  links: readonly {
    href: string;
    label: string;
  }[];
  navigationLabel: string;
  note: string;
};

export function SiteFooter({
  brand,
  links,
  navigationLabel,
  note,
}: SiteFooterProps) {
  return (
    <footer className="border-t">
      <div className="mx-10 grid min-h-32 items-center gap-8 border-x px-6 py-8 sm:mx-16 sm:px-8 lg:mx-24 lg:grid-cols-[1fr_auto]">
        <div>
          <p className="text-lg font-medium">{brand}</p>
          <p className="mt-1 text-sm text-muted-foreground">{note}</p>
        </div>

        <nav aria-label={navigationLabel}>
          <ul className="flex flex-wrap gap-x-6 gap-y-3">
            {links.map((link) => (
              <li key={link.label}>
                <Link
                  className="text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={link.href}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
