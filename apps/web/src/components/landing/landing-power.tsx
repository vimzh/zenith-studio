import Image from "next/image";
import { GeistPixelSquare } from "geist/font/pixel";
import { landingContent } from "@/data/landing";

const { power } = landingContent;

export function LandingPower() {
  return (
    <section className="border-t border-white/10 bg-[#0b0b0b] py-24" id="use-cases">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2
            className={`${GeistPixelSquare.className} text-balance text-3xl font-medium text-white sm:text-5xl`}
          >
            {power.title}
          </h2>
          <p className="mt-5 text-pretty text-base leading-relaxed text-white/60 sm:text-lg">
            {power.description}
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {power.items.map((item) => (
            <article
              className="overflow-hidden rounded-[16px] border border-white/10 bg-[#151515]"
              key={item.title}
            >
              <div className="relative aspect-square bg-black">
                <Image
                  alt=""
                  className="object-cover [image-rendering:pixelated]"
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                  src={item.image}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/90 to-transparent px-6 pt-28 pb-6">
                  <h3 className="text-lg font-medium text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    {item.description}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
