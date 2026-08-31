import { HomeHero } from "@/components/home/home-hero";
import { SiteNavbar } from "@/components/layout/site-navbar";
import { homeContent } from "@/data/home";

export default function Home() {
  return (
    <div className="min-h-svh">
      <SiteNavbar />
      <main className="mx-4 border-l sm:mx-6 lg:mx-8" id="main-content">
        <HomeHero {...homeContent.hero} />
      </main>
      <div aria-hidden="true" className="h-12 border-t">
        <div className="mx-4 h-full border-x sm:mx-6 lg:mx-8" />
      </div>
    </div>
  );
}
