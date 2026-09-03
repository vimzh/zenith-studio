import Image from "next/image";
import { GeistPixelSquare } from "geist/font/pixel";
import { landingContent } from "@/data/landing";

const { gallery } = landingContent;

/**
 * Real output, not a mockup: five generated characters and the fifteen
 * animations the pipeline drew for them, exactly as it produced them. The GIFs
 * are the share-speed versions — half speed with a rest beat on the idle pose —
 * because a loop that plays unattended reads as frantic at game timing.
 */
export function LandingGallery() {
  return (
    <section className="border-t border-white/10 bg-[#0d0d0d] py-24" id="showcase">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2
            className={`${GeistPixelSquare.className} text-balance text-3xl font-medium text-white sm:text-5xl`}
          >
            {gallery.title}
          </h2>
          <p className="mt-5 text-pretty text-base leading-relaxed text-white/60 sm:text-lg">
            {gallery.description}
          </p>
        </div>

        <div className="mt-12 flex flex-col gap-4">
          {gallery.characters.map((character, row) => (
            <article
              className="grid gap-4 rounded-[12px] border border-white/10 bg-[#151515] p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]"
              key={character.slug}
            >
              <div className="flex gap-4 lg:flex-col">
                <div className="relative aspect-square w-32 shrink-0 overflow-hidden rounded-[8px] border border-white/10 bg-[#0b0b0b] lg:w-full">
                  <Image
                    alt={character.name}
                    className="object-contain p-3 [image-rendering:pixelated]"
                    fill
                    loading={row === 0 ? "eager" : "lazy"}
                    sizes="(min-width: 1024px) 25vw, 128px"
                    src={character.portrait}
                    unoptimized
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-medium text-white">{character.name}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-white/65">{character.description}</p>
                </div>
              </div>

              <ul className="grid gap-4 sm:grid-cols-3">
                {character.animations.map((animation) => (
                  <li
                    className="overflow-hidden rounded-[8px] border border-white/10 bg-[#0b0b0b]"
                    key={animation.slug}
                  >
                    <div className="relative aspect-square">
                      <Image
                        alt={`${character.name}: ${animation.title}`}
                        className="object-contain [image-rendering:pixelated]"
                        fill
                        loading={row === 0 ? "eager" : "lazy"}
                        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 100vw"
                        src={animation.gif}
                        unoptimized
                      />
                    </div>
                    <div className="border-t border-white/10 px-4 py-3">
                      <p className="text-sm font-medium text-white">{animation.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-white/55">{animation.effect}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="mt-6 text-xs leading-relaxed text-white/45">{gallery.footnote}</p>
      </div>
    </section>
  );
}
