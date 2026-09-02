import { GeistPixelSquare } from "geist/font/pixel";
import { LandingPrompt } from "@/components/landing/landing-prompt";
import { landingContent } from "@/data/landing";

const { hero } = landingContent;

export function LandingHero() {
  return (
    <section className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[url('/images/hero-pixel-landscape.png')] bg-cover bg-center py-20 text-center text-white [image-rendering:pixelated]">
      <div aria-hidden="true" className="absolute inset-0 bg-black/55" />
      <div className="relative mx-auto w-full max-w-5xl px-6">
        <h1
          className={`${GeistPixelSquare.className} text-balance text-4xl leading-[1.08] font-medium sm:text-5xl lg:text-6xl`}
        >
          {hero.title}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-white/80 sm:text-lg">
          {hero.description}
        </p>
        <div className="mt-8">
          <LandingPrompt />
        </div>
      </div>
    </section>
  );
}
