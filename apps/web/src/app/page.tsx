import { HomeHero } from "@/components/home/home-hero";
import { homeContent } from "@/data/home";
import { siteContent } from "@/data/site";

export default function Home() {
  return (
    <main>
      <HomeHero eyebrow={siteContent.title} {...homeContent.hero} />
    </main>
  );
}
