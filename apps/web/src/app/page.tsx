import { FinalCtaSection } from "@/components/home/final-cta-section";
import { FeaturesSection } from "@/components/home/features-section";
import { HomeHero } from "@/components/home/home-hero";
import { HowItWorksSection } from "@/components/home/how-it-works-section";
import { TechStackSection } from "@/components/home/tech-stack-section";
import { UseCasesSection } from "@/components/home/use-cases-section";
import { HackathonBanner } from "@/components/layout/hackathon-banner";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteNavbar } from "@/components/layout/site-navbar";
import { homeContent } from "@/data/home";

export default function Home() {
  return (
    <div className="min-h-svh">
      <SiteNavbar />
      <HackathonBanner {...homeContent.hackathonBanner} />
      <main className="mx-10 border-x sm:mx-16 lg:mx-24" id="main-content">
        <HomeHero {...homeContent.hero} />
        <FeaturesSection {...homeContent.features} />
        <UseCasesSection {...homeContent.useCases} />
        <HowItWorksSection {...homeContent.howItWorks} />
        <TechStackSection {...homeContent.techStack} />
        <FinalCtaSection {...homeContent.finalCta} />
      </main>
      <SiteFooter {...homeContent.footer} />
    </div>
  );
}
