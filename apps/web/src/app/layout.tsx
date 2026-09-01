import type { Metadata } from "next";
import "./globals.css";
import { DM_Mono, Manrope } from "next/font/google";
import { siteContent } from "@/data/site";
import { cn } from "@/lib/utils";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
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
        manrope.variable,
        dmMono.variable
      )}
    >
      <body>{children}</body>
    </html>
  );
}
