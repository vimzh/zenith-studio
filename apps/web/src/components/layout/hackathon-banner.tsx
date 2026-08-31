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
    <Alert className="mx-10 block w-auto rounded-none border-y-0 border-amber-950/20 bg-amber-300 px-0 py-0 text-amber-950 sm:mx-16 lg:mx-24">
      <p className="px-10 py-1.5 text-center text-xs leading-5">
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
        className="absolute top-1/2 right-0 size-8 -translate-y-1/2 rounded-none text-amber-950 before:absolute before:-inset-1.5 before:content-[''] hover:bg-amber-950/10 hover:text-amber-950 focus-visible:border-amber-950/40 focus-visible:ring-amber-950/40"
        onClick={() => setIsVisible(false)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <XIcon aria-hidden="true" />
      </Button>
    </Alert>
  );
}
