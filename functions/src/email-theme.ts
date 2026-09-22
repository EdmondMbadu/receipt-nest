// Adds dark-mode rules to our own inline-styled transactional email templates.
// Inline light-mode styles remain the fallback for clients that ignore this media query.
const darkBackground = (value: string): string | null => {
  const color = value.trim().toLowerCase();
  if (color.includes("gradient(")) return "#10251f";
  const colors: Record<string, string> = {
    "#ffffff": "#172435",
    "#f8fafc": "#111c2b",
    "#f8f9ff": "#0b1422",
    "#eef4ff": "#1b2a3d",
    "#dbe9ff": "#30445c",
    "#ecfdf5": "#17362f",
    "#d6fae8": "#214a3d",
    "#fff7ed": "#38291c",
    "#fff4f3": "#382129",
    "#000000": "#111827",
    "#0f172a": "#101827",
    "#0d1c2d": "#101c2a",
    "#064e3b": "#064e3b",
    "#065f46": "#065f46",
    "#006c49": "#066748",
    "#059669": "#047857",
  };
  return colors[color] ?? null;
};

const darkText = (value: string): string | null => {
  const colors: Record<string, string> = {
    "#ffffff": "#f8fafc",
    "#f8fafc": "#f8fafc",
    "#e2e8f0": "#e2e8f0",
    "#cbd5e1": "#cbd5e1",
    "#d1fae5": "#d1fae5",
    "#a7f3d0": "#a7f3d0",
    "#6ffbbe": "#6ffbbe",
    "#a8b6c8": "#cbd5e1",
    "#0d1c2d": "#f1f5f9",
    "#0f172a": "#f1f5f9",
    "#243244": "#e2e8f0",
    "#5b6471": "#cbd5e1",
    "#64748b": "#cbd5e1",
    "#475569": "#cbd5e1",
    "#94a3b8": "#cbd5e1",
    "#064e3b": "#86efac",
    "#065f46": "#86efac",
    "#006c49": "#86efac",
    "#047857": "#86efac",
    "#9a3412": "#fdba74",
    "#9f1239": "#fda4af",
  };
  return colors[value.trim().toLowerCase()] ?? null;
};

const darkDeclarations = (style: string): string[] => {
  const declarations: string[] = [];
  for (const part of style.split(";")) {
    const separator = part.indexOf(":");
    if (separator < 0) continue;
    const property = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (property === "background" || property === "background-color") {
      const mapped = darkBackground(value);
      if (mapped) declarations.push(`${property}:${mapped} !important`);
    } else if (property === "color") {
      const mapped = darkText(value);
      if (mapped) declarations.push(`color:${mapped} !important`);
    } else if (/^border(?:-(?:top|right|bottom|left))?$/.test(property)) {
      const borderColor = value.match(/#[0-9a-f]{6}\b/i)?.[0];
      if (borderColor && !["#064e3b", "#006c49", "#059669"].includes(borderColor.toLowerCase())) {
        declarations.push(`${property}:${value.replace(borderColor, "#334155")} !important`);
      }
    }
  }
  return declarations;
};

export const addEmailDarkMode = (html: string): string => {
  if (!/<\/head>/i.test(html)) return html;

  const rules = new Map<string, string>();
  let nextId = 0;
  const themedHtml = html.replace(/<[a-z][^>]*>/gi, (tag) => {
    const style = tag.match(/\bstyle="([^"]*)"/i)?.[1];
    if (!style) return tag;
    const declarations = darkDeclarations(style).join(";");
    if (!declarations) return tag;

    let className = rules.get(declarations);
    if (!className) {
      className = `rn-dark-${++nextId}`;
      rules.set(declarations, className);
    }
    return /\bclass="[^"]*"/i.test(tag)
      ? tag.replace(/\bclass="([^"]*)"/i, (_match, names: string) => `class="${names} ${className}"`)
      : tag.replace(/\bstyle=/i, `class="${className}" style=`);
  });

  if (rules.size === 0) return html;
  const css = [...rules].map(([declarations, className]) => `.${className}{${declarations}}`).join("\n");
  const head = `
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <style>@media (prefers-color-scheme: dark) {\n${css}\n}</style>
  `;
  return themedHtml.replace(/<\/head>/i, `${head}</head>`);
};
