import { HomeHero } from "@/components/home/home-hero";
import { HackathonBanner } from "@/components/layout/hackathon-banner";
import { SiteNavbar } from "@/components/layout/site-navbar";
import { homeContent } from "@/data/home";

export default function Home() {
  return (
    <div className="min-h-svh">
      <SiteNavbar />
      <HackathonBanner {...homeContent.hackathonBanner} />
      <main className="mx-10 border-x sm:mx-16 lg:mx-24" id="main-content">
        <HomeHero {...homeContent.hero} />
      </main>
      <div aria-hidden="true" className="h-12 border-t">
        <div className="mx-10 h-full border-x sm:mx-16 lg:mx-24" />
      </div>
    </div>
  );
}
