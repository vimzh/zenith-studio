import { HomeHero } from "@/components/home/home-hero";
import { SiteNavbar } from "@/components/layout/site-navbar";
import { homeContent } from "@/data/home";
import { siteContent } from "@/data/site";

export default function Home() {
  return (
    <>
      <SiteNavbar title={siteContent.title} />
      <div className="border-b">
        <main className="mx-4 max-w-6xl border-x sm:mx-6 xl:mx-auto">
          <HomeHero {...homeContent.hero} />
        </main>
      </div>
    </>
  );
}
