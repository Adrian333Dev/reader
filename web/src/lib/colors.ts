// Group and tab colours, used now only by the archived sidebars in archive/. A colour gives only its hue: index.css
// draws it at a fixed lightness (.group-dot), so any colour keeps the same contrast in both themes.
export const colorStyle = (color: string) => ({ "--group": color }) as React.CSSProperties
