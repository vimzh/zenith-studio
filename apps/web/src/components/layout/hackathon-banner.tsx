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
    <Alert className="mx-10 block w-auto rounded-none border-y-0 border-neutral-950/60 bg-neutral-800 px-0 py-0 text-neutral-50 sm:mx-16 lg:mx-24">
      <p className="px-10 py-1.5 text-center text-xs leading-5">
        {prefix}{" "}
        <Link
          className="font-semibold underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-50"
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
        className="absolute top-1/2 right-0 size-8 -translate-y-1/2 rounded-none text-neutral-100 before:absolute before:-inset-1.5 before:content-[''] hover:bg-white/10 hover:text-white focus-visible:border-white/40 focus-visible:ring-white/50"
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
