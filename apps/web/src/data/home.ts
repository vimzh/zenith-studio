import { navigationContent } from "@/data/navigation";

const primaryActionLabel = "Try now";

export const homeContent = {
  features: {
    cards: [
      {
        description:
          "Explain the one thing someone should remember after seeing the project.",
        imageLabel: "Primary feature image",
        imageRatio: { height: 5, width: 4 },
        label: "01",
        title: "Primary feature",
      },
      {
        description:
          "Describe the workflow that makes the main experience faster, clearer, or easier.",
        imageLabel: "Supporting feature image",
        imageRatio: { height: 9, width: 16 },
        label: "02",
        title: "Supporting feature",
      },
      {
        description:
          "Use this space for the technical detail, result, or differentiator worth showing.",
        imageLabel: "Technical detail image",
        imageRatio: { height: 9, width: 16 },
        label: "03",
        title: "Technical detail",
      },
    ],
    heading: "Features",
  },
  finalCta: {
    description:
      "Start with the foundation in place and spend the hackathon on the product.",
    heading: "Build the part that matters.",
    primaryLabel: primaryActionLabel,
  },
  footer: {
    brand: navigationContent.brand.title,
    links: navigationContent.links,
    navigationLabel: "Footer navigation",
    note: "Built for hackathons.",
  },
  hackathonBanner: {
    dismissLabel: "Dismiss hackathon banner",
    link: {
      href: "https://example.com",
      label: "this hackathon",
    },
    prefix: "Built for",
  },
  howItWorks: {
    description:
      "Move from a blank starter to a working demo without rebuilding the foundation.",
    heading: "How it works",
    steps: [
      {
        description:
          "Replace the placeholder content, add the environment values, and define the product you are building.",
        label: "01",
        title: "Set the direction",
      },
      {
        description:
          "Build the project-specific interface and Hono routes while the shared setup stays out of the way.",
        label: "02",
        title: "Make the product",
      },
      {
        description:
          "Run the checks, connect the real services, and present a working demo instead of setup work.",
        label: "03",
        title: "Ship the demo",
      },
    ],
  },
  hero: {
    actions: {
      primaryLabel: primaryActionLabel,
      secondaryLink: {
        href: "#how-it-works",
        label: "See how it works",
      },
    },
    heading: "Start with\nthe product.",
    subheading:
      "Next.js, Hono, Google OAuth, shadcn, and SQLite—ready to adapt for the next hackathon.",
  },
  techStack: {
    description: "Practical defaults that are already connected and ready to change.",
    heading: "Tech stack",
    items: [
      { description: "Frontend and routing", name: "Next.js" },
      { description: "Typed API layer", name: "Hono" },
      { description: "Runtime and tooling", name: "Bun" },
      { description: "Prototype persistence", name: "SQLite" },
      { description: "Authentication", name: "Google OAuth" },
      { description: "Interface primitives", name: "shadcn/ui" },
    ],
  },
  useCases: {
    description:
      "Use the starter wherever the product needs a real frontend, API, authentication, and lightweight persistence.",
    heading: "Use cases",
    items: [
      {
        context: "For early validation",
        description:
          "Turn the core idea into a working product flow before spending time on infrastructure.",
        title: "Launch a working prototype",
      },
      {
        context: "For signed-in products",
        description:
          "Start with Google OAuth already wired and focus on the experience users reach after login.",
        title: "Build an authenticated app",
      },
      {
        context: "For backend-heavy ideas",
        description:
          "Connect a Next.js interface to typed Hono routes and persist prototype data in SQLite.",
        title: "Test the workflow end to end",
      },
    ],
  },
} as const;
