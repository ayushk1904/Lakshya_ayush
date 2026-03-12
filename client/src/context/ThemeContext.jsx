import { createContext, useContext, useEffect, useMemo, useState } from "react";

const THEME_STORAGE_KEY = "lakshya_theme";

const themes = [
  { id: "sunrise", label: "Sunrise", icon: "Sun", description: "Warm light workspace" },
  { id: "light", label: "Light", icon: "Monitor", description: "Clean neutral mode" },
  { id: "dark", label: "Dark", icon: "Moon", description: "Low-glare dark mode" },
  { id: "forest", label: "Forest", icon: "Trees", description: "Calm green study tone" },
  { id: "midnight", label: "Midnight", icon: "Sparkles", description: "Deep blue night mode" }
];

const ThemeContext = createContext(null);

function getInitialTheme() {
  if (typeof window === "undefined") {
    return themes[0].id;
  }

  return localStorage.getItem(THEME_STORAGE_KEY) || themes[0].id;
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      themes,
      setTheme
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}
