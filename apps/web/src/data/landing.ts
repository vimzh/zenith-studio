export const landingContent = {
  hero: {
    title: "Turn ideas into game‑ready pixel assets.",
    description:
      "Zenith Studio is a pixel-art workspace where you and an AI agent edit the same canvas, live. Every tool you have, it has — through WebMCP.",
  },
  prompt: {
    placeholder: "Describe the sprite, tile, or icon you want to create…",
    /**
     * The type is chosen before generating, not guessed from the wording.
     *
     * It decides which tools the asset gets afterwards — a character unlocks
     * directions and skeletons, a tile unlocks autotiling — so generating
     * everything as a tile quietly puts the whole character workflow out of
     * reach of the thing you just made.
     */
    typeLabel: "Make a",
    types: [
      { id: "tile", label: "tile" },
      { id: "character", label: "character" },
      { id: "item", label: "item" },
      { id: "texture", label: "texture" },
      { id: "ui", label: "UI element" },
    ],
  },
  features: {
    title: "Real pixels. Shared tools. Consistent results.",
    description:
      "Create on a constrained grid where every pixel stays sharp, every colour belongs to the palette, and every edit remains under your control.",
    items: [
      {
        image: "/images/features/pixel-phoenix.gif",
        title: "Pixel-exact by design",
        description:
          "Build sprites, tiles, and icons on an indexed grid with hard edges and a deliberate palette.",
      },
      {
        image: "/images/features/character-run.gif",
        title: "One canvas, two creators",
        description:
          "Draw by hand or let your agent work beside you using the same live document and editing tools.",
      },
      {
        image: "/images/features/pixel-fire.gif",
        title: "Assets that stay coherent",
        description:
          "Create related frames from the same grid and palette instead of generating disconnected images.",
      },
    ],
  },
  power: {
    title: "What makes it powerful.",
    description:
      "Generation is only the start. Zenith gives every asset a shared grid, palette, history, and set of tools so you can keep refining instead of starting over.",
    items: [
      {
        image: "/images/power/shared-canvas.png",
        title: "Create on the same canvas",
        description:
          "You and your agent edit one live document with the same tools and undo history.",
      },
      {
        image: "/images/power/indexed-palette.png",
        title: "Control every colour",
        description:
          "Indexed palettes keep related assets sharp, readable, and visually consistent.",
      },
      {
        image: "/images/power/consistent-directions.png",
        title: "Keep characters coherent",
        description:
          "Build directions and variants from the same proportions, grid, and palette.",
      },
      {
        image: "/images/power/seamless-worlds.png",
        title: "Build seamless worlds",
        description:
          "Create tiles that connect cleanly and verify the seams before they reach your game.",
      },
      {
        image: "/images/power/coherent-animation.png",
        title: "Animate without drift",
        description:
          "Keep motion readable across frames without redesigning the character each time.",
      },
      {
        image: "/images/power/game-ready-pack.png",
        title: "Ship a complete set",
        description:
          "Export cohesive sprites, tiles, items, and UI assets ready for your engine.",
      },
    ],
  },
  showcase: {
    title: "Watch your asset set come alive.",
    description:
      "One shared canvas turns a prompt into a complete, checked, game-ready set while every frame stays visible and editable.",
    panelTitle: "Live asset forge",
    steps: [
      "Palette locked",
      "Frames aligned",
      "Tile seams verified",
      "Export bundle prepared",
    ],
    status: "All systems ready",
  },
  gallery: {
    title: "Five characters. Fifteen moves. Zero retouching.",
    description:
      "Each character below was generated from one prompt. Every animation was planned from the sprite itself, drawn as a single sprite sheet beside it so scale and ground line hold, pixelised into the character's own sixteen colours, and checked by a vision judge. These are the files the pipeline wrote.",
    footnote:
      "Loops play at half speed with a rest on the idle pose, the way a shared GIF should. In a game each move plays once at full speed and returns to idle.",
    characters: [
      {
        slug: "knight",
        name: "Knight",
        description: "Blue plate, red plume, longsword and kite shield.",
        portrait: "/images/showcase/knight.png",
        animations: [
          { slug: "slash", title: "Overhead slash", effect: "White air-cut arc along the blade's path", gif: "/images/showcase/knight-slash.gif" },
          { slug: "shield-bash", title: "Shield bash", effect: "Impact burst where the shield strikes", gif: "/images/showcase/knight-shield-bash.gif" },
          { slug: "victory", title: "Victory pose", effect: "Golden sparkles around the raised blade", gif: "/images/showcase/knight-victory.gif" },
        ],
      },
      {
        slug: "mage",
        name: "Fire mage",
        description: "Crimson hooded robe and a staff topped with an ember crystal.",
        portrait: "/images/showcase/mage.png",
        animations: [
          { slug: "fireball", title: "Fireball", effect: "Flame trail leaving the staff tip", gif: "/images/showcase/mage-fireball.gif" },
          { slug: "eruption", title: "Ground eruption", effect: "Flames bursting up from the ground", gif: "/images/showcase/mage-eruption.gif" },
          { slug: "flame-ring", title: "Flame ring", effect: "A ring of fire tracing the staff's circle", gif: "/images/showcase/mage-flame-ring.gif" },
        ],
      },
      {
        slug: "ninja",
        name: "Ninja",
        description: "Black shinobi outfit, red sash and a katana held low.",
        portrait: "/images/showcase/ninja.png",
        animations: [
          { slug: "dash-slash", title: "Dash slash", effect: "Blue speed lines and a white blade arc", gif: "/images/showcase/ninja-dash-slash.gif" },
          { slug: "shuriken", title: "Shuriken fan", effect: "Three spinning shuriken with silver trails", gif: "/images/showcase/ninja-shuriken.gif" },
          { slug: "backflip", title: "Backflip", effect: "Dust puffs on take-off and landing", gif: "/images/showcase/ninja-backflip.gif" },
        ],
      },
      {
        slug: "archer",
        name: "Elf archer",
        description: "Green hooded cloak, leather armour and a tall recurve bow.",
        portrait: "/images/showcase/archer.png",
        animations: [
          { slug: "loose", title: "Draw and loose", effect: "A streaking arrow with a green magic trail", gif: "/images/showcase/archer-loose.gif" },
          { slug: "roll", title: "Dodge roll", effect: "A dust cloud along the roll", gif: "/images/showcase/archer-roll.gif" },
          { slug: "rain", title: "Arrow rain", effect: "Three glowing arrows fanning downward", gif: "/images/showcase/archer-rain.gif" },
        ],
      },
      {
        slug: "dragon",
        name: "Dragon whelp",
        description: "Small green dragon with an orange belly, bat wings and a long tail.",
        portrait: "/images/showcase/dragon.png",
        animations: [
          { slug: "fire-breath", title: "Fire breath", effect: "A cone of fire from the mouth", gif: "/images/showcase/dragon-fire-breath.gif" },
          { slug: "takeoff", title: "Take-off", effect: "Dust swirls under the beating wings", gif: "/images/showcase/dragon-takeoff.gif" },
          { slug: "tail-whip", title: "Tail whip", effect: "A purple energy arc following the tail", gif: "/images/showcase/dragon-tail-whip.gif" },
        ],
      },
    ],
  },
  footer: {
    quest: "New quest unlocked",
    title: "Build the asset your game is missing.",
    description:
      "Start with a prompt, refine every pixel together, and leave with a cohesive asset ready for your game.",
    rewards: ["Game-ready output", "Co-op with your agent"],
    tagline:
      "A shared pixel-art studio for sprites, tiles, animation, and everything between.",
    links: [
      { href: "#features", label: "Features" },
      { href: "/home", label: "Open the studio" },
      {
        href: "https://github.com/vanshgaur/zenith-studio",
        label: "GitHub",
      },
    ],
  },
} as const;
