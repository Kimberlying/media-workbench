import type { ThemeId } from "@/lib/xhs/schema";

// 四套卡片风格，取自 build-xhs-content-pack 的 assets/themes.json，改动时两边保持一致。

export interface CardTheme {
  background: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  soft: string;
  accents: Record<"coral" | "green" | "blue" | "gold", string>;
  visual: {
    chrome: "band" | "product" | "data";
    pattern: "none" | "grid";
    radius: number;
    outline_width: number;
    marker: "circle" | "dash" | "index";
    title_rule: "short" | "full" | "none";
    footer_rule: boolean;
    margin_scale: number;
    title_scale: number;
  };
}

export const CARD_THEMES: Record<ThemeId, CardTheme> = {
  editorial: {
    background: "#F4F1E8",
    surface: "#FFFEFA",
    ink: "#171A19",
    muted: "#5E6561",
    line: "#D7D6CE",
    soft: "#EEEDE6",
    accents: {
      coral: "#D95745",
      green: "#23745B",
      blue: "#2D64A3",
      gold: "#B77A1F",
    },
    visual: {
      chrome: "band",
      pattern: "none",
      radius: 22,
      outline_width: 1,
      marker: "circle",
      title_rule: "short",
      footer_rule: true,
      margin_scale: 1,
      title_scale: 1,
    },
  },
  "reading-card": {
    background: "#F3EFE5",
    surface: "#FFFCF5",
    ink: "#20231F",
    muted: "#66685F",
    line: "#D8D1C3",
    soft: "#EAE3D7",
    accents: {
      coral: "#A94E46",
      green: "#3E6B58",
      blue: "#506A86",
      gold: "#B28745",
    },
    visual: {
      chrome: "band",
      pattern: "none",
      radius: 14,
      outline_width: 1,
      marker: "dash",
      title_rule: "short",
      footer_rule: true,
      margin_scale: 1.02,
      title_scale: 1,
    },
  },
  "tech-tutorial": {
    background: "#F5F5F7",
    surface: "#FFFFFF",
    ink: "#1D1D1F",
    muted: "#6E6E73",
    line: "#D2D2D7",
    soft: "#E8E8ED",
    accents: {
      coral: "#FF3B30",
      green: "#248A3D",
      blue: "#0071E3",
      gold: "#A66A00",
    },
    visual: {
      chrome: "product",
      pattern: "none",
      radius: 26,
      outline_width: 1,
      marker: "circle",
      title_rule: "none",
      footer_rule: false,
      margin_scale: 1.04,
      title_scale: 1.08,
    },
  },
  business: {
    background: "#F1F2EE",
    surface: "#FFFFFF",
    ink: "#111417",
    muted: "#596066",
    line: "#C9CDD0",
    soft: "#E7E9E7",
    accents: {
      coral: "#F26C21",
      green: "#237A57",
      blue: "#315D85",
      gold: "#B98727",
    },
    visual: {
      chrome: "data",
      pattern: "grid",
      radius: 5,
      outline_width: 1,
      marker: "index",
      title_rule: "full",
      footer_rule: true,
      margin_scale: 0.98,
      title_scale: 1,
    },
  },
};
