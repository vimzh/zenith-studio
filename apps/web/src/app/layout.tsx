import type { Metadata } from "next";
import "./globals.css";
import { DM_Mono, DM_Sans } from "next/font/google";
import { siteContent } from "@/data/site";
import { cn } from "@/lib/utils";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
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
      className={cn("font-sans", dmSans.variable, dmMono.variable)}
    >
      <body>{children}</body>
    </html>
  );
}
