type UseCasesSectionProps = {
  description: string;
  heading: string;
  items: readonly {
    context: string;
    description: string;
    title: string;
  }[];
};

export function UseCasesSection({
  description,
  heading,
  items,
}: UseCasesSectionProps) {
  return (
    <section
      aria-labelledby="use-cases-heading"
      className="scroll-mt-14 border-t"
      id="use-cases"
    >
      <header className="grid gap-6 border-b p-6 sm:p-8 lg:grid-cols-[1fr_0.75fr] lg:items-end lg:p-12">
        <h2
          className="font-mono text-3xl font-normal tracking-[-0.04em] sm:text-4xl"
          id="use-cases-heading"
        >
          {heading}
        </h2>
        <p className="max-w-xl text-pretty text-base leading-7 text-muted-foreground lg:justify-self-end">
          {description}
        </p>
      </header>

      <ul>
        {items.map((item) => (
          <li
            className="grid min-h-40 gap-6 border-b p-6 last:border-b-0 sm:p-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:p-10"
            key={item.title}
          >
            <div>
              <p className="text-sm text-muted-foreground">{item.context}</p>
              <h3 className="mt-3 text-balance text-2xl font-medium tracking-[-0.02em] sm:text-3xl">
                {item.title}
              </h3>
            </div>
            <p className="max-w-xl text-pretty text-base leading-7 text-muted-foreground lg:justify-self-end">
              {item.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
