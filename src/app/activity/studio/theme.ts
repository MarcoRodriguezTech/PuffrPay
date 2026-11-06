// AG Studio themes for PuffrPay — one per app mode. Every value points at a
// design token from globals.css, so widgets, grids and charts follow the app
// theme; the two variants exist so we can pin mode-specific surface colors
// (chart fills, hover states) where CSS vars alone can't reach. Font family is
// set explicitly everywhere — Studio's default is a serif stack.

import { studioTheme } from "ag-studio";
import type { AppTheme } from "@/lib/theme";

const token = (name: string) => `var(--${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });

// Explicit stack — never let Studio fall back to its serif default.
const SANS = "'Plus Jakarta Sans', system-ui, 'Segoe UI', Arial, sans-serif";

// Palette order matches the statuses the charts list alphabetically:
// BLOCKED, PURCHASED, REJECTED, WAITING, then extras.
const palette = Object.fromEntries(
  ["danger", "ok", "reject", "warn", "tide", "deep", "chart-7", "ink", "line", "ink-soft"].flatMap(
    (name, i) => [
      [`chartPaletteFills${i + 1}Color`, token(name)],
      [`chartPaletteStrokes${i + 1}Color`, token(name)],
    ]
  )
);

export function studioThemeFor(mode: AppTheme) {
  return studioTheme.withParams({
    // Shared by Studio's UI, grids and charts.
    fontFamily: SANS,
    fontSize: 14,
    textColor: token("ink"),
    foregroundColor: token("ink"),
    subtleTextColor: token("ink-soft"),
    backgroundColor: token("card"),
    borderColor: token("line"),
    accentColor: token("tide"),
    iconColor: token("ink"),
    rowHoverColor: token("ocean-soft"),

    // Studio defaults pin the root to 600px wide, which overflows small
    // viewports — let it shrink to whatever the fluid page gives it.
    studioMinWidth: 0,

    // No frame: the canvas is the page background. Widgets are inset inside
    // their grid cells, so padding puts widget edges on the card's gutter.
    studioWrapperBorder: false,
    studioWrapperBorderRadius: 0,
    studioWrapperSpacing: 0,
    studioWrapperBackgroundColor: "transparent",
    studioCanvasBorder: false,
    studioCanvasBorderRadius: 0,
    studioCanvasShadow: false,
    // Transparent — the report floats on the page background, no dark slab
    // behind the widgets.
    studioCanvasBackgroundColor: "transparent",
    // Snug outer inset — the report starts close under the toolbar and widget
    // edges sit near the page's own padding.
    studioCanvasPadding: 8,
    studioCanvasRowHeight: 16,
    studioCanvasFontFamily: SANS,

    // Widgets are the app's cards. The rounded 22px shape + gradient come from
    // the .ag-studio-widget override in globals.css (theme params are colors,
    // not gradients) — these are the sensible flat fallbacks.
    studioWidgetBackgroundColor: mode === "dark" ? "#0a1626" : "#ffffff",
    studioWidgetBorder: line("line"),
    studioWidgetBorderRadius: 22,
    studioWidgetPadding: 0,
    studioWidgetTitleFontFamily: SANS,
    studioWidgetTitleFontSize: 15,
    studioWidgetTitleFontWeight: 600,
    studioWidgetTitleTextColor: token("ink-soft"),
    studioWidgetSubtitleFontFamily: SANS,
    studioWidgetSubtitleFontSize: 13,
    studioWidgetSubtitleTextColor: token("ink-soft"),
    studioWidgetCaptionFontFamily: SANS,
    studioWidgetCaptionFontSize: 13,
    studioWidgetCaptionTextColor: token("ink-soft"),
    studioWidgetResizeBorderColor: token("tide"),

    // Edit-mode panels.
    studioPanelContainerBackgroundColor: token("card"),
    studioPanelContainerBorder: line("line"),
    studioPanelContainerBorderRadius: 22,
    studioPanelDividerColor: token("line"),
    studioPanelDividerActiveColor: token("tide"),
    studioPanelSectionBorderColor: token("line"),
    studioPanelHeaderFontFamily: SANS,
    studioPanelHeaderFontWeight: 600,
    studioPanelChevronButtonHoverBackgroundColor: token("ocean-soft"),
    studioPanelChevronButtonHoverColor: token("ink"),
    studioToggleButtonActiveBackgroundColor: token("ocean-soft"),
    studioToggleButtonActiveBorderColor: token("tide"),
    studioToggleButtonActiveColor: token("ink"),

    // Grid widgets: small-caps muted headers, compact 42px rows; the
    // blocked-row coral bar is a cell renderer.
    gridFontFamily: SANS,
    gridFontSize: 14,
    gridCellTextColor: token("ink"),
    gridHeaderBackgroundColor: token("card"),
    gridHeaderTextColor: token("ink-soft"),
    gridHeaderFontFamily: SANS,
    gridHeaderFontWeight: 700,
    gridHeaderFontSize: 11,
    gridRowHeight: 42,
    gridRowBorder: line("line"),
    gridHeaderRowBorder: line("line"),
    gridPinnedRowBorder: line("line"),
    gridRowHoverColor: token("ocean-soft"),
    gridWrapperBorder: false,

    // Charts: dotted hairline gridlines, no axis lines, labels from the theme.
    chartFontFamily: SANS,
    chartTextColor: token("ink"),
    chartSubtleTextColor: token("ink-soft"),
    chartAxisLineColor: "transparent",
    chartGridLineColor: token("line"),
    ...palette,
  });
}
