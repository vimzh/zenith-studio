"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type StickyNavbarShellProps = {
  children: ReactNode;
};

export function StickyNavbarShell({ children }: StickyNavbarShellProps) {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsScrolled(!entry.isIntersecting);
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 size-px"
        ref={sentinelRef}
      />
      <header
        className={cn(
          "sticky top-0 z-20 border-b border-transparent bg-background transition-colors duration-150 motion-reduce:transition-none",
          isScrolled && "border-border"
        )}
      >
        {children}
      </header>
    </>
  );
}
