type HowItWorksSectionProps = {
  description: string;
  heading: string;
  steps: readonly {
    description: string;
    label: string;
    title: string;
  }[];
};

export function HowItWorksSection({
  description,
  heading,
  steps,
}: HowItWorksSectionProps) {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      className="scroll-mt-14 border-t"
      id="how-it-works"
    >
      <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
        <header className="border-b p-6 sm:p-8 lg:border-r lg:border-b-0 lg:p-12">
          <h2
            className="font-mono text-3xl font-normal tracking-[-0.04em] sm:text-4xl"
            id="how-it-works-heading"
          >
            {heading}
          </h2>
          <p className="mt-6 max-w-md text-pretty text-base leading-7 text-muted-foreground">
            {description}
          </p>
        </header>

        <ol>
          {steps.map((step) => (
            <li
              className="grid min-h-44 grid-cols-[3rem_1fr] gap-4 border-b p-6 last:border-b-0 sm:grid-cols-[4rem_1fr] sm:p-8"
              key={step.label}
            >
              <span className="font-mono text-sm text-muted-foreground">
                {step.label}
              </span>
              <div>
                <h3 className="text-balance text-2xl font-medium tracking-[-0.02em]">
                  {step.title}
                </h3>
                <p className="mt-4 max-w-xl text-pretty text-base leading-7 text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
