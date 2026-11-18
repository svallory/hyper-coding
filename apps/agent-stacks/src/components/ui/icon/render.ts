// Helpers for drawing a Lucide icon from the generated map in __lucide__.ts.
import { lucideIcons } from "./__lucide__.ts";

/** The square a name with no entry in the map falls back to. It must never render. */
export const FALLBACK_INNER = '<rect width="18" height="18" x="3" y="3" rx="2"/>';

/** The `<svg>` attributes Lucide icons share. */
export const LUCIDE_WRAPPER = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
} as const;

// The map mixes "Icon"-suffixed and bare names, so try the exact key, then the
// suffix-toggled form, before the placeholder.
export function lucideInner(name: string): string {
  const toggled = name.endsWith("Icon") ? name.slice(0, -"Icon".length) : `${name}Icon`;
  return lucideIcons[name] ?? lucideIcons[toggled] ?? FALLBACK_INNER;
}
