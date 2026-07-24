import type { CSSProperties } from "react";

/** CSS custom properties are not part of React's CSSProperties surface. */
export function accentStyle(color: string): CSSProperties {
  return { "--accent": color } as unknown as CSSProperties;
}
