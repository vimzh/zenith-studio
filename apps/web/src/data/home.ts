import { navigationContent } from "@/data/navigation";

export const homeContent = {
  sidebar: {
    brand: navigationContent.brand,
    home: {
      href: "/home",
      label: "Home",
    },
    label: "Workspace navigation",
    toggleLabel: "Toggle sidebar",
  },
  title: "Home",
} as const;
