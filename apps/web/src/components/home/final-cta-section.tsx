import { AuthControl } from "@/components/auth/auth-control";

type FinalCtaSectionProps = {
  description: string;
  heading: string;
  primaryLabel: string;
};

export function FinalCtaSection({
  description,
  heading,
  primaryLabel,
}: FinalCtaSectionProps) {
  return (
    <section
      aria-labelledby="final-cta-heading"
      className="scroll-mt-14 border-t bg-neutral-900 p-6 text-neutral-50 sm:p-8 lg:p-12"
      id="start"
    >
      <div className="grid items-end gap-10 lg:grid-cols-[1fr_auto]">
        <div>
          <h2
            className="max-w-3xl text-balance font-mono text-4xl font-normal tracking-[-0.05em] sm:text-5xl lg:text-6xl"
            id="final-cta-heading"
          >
            {heading}
          </h2>
          <p className="mt-6 max-w-xl text-pretty text-base leading-7 text-neutral-300">
            {description}
          </p>
        </div>

        <div className="[&>form]:w-fit [&_[data-slot=button]]:h-11 [&_[data-slot=button]]:min-w-40 [&_[data-slot=button]]:rounded-[4px] [&_[data-slot=button]]:px-5 [&_[data-slot=button]]:font-sans [&_[data-slot=button]]:text-base [&_[data-slot=button]]:font-medium">
          <AuthControl label={primaryLabel} showGoogleIcon={false} />
        </div>
      </div>
    </section>
  );
}
