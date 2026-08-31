import Link from "next/link";

type SiteNavbarProps = {
  title: string;
};

export function SiteNavbar({ title }: SiteNavbarProps) {
  return (
    <header className="border-b bg-background">
      <nav
        aria-label={title}
        className="mx-4 grid h-16 max-w-6xl grid-cols-[minmax(0,1fr)_3.5rem] border-x sm:mx-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] xl:mx-auto"
      >
        <Link
          className="flex min-h-11 items-center px-5 font-mono text-sm font-medium tracking-[-0.02em] hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-8"
          href="/"
        >
          {title}
        </Link>
        <div aria-hidden="true" className="border-l" />
      </nav>
    </header>
  );
}
