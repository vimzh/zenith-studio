import Link from "next/link";
import { Button } from "@/components/ui/button";
import { landingContent } from "@/data/landing";

export function LandingHero() {
  return (
    <section className="flex min-h-[calc(100dvh-4rem)] items-center justify-center py-20 text-center">
      <div className="max-w-3xl">
        <h1 className="text-balance text-4xl leading-[1.08] font-medium tracking-tight sm:text-6xl">
          {landingContent.hero.title}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {landingContent.hero.description}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild className="h-11 rounded-md px-6 text-base">
            <Link href={landingContent.hero.primaryAction.href}>
              {landingContent.hero.primaryAction.label}
            </Link>
          </Button>
          <Button
            className="h-11 rounded-md px-6 text-base"
            type="button"
            variant="outline"
          >
            {landingContent.hero.secondaryAction.label}
          </Button>
        </div>
      </div>
    </section>
  );
}
