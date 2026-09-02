import Image from "next/image";
import Link from "next/link";
import { GeistPixelSquare } from "geist/font/pixel";
import SmoothButton from "@/components/smoothui/smooth-button";
import { landingContent } from "@/data/landing";
import { navigationContent } from "@/data/navigation";

const { footer } = landingContent;

export function LandingFooter() {
  return (
    <footer className="border-t border-white/10 bg-black pt-20 text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-[12px] border border-white/10 bg-[#101010]">
          <Image
            alt=""
            className="object-cover object-right opacity-35"
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            src="/images/power/game-ready-pack.png"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#101010] via-[#101010]/95 to-[#101010]/25" />

          <div className="relative max-w-2xl px-6 py-16 sm:px-10 sm:py-20">
            <p className="text-base text-amber-300">{footer.quest}</p>
            <h2
              className={`${GeistPixelSquare.className} mt-4 text-balance text-3xl leading-tight font-medium sm:text-5xl`}
            >
              {footer.title}
            </h2>
            <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-white/65 sm:text-lg">
              {footer.description}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <SmoothButton
                asChild
                size="lg"
                variant="candy"
              >
                <Link href="/home">Start creating</Link>
              </SmoothButton>
              {footer.rewards.map((reward) => (
                <span
                  className="rounded-md border border-white/10 bg-black/60 px-4 py-2 text-sm text-white/70"
                  key={reward}
                >
                  {reward}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-8 py-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link className="flex w-fit items-center gap-3 font-medium" href="/">
              <Image
                alt=""
                className="rounded-[10px]"
                height={40}
                src="/logo.png"
                width={40}
              />
              <span>{navigationContent.brand.name}</span>
            </Link>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/50">
              {footer.tagline}
            </p>
          </div>

          <nav aria-label="Footer navigation">
            <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/60">
              {footer.links.map((link) => (
                <li key={link.label}>
                  <Link className="hover:text-white" href={link.href}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-5 text-center text-sm text-white/60">
        Built one pixel at a time.
      </div>
    </footer>
  );
}
