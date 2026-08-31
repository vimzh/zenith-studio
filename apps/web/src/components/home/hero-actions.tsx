import Link from "next/link";
import { AuthControl } from "@/components/auth/auth-control";
import { Button } from "@/components/ui/button";

type HeroActionsProps = {
  primaryLabel: string;
  secondaryLink: {
    href: string;
    label: string;
  };
};

export function HeroActions({
  primaryLabel,
  secondaryLink,
}: HeroActionsProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 sm:flex-row [&>form]:w-fit [&_[data-slot=button]]:h-11 [&_[data-slot=button]]:w-40 [&_[data-slot=button]]:rounded-[4px] [&_[data-slot=button]]:px-5 [&_[data-slot=button]]:font-sans [&_[data-slot=button]]:text-base [&_[data-slot=button]]:font-medium">
      <AuthControl
        appearance="navbar"
        label={primaryLabel}
        showGoogleIcon={false}
      />
      <Button
        asChild
        variant="outline"
      >
        <Link href={secondaryLink.href}>{secondaryLink.label}</Link>
      </Button>
    </div>
  );
}
