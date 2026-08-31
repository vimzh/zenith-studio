import type { Metadata } from "next";
import "./globals.css";
import { DM_Mono } from "next/font/google";
import localFont from "next/font/local";
import { siteContent } from "@/data/site";
import { cn } from "@/lib/utils";

const foundersGrotesk = localFont({
  display: "swap",
  src: [
    {
      path: "./fonts/founders-grotesk-regular.otf",
      style: "normal",
      weight: "400",
    },
    {
      path: "./fonts/founders-grotesk-medium.otf",
      style: "normal",
      weight: "500",
    },
    {
      path: "./fonts/founders-grotesk-semibold.otf",
      style: "normal",
      weight: "600",
    },
  ],
  variable: "--font-founders-grotesk",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-dm-mono",
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: siteContent.title,
  description: siteContent.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(
        "font-sans antialiased",
        foundersGrotesk.variable,
        dmMono.variable
      )}
    >
      <body>{children}</body>
    </html>
  );
}
