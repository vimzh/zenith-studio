import { HomeHero } from "@/components/home/home-hero";
import { SiteNavbar } from "@/components/layout/site-navbar";
import { homeContent } from "@/data/home";
import { siteContent } from "@/data/site";

export default function Home() {
  return (
    <div className="min-h-svh">
      <SiteNavbar title={siteContent.title} />
      <main className="mx-4 border-x sm:mx-6 lg:mx-8">
        <HomeHero {...homeContent.hero} />
      </main>
      <div aria-hidden="true" className="h-12 border-t">
        <div className="mx-4 h-full border-x sm:mx-6 lg:mx-8" />
      </div>
    </div>
  );
}
