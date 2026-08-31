import Image from "next/image";

export function HeroVisual() {
  return (
    <div className="relative -ml-6 -mr-6 min-h-72 overflow-hidden border-t bg-muted sm:-ml-8 sm:-mr-8 lg:-mr-12 lg:ml-0 lg:min-h-[calc(100svh-6rem)] lg:border-l lg:border-t-0">
      <Image
        alt=""
        className="object-cover object-[68%_center]"
        fill
        preload
        sizes="(min-width: 1024px) 43vw, 100vw"
        src="/images/hero-coast.jpeg"
      />
    </div>
  );
}
