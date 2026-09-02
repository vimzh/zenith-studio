import { navigationContent } from "@/data/navigation";

export const homeContent = {
  sidebar: {
    brand: navigationContent.brand,
    label: "Workspace navigation",
    links: [
      { href: "/home", icon: "grid", label: "Home" },
      { href: "/settings", icon: "settings", label: "Settings" },
    ],
    profile: {
      signedInLabel: "Signed in",
    },
  },
} as const;

export const settingsContent = {
  title: "Settings",
  description: "Preferences for this workspace.",
  appearance: {
    title: "Appearance",
    description:
      "Zenith Studio defaults to dark — it is how most pixel artists work, and a neutral ground keeps colour judgement accurate.",
    label: "Theme",
    options: [
      { icon: "sun", label: "Light", value: "light" },
      { icon: "moon", label: "Dark", value: "dark" },
      { icon: "monitor", label: "System", value: "system" },
    ],
  },
} as const;
