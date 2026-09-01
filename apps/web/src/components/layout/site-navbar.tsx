import Link from "next/link";
import { PackageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigationContent } from "@/data/navigation";

export function SiteNavbar() {
  return (
    <nav
      aria-label={navigationContent.label}
      className="grid h-16 w-full grid-cols-[1fr_auto] items-center md:grid-cols-[1fr_auto_1fr]"
    >
      <Link
        aria-label={navigationContent.brand.homeLabel}
        className="flex min-h-11 w-fit items-center gap-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href="/"
      >
        <span className="grid size-8 place-items-center border bg-primary text-primary-foreground">
          <PackageIcon aria-hidden="true" className="size-4" />
        </span>
        <span>{navigationContent.brand.name}</span>
      </Link>

      <ul className="hidden items-center gap-8 text-sm md:flex">
        {navigationContent.links.map((link) => (
          <li key={link.label}>
            <Link
              className="flex min-h-11 items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={link.href}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="justify-self-end">
        <Button asChild className="h-11 rounded-md px-4 text-base shadow-none">
          <Link href={navigationContent.action.href}>
            {navigationContent.action.label}
          </Link>
        </Button>
      </div>
    </nav>
  );
}
