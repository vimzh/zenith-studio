import Link from "next/link";

type SiteNavbarProps = {
  title: string;
};

export function SiteNavbar({ title }: SiteNavbarProps) {
  return (
    <header className="border-b bg-background">
      <nav
        aria-label={title}
        className="mx-8 grid h-12 grid-cols-[minmax(0,1fr)_3rem] border-x sm:mx-12 lg:mx-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]"
      >
        <Link
          className="flex min-h-11 items-center px-4 font-mono text-sm font-medium tracking-[-0.02em] hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5"
          href="/"
        >
          {title}
        </Link>
        <div aria-hidden="true" />
      </nav>
    </header>
  );
}
