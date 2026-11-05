// AG Studio theme for PuffrPay. Every value points at a design token from
// globals.css so Studio renders as part of the page rather than a component
// embedded in it — change a token there and widgets, grids and charts follow.

import { studioTheme } from "ag-studio";

const token = (name: string) => `var(--${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });

// Palette order matches the statuses the stacked column chart lists
// alphabetically: BLOCKED, PURCHASED, REJECTED, WAITING, then extras.
const palette = Object.fromEntries(
  ["danger", "ok", "ink-soft", "gold", "tide", "warn", "gold-soft", "ink", "line", "ink-soft"].flatMap(
    (name, i) => [
      [`chartPaletteFills${i + 1}Color`, token(name)],
      [`chartPaletteStrokes${i + 1}Color`, token(name)],
    ]
  )
);

export const puffrStudioTheme = studioTheme.withParams({
  // Shared by Studio's UI, grids and charts.
  fontFamily: token("sans"),
  fontSize: 14,
  textColor: token("ink"),
  foregroundColor: token("ink"),
  subtleTextColor: token("ink-soft"),
  backgroundColor: token("card"),
  borderColor: token("line"),
  accentColor: token("tide"),
  iconColor: token("ink"),
  rowHoverColor: token("gold-soft"),

  // Studio defaults pin the root to 600px wide, which overflows small
  // viewports — let it shrink to whatever the fluid page gives it.
  studioMinWidth: 0,

  // No frame: the canvas is the page background. Widgets are inset inside their
  // grid cells, so padding puts widget edges on the card's gutter.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token("paper"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token("paper"),
  studioCanvasPadding: 20,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: token("sans"),

  // Widgets are the app's cards: white, 1px border, shared radius.
  studioWidgetBackgroundColor: token("card"),
  studioWidgetBorder: line("line"),
  studioWidgetBorderRadius: 10,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: token("sans"),
  studioWidgetTitleFontSize: 16,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token("ink"),
  studioWidgetSubtitleFontFamily: token("sans"),
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token("ink-soft"),
  studioWidgetCaptionFontFamily: token("sans"),
  studioWidgetCaptionFontSize: 13,
  studioWidgetCaptionTextColor: token("ink-soft"),
  studioWidgetResizeBorderColor: token("tide"),

  // Edit-mode panels.
  studioPanelContainerBackgroundColor: token("card"),
  studioPanelContainerBorder: line("line"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token("line"),
  studioPanelDividerActiveColor: token("tide"),
  studioPanelSectionBorderColor: token("line"),
  studioPanelHeaderFontFamily: token("sans"),
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: token("gold-soft"),
  studioPanelChevronButtonHoverColor: token("ink"),
  studioToggleButtonActiveBackgroundColor: token("gold-soft"),
  studioToggleButtonActiveBorderColor: token("ink"),
  studioToggleButtonActiveColor: token("ink"),

  // Grid widgets: mono caps headers, light dividers, rows tall enough that
  // the 24px status chips never clip.
  gridFontFamily: token("sans"),
  gridFontSize: 14,
  gridCellTextColor: token("ink"),
  gridHeaderBackgroundColor: token("card"),
  gridHeaderTextColor: token("ink-soft"),
  gridHeaderFontFamily: token("mono"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 12,
  gridRowHeight: 52,
  gridRowBorder: line("line"),
  gridHeaderRowBorder: line("line"),
  gridPinnedRowBorder: line("line"),
  gridRowHoverColor: token("gold-soft"),
  gridWrapperBorder: false,

  // Charts: dotted hairline gridlines, no 3D, labels from the theme fonts.
  chartFontFamily: token("sans"),
  chartTextColor: token("ink"),
  chartSubtleTextColor: token("ink-soft"),
  chartAxisLineColor: token("line"),
  chartGridLineColor: token("line"),
  ...palette,
});
