import Image from "next/image";
import Link from "next/link";
import { AuthControl } from "@/components/auth/auth-control";
import { navigationContent } from "@/data/navigation";

export function SiteNavbar() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background">
      <Link
        className="sr-only z-50 bg-background px-4 py-3 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href="#main-content"
      >
        {navigationContent.skipToContent}
      </Link>

      <nav
        aria-label={navigationContent.brand.title}
        className="mx-10 grid h-14 grid-cols-[1fr_auto] border-x sm:mx-16 lg:mx-24 lg:grid-cols-[1fr_auto_1fr]"
      >
        <Link
          className="flex min-h-11 w-fit items-center gap-2 p-1.5 text-base font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          href="/"
        >
          <Image
            alt={navigationContent.brand.imageAlt}
            className="size-11 rounded-[2px] object-cover"
            height={44}
            src={navigationContent.brand.imageSrc}
            width={44}
          />
          {navigationContent.brand.title}
        </Link>

        <ul className="hidden items-center gap-8 lg:flex">
          {navigationContent.links.map((link) => (
            <li key={link.label}>
              <Link
                className="flex min-h-11 items-center px-1 text-base text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={link.href}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end p-1.5 lg:justify-self-end">
          <AuthControl
            appearance="navbar"
            label={navigationContent.login}
            showGoogleIcon={false}
          />
        </div>
      </nav>
    </header>
  );
}
