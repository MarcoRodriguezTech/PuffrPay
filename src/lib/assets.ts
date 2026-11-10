// Every app-owned image path lives here. Swap a file in /public and the whole
// app follows. Optional assets (owner avatar, the 1024px mascot PNG, empty-state
// art) may not exist yet — components that use them must render the documented
// fallback instead of failing (see AssetImg and the initials avatar in TopBar).

export const ASSETS = {
  mascot: "/mascot/puffr-v2.png", // transparent PNG, the default puffed art
  logoMark: "/brand/logo-mark-dark.svg", // lavender-glow fish — dark theme default
  logoMarkLight: "/brand/logo-mark-light.svg", // indigo fish — light theme
  wordmarkLight: "/brand/wordmark-light.svg",
  wordmarkDark: "/brand/wordmark-dark.svg",
  icon192: "/icons/icon-192.png",
  icon512: "/icons/icon-512.png",
  iconMaskable512: "/icons/icon-maskable-512.png",
  appleTouchIcon: "/icons/apple-touch-icon.png", // 180x180
  // Owner avatar — diver art, shown in the topbar chip; initials render if
  // the file ever 404s. The -light variant swaps the navy backdrop for a
  // pale tint so the chip reads on the light theme.
  ownerAvatar: "/avatar/owner.png",
  ownerAvatarLight: "/avatar/owner-light.png",
  productPlaceholder: "/placeholders/product.svg",
  og: "/og.png", // 1200x630
  emptyAgent: "/empty/agent.svg",
  emptyActivity: "/empty/activity.svg",
} as const;
