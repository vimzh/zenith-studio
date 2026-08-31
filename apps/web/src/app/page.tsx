import { HomeHero } from "@/components/home/home-hero";
import { SiteNavbar } from "@/components/layout/site-navbar";
import { homeContent } from "@/data/home";

export default function Home() {
  return (
    <div className="min-h-svh">
      <SiteNavbar />
      <main className="mx-6 border-l sm:mx-8 lg:mx-12" id="main-content">
        <HomeHero {...homeContent.hero} />
      </main>
      <div aria-hidden="true" className="h-12 border-t">
        <div className="mx-6 grid h-full border-x sm:mx-8 lg:mx-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
          <div className="hidden lg:col-start-2 lg:block lg:border-l" />
        </div>
      </div>
    </div>
  );
}
