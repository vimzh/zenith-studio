import { HeroActions } from "@/components/home/hero-actions";
import { HeroVisual } from "@/components/home/hero-visual";

type HomeHeroProps = {
  actions: {
    primaryLabel: string;
    secondaryLink: {
      href: string;
      label: string;
    };
  };
  heading: string;
  subheading: string;
};

export function HomeHero({ actions, heading, subheading }: HomeHeroProps) {
  return (
    <section className="grid min-h-[calc(100dvh-5.5rem-1px)] bg-muted/40 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
      <div className="flex min-h-[28rem] items-center px-5 py-10 sm:px-8 lg:min-h-[calc(100dvh-5.5rem-1px)] lg:px-10">
        <div className="w-full max-w-3xl">
          <h1 className="whitespace-pre-line font-mono text-5xl font-normal leading-[0.98] tracking-[-0.055em] sm:text-6xl xl:text-7xl 2xl:text-8xl">
            {heading}
          </h1>
          <p className="mt-8 max-w-xl text-pretty font-sans text-base leading-7 text-muted-foreground sm:text-lg">
            {subheading}
          </p>
          <div className="mt-9">
            <HeroActions {...actions} />
          </div>
        </div>
      </div>

      <HeroVisual />
    </section>
  );
}
