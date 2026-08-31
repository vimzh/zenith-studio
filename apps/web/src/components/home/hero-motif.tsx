export function HeroMotif() {
  return (
    <div
      aria-hidden="true"
      className="relative min-h-[38svh] overflow-hidden bg-foreground text-background lg:min-h-svh"
    >
      <svg
        className="absolute inset-0 size-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 640 900"
      >
        <defs>
          <pattern
            height="16"
            id="hero-dot-grid"
            patternUnits="userSpaceOnUse"
            width="16"
          >
            <circle className="fill-background/55" cx="2" cy="2" r="1.25" />
          </pattern>
        </defs>
        <rect fill="url(#hero-dot-grid)" height="900" width="640" />
      </svg>

      <span className="absolute inset-0 flex items-center justify-center font-mono text-[15rem] font-light tracking-[-0.18em] text-foreground sm:text-[20rem] lg:text-[17rem] xl:text-[22rem]">
        {"//"}
      </span>
    </div>
  );
}
