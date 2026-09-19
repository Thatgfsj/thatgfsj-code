/**
 * opencode-inspired TUI theme.
 *
 * v3.0.6 redesign language (modeled on opencode's TUI):
 *   - flat and quiet: no heavy boxes around conversation content
 *   - one warm accent color for marks/bullets (⏺ ❯ ◆ ⎿), everything
 *     else is grayscale so code and diffs carry the color
 *   - thin single rules instead of dashed banners
 *   - rounded borders only where a box is semantically needed
 *     (input field, permission dialog)
 *
 * Semantic tokens (not raw colors) so a theme system can be layered on
 * later without touching components.
 */

export const theme = {
  /** Brand + interaction accent: warm orange. */
  accent: '#FF8C42',
  accentDim: '#C2570B',

  /** Grayscale ramp. */
  text: '#D4D4D8',
  textDim: '#8B8B93',
  textFaint: '#52525B',
  border: '#3F3F46',

  /** Semantic states. */
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#22D3EE',

  /** Marks. */
  userMark: '#A1A1AA',
  assistantMark: '#FF8C42',
  toolMark: '#8B8B93',
} as const;
