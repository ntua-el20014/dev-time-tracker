// Color utility functions for determining optimal text colors based on background

/**
 * Convert hex color to RGB values
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

/**
 * Calculate the relative luminance of a color according to WCAG guidelines
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate the contrast ratio between two colors
 */
function getContrastRatio(
  color1: { r: number; g: number; b: number },
  color2: { r: number; g: number; b: number }
): number {
  const lum1 = getLuminance(color1.r, color1.g, color1.b);
  const lum2 = getLuminance(color2.r, color2.g, color2.b);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

/**
 * Get optimal text color (black or white) for a given background color using WCAG contrast calculation
 * @param backgroundColor - Hex color string (e.g., "#f0db4f")
 * @returns "#000000" for dark text or "#ffffff" for light text
 */
export function getOptimalTextColor(backgroundColor: string): string {
  const bgColor = hexToRgb(backgroundColor);
  if (!bgColor) return "#000000"; // Default to black if color parsing fails

  const whiteContrast = getContrastRatio(bgColor, { r: 255, g: 255, b: 255 });
  const blackContrast = getContrastRatio(bgColor, { r: 0, g: 0, b: 0 });

  // Return the color with better contrast (WCAG AA standard requires 4.5:1 for normal text)
  return whiteContrast > blackContrast ? "#ffffff" : "#000000";
}

/**
 * Simpler alternative using perceived brightness calculation
 * @param backgroundColor - Hex color string (e.g., "#f0db4f")
 * @returns "#000000" for dark text or "#ffffff" for light text
 */
export function getTextColorSimple(backgroundColor: string): string {
  const color = hexToRgb(backgroundColor);
  if (!color) return "#000000";

  // Calculate perceived brightness using the luminance formula
  const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
  return brightness > 128 ? "#000000" : "#ffffff";
}

/**
 * Update CSS custom properties for text colors based on the current accent color
 * This function should be called whenever the accent color changes
 */
export async function updateAccentTextColors(): Promise<void> {
  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();

  if (accentColor && accentColor !== "") {
    const textColor = getOptimalTextColor(accentColor);

    // Set CSS custom property for text on accent background
    document.documentElement.style.setProperty("--accent-text", textColor);

    // Also set a contrasting border color for better definition
    const borderColor =
      textColor === "#ffffff"
        ? "rgba(255, 255, 255, 0.2)"
        : "rgba(0, 0, 0, 0.2)";
    document.documentElement.style.setProperty("--accent-border", borderColor);
  }
}
