"use client";

import { useState } from "react";
import Link from "next/link";
import { XIcon } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type HackathonBannerProps = {
  dismissLabel: string;
  link: {
    href: string;
    label: string;
  };
  prefix: string;
};

export function HackathonBanner({
  dismissLabel,
  link,
  prefix,
}: HackathonBannerProps) {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  return (
    <Alert className="mx-10 w-auto grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-0 rounded-none border-y-0 border-amber-950/20 bg-amber-300 px-0 py-0 text-amber-950 sm:mx-16 lg:mx-24">
      <p className="px-4 py-2.5 text-center text-sm sm:text-left">
        {prefix}{" "}
        <Link
          className="font-semibold underline underline-offset-4 hover:text-amber-950/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-950"
          href={link.href}
          rel="noreferrer"
          target="_blank"
        >
          {link.label}
        </Link>
        .
      </p>
      <Button
        aria-label={dismissLabel}
        className="size-11 rounded-none text-amber-950 hover:bg-amber-950/10 hover:text-amber-950 focus-visible:border-amber-950/40 focus-visible:ring-amber-950/40"
        onClick={() => setIsVisible(false)}
        size="icon-lg"
        type="button"
        variant="ghost"
      >
        <XIcon aria-hidden="true" />
      </Button>
    </Alert>
  );
}
