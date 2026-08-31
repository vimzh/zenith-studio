type TechStackSectionProps = {
  description: string;
  heading: string;
  items: readonly {
    description: string;
    name: string;
  }[];
};

export function TechStackSection({
  description,
  heading,
  items,
}: TechStackSectionProps) {
  return (
    <section
      aria-labelledby="tech-stack-heading"
      className="scroll-mt-14 border-t"
      id="tech-stack"
    >
      <div className="grid lg:grid-cols-[0.75fr_1.25fr]">
        <header className="p-6 sm:p-8 lg:border-r lg:p-12">
          <h2
            className="font-mono text-3xl font-normal tracking-[-0.04em] sm:text-4xl"
            id="tech-stack-heading"
          >
            {heading}
          </h2>
          <p className="mt-6 max-w-sm text-pretty text-base leading-7 text-muted-foreground">
            {description}
          </p>
        </header>

        <dl className="grid grid-cols-2 border-t lg:border-t-0">
          {items.map((item) => (
            <div
              className="min-h-32 border-b p-6 odd:border-r sm:p-8 [&:nth-last-child(-n+2)]:border-b-0"
              key={item.name}
            >
              <dt className="text-lg font-medium">{item.name}</dt>
              <dd className="mt-3 text-sm leading-6 text-muted-foreground">
                {item.description}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
