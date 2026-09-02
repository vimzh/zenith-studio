"use client";

import Image from "next/image";
import Link from "next/link";
import { GeistPixelSquare } from "geist/font/pixel";
import { motion, useReducedMotion } from "motion/react";
import SmoothButton from "@/components/smoothui/smooth-button";
import { landingContent } from "@/data/landing";

const { power, showcase } = landingContent;
type ForgeItem = (typeof power.items)[number];

export function LandingAssetForge() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="overflow-hidden border-t border-white/10 bg-[#080808] py-24 text-white" id="how-it-works">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2
            className={`${GeistPixelSquare.className} text-balance text-3xl font-medium sm:text-5xl`}
          >
            {showcase.title}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-white/60 sm:text-lg">
            {showcase.description}
          </p>
        </div>
      </div>

      <div className="relative mt-14 h-[640px] overflow-hidden bg-[#0d0d0d]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:24px_24px]" />

        <div className="absolute inset-x-[-8%] top-6 -rotate-2 space-y-1 opacity-60">
          <AssetStrip
            duration={32}
            items={power.items.slice(0, 3)}
            reducedMotion={shouldReduceMotion}
          />
          <AssetStrip
            duration={38}
            items={power.items.slice(3)}
            reducedMotion={shouldReduceMotion}
            reverse
          />
        </div>

        {shouldReduceMotion ? null : (
          <motion.div
            animate={{ top: ["4%", "96%", "4%"] }}
            aria-hidden="true"
            className="absolute inset-x-0 z-10 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent shadow-[0_0_18px_rgba(103,232,249,0.65)]"
            transition={{ duration: 8, ease: "linear", repeat: Infinity }}
          />
        )}

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,black_0%,rgba(0,0,0,0.94)_28%,rgba(0,0,0,0.25)_68%,rgba(0,0,0,0.7)_100%)]" />
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
          <div className="w-full max-w-4xl">
            <div className="flex items-center justify-center gap-4">
              <motion.span
                animate={shouldReduceMotion ? undefined : { opacity: [0.35, 1, 0.35] }}
                className="size-3 bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]"
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <h3 className={`${GeistPixelSquare.className} text-3xl text-white sm:text-4xl`}>
                {showcase.panelTitle}
              </h3>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
              {showcase.steps.map((step, index) => (
                <ForgeStep
                  delay={index * 0.35}
                  key={step}
                  reducedMotion={shouldReduceMotion}
                  step={step}
                />
              ))}
            </div>

            <p className="mt-10 text-sm text-emerald-300">{showcase.status}</p>
            <div className="mt-5">
              <SmoothButton asChild size="lg" variant="candy">
                <Link href="/home">Enter the studio</Link>
              </SmoothButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AssetStrip({
  duration,
  items,
  reducedMotion,
  reverse = false,
}: {
  duration: number;
  items: readonly ForgeItem[];
  reducedMotion: boolean | null;
  reverse?: boolean;
}) {
  return (
    <motion.div
      animate={
        reducedMotion
          ? undefined
          : { x: reverse ? ["-50%", "0%"] : ["0%", "-50%"] }
      }
      className="flex w-max"
      transition={{ duration, ease: "linear", repeat: Infinity }}
    >
      {[0, 1].map((copy) => (
        <div className="flex shrink-0 gap-4 pr-4" key={copy}>
          {items.map((item) => (
            <div className="relative size-64 shrink-0 sm:size-72" key={`${copy}-${item.title}`}>
              <Image
                alt=""
                className="object-cover [image-rendering:pixelated]"
                fill
                sizes="288px"
                src={item.image}
              />
            </div>
          ))}
        </div>
      ))}
    </motion.div>
  );
}

function ForgeStep({
  delay,
  reducedMotion,
  step,
}: {
  delay: number;
  reducedMotion: boolean | null;
  step: string;
}) {
  return (
    <motion.div
      animate={reducedMotion ? undefined : { opacity: [0.45, 1, 0.45] }}
      className="flex items-center gap-2 text-sm text-white/70"
      transition={{ delay, duration: 2.4, repeat: Infinity }}
    >
      <span className="size-2 bg-emerald-400" />
      <span>{step}</span>
    </motion.div>
  );
}
