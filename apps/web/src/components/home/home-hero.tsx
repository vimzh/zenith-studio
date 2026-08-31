import { AuthControl } from "@/components/auth/auth-control";
import { HeroMotif } from "@/components/home/hero-motif";

type HomeHeroProps = {
  eyebrow: string;
  heading: string;
  subheading: string;
};

export function HomeHero({ eyebrow, heading, subheading }: HomeHeroProps) {
  return (
    <section className="grid min-h-svh bg-muted/40 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
      <div className="min-h-[62svh] px-6 pb-16 pt-14 sm:px-10 sm:pt-16 lg:min-h-svh lg:px-14 lg:pt-[18svh] xl:px-20">
        <div className="max-w-3xl">
          <p className="font-mono text-sm font-medium tracking-[-0.02em]">
            {eyebrow}
          </p>
          <h1 className="mt-8 whitespace-pre-line font-mono text-5xl font-normal leading-[0.98] tracking-[-0.055em] sm:text-6xl xl:text-7xl 2xl:text-8xl">
            {heading}
          </h1>
          <p className="mt-8 max-w-xl text-pretty font-sans text-base leading-7 text-muted-foreground sm:text-lg">
            {subheading}
          </p>
          <div className="mt-9">
            <AuthControl />
          </div>
        </div>
      </div>

      <HeroMotif />
    </section>
  );
}
