import { LandingAssetForge } from "@/components/landing/landing-asset-forge";
import { LandingFeatures } from "@/components/landing/landing-features";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingPower } from "@/components/landing/landing-power";

export default function LandingPage() {
  return (
    <>
      <LandingHero />
      <LandingFeatures />
      <LandingPower />
      <LandingAssetForge />
      <LandingFooter />
    </>
  );
}
