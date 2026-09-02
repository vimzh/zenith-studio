import Image from "next/image";
import { GeistPixelSquare } from "geist/font/pixel";
import { landingContent } from "@/data/landing";

const { features } = landingContent;

export function LandingFeatures() {
  return (
    <section className="border-t border-white/10 bg-[#111] py-24" id="features">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2
            className={`${GeistPixelSquare.className} text-balance text-3xl font-medium text-white sm:text-5xl`}
          >
            {features.title}
          </h2>
          <p className="mt-5 text-pretty text-base leading-relaxed text-white/60 sm:text-lg">
            {features.description}
          </p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {features.items.map((feature, index) => (
            <article
              className="overflow-hidden rounded-[12px] border border-white/10 bg-[#171717]"
              key={feature.title}
            >
              <div className="relative aspect-[4/3] bg-[#0d0d0d]">
                <Image
                  alt=""
                  className="object-contain p-10 pb-24 [image-rendering:pixelated]"
                  fill
                  loading={index === 0 ? "eager" : "lazy"}
                  sizes="(min-width: 1024px) 33vw, 100vw"
                  src={feature.image}
                  unoptimized
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent px-6 pt-24 pb-6">
                  <h3 className="text-lg font-medium text-white">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    {feature.description}
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
