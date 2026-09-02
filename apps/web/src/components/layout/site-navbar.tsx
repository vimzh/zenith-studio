import Link from "next/link";
import Image from "next/image";
import SmoothButton from "@/components/smoothui/smooth-button";
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
        <Image
          alt=""
          className="rounded-[8px]"
          height={32}
          priority
          src="/logo.png"
          width={32}
        />
        <span>{navigationContent.brand.name}</span>
      </Link>

      <ul className="hidden items-center gap-8 text-sm md:flex">
        {navigationContent.links.map((link) => (
          <li key={link.label}>
            <Link
              className="flex min-h-11 items-center text-white/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[scrolled=true]/navbar:text-muted-foreground group-data-[scrolled=true]/navbar:hover:text-foreground"
              href={link.href}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="justify-self-end">
        <SmoothButton
          asChild
          size="lg"
          variant="candy"
        >
          <Link href={navigationContent.action.href}>
            {navigationContent.action.label}
          </Link>
        </SmoothButton>
      </div>
    </nav>
  );
}
