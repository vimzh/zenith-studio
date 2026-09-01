import { navigationContent } from "@/data/navigation";

export const homeContent = {
  sidebar: {
    brand: navigationContent.brand,
    home: {
      href: "/home",
      label: "Home",
    },
    label: "Workspace navigation",
    profile: {
      accountLabel: "Account",
      signedInLabel: "Signed in",
      signedOutLabel: "Not signed in",
    },
  },
} as const;
