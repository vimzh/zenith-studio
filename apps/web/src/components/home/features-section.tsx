import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type FeaturesSectionProps = {
  cards: readonly {
    description: string;
    imageLabel: string;
    imageRatio: {
      height: number;
      width: number;
    };
    label: string;
    title: string;
  }[];
  heading: string;
};

const cardLayout = [
  "min-h-80 border-b lg:row-span-2 lg:min-h-[32rem] lg:border-r lg:border-b-0",
  "min-h-64 border-b",
  "min-h-64",
] as const;

export function FeaturesSection({
  cards,
  heading,
}: FeaturesSectionProps) {
  return (
    <section
      aria-labelledby="features-heading"
      className="scroll-mt-14 border-t"
      id="features"
    >
      <div className="flex h-14 items-center justify-center border-b px-6">
        <h2
          className="text-center font-mono text-base font-normal tracking-[-0.02em]"
          id="features-heading"
        >
          {heading}
        </h2>
      </div>

      <div className="grid lg:grid-cols-2">
        {cards.map((card, index) => (
          <Card
            className={cn(
              "gap-0 rounded-none bg-background py-0 shadow-none ring-0",
              cardLayout[index]
            )}
            key={card.label}
          >
            <CardHeader className="flex items-start justify-between gap-4 p-6 sm:p-8">
              <h3 className="max-w-lg flex-1 text-balance text-2xl font-medium tracking-[-0.02em] sm:text-3xl">
                {card.title}
              </h3>
              <CardDescription className="shrink-0 pt-1 font-mono text-xs">
                {card.label}
              </CardDescription>
            </CardHeader>
            <div
              className="mx-6 flex items-center justify-center border border-dashed bg-muted/20 sm:mx-8"
              style={{
                aspectRatio: `${card.imageRatio.width} / ${card.imageRatio.height}`,
              }}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {card.imageLabel} · {card.imageRatio.width}:
                {card.imageRatio.height}
              </span>
            </div>
            <CardContent className="mt-auto p-6 sm:p-8">
              <p className="max-w-lg text-pretty text-base leading-7 text-muted-foreground">
                {card.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
