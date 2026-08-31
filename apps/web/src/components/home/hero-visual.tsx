import Image from "next/image";

export function HeroVisual() {
  return (
    <div className="relative min-h-[38svh] overflow-hidden bg-muted lg:min-h-svh">
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
