import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";
export type ThemePref = Theme | "system";
export type FontSize = "md" | "lg";
export type Density = "comfortable" | "compact";

const THEME_KEY = "compart-theme";
const FONT_KEY = "compart-font";
const DENSITY_KEY = "compart-density";

function readStore(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function detectThemePref(): ThemePref {
  const stored = readStore(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "dark";
}

export function detectFont(): FontSize {
  const stored = readStore(FONT_KEY);
  if (stored === "lg") return "lg";
  return "md";
}

export function detectDensity(): Density {
  const stored = readStore(DENSITY_KEY);
  if (stored === "comfortable" || stored === "compact") return stored;
  return "comfortable";
}

function resolveTheme(pref: ThemePref): Theme {
  return pref === "system" ? systemTheme() : pref;
}

function themeColor(theme: Theme, sidebarChrome: boolean) {
  if (theme === "light") return sidebarChrome ? "#d8d8de" : "#c7c7cc";
  return "#1c1c1e";
}

function statusBarStyle(theme: Theme) {
  return theme === "light" ? "default" : "black-translucent";
}

function applyPrefs(pref: ThemePref, font: FontSize, density: Density) {
  const theme = resolveTheme(pref);
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-font", font);
  root.setAttribute("data-density", density);
  root.style.colorScheme = theme;
  root.style.fontSize = font === "lg" ? "18px" : "16px";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeColor(theme, root.classList.contains("sidebar-chrome")));
  const bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (bar) bar.setAttribute("content", statusBarStyle(theme));
}

export function setSidebarChrome(on: boolean) {
  const root = document.documentElement;
  root.classList.toggle("sidebar-chrome", on);
  const theme = (root.getAttribute("data-theme") as Theme) || "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeColor(theme, on));
}

type PrefsValue = {
  theme: Theme;
  themePref: ThemePref;
  setThemePref: (pref: ThemePref) => void;
  font: FontSize;
  setFont: (font: FontSize) => void;
  density: Density;
  setDensity: (density: Density) => void;
};

const PrefsContext = createContext<PrefsValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePref, setThemePrefState] = useState<ThemePref>(detectThemePref);
  const [font, setFontState] = useState<FontSize>(detectFont);
  const [density, setDensityState] = useState<Density>(detectDensity);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(detectThemePref()));

  const apply = useCallback((pref: ThemePref, nextFont: FontSize, nextDensity: Density) => {
    applyPrefs(pref, nextFont, nextDensity);
    setTheme(resolveTheme(pref));
  }, []);

  const setThemePref = useCallback(
    (pref: ThemePref) => {
      setThemePrefState(pref);
      writeStore(THEME_KEY, pref);
      apply(pref, font, density);
    },
    [apply, font, density],
  );

  const setFont = useCallback(
    (next: FontSize) => {
      setFontState(next);
      writeStore(FONT_KEY, next);
      apply(themePref, next, density);
    },
    [apply, themePref, density],
  );

  const setDensity = useCallback(
    (next: Density) => {
      setDensityState(next);
      writeStore(DENSITY_KEY, next);
      apply(themePref, font, next);
    },
    [apply, themePref, font],
  );

  useEffect(() => {
    apply(themePref, font, density);
    if (themePref !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply("system", font, density);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [apply, themePref, font, density]);

  const value = useMemo(
    () => ({ theme, themePref, setThemePref, font, setFont, density, setDensity }),
    [theme, themePref, setThemePref, font, setFont, density, setDensity],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export function ThemeSwitch() {
  const { theme, setThemePref } = useTheme();
  const toLight = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setThemePref(toLight ? "light" : "dark")}
      aria-label={toLight ? "Switch to light mode" : "Switch to dark mode"}
      className="btn-icon"
    >
      {toLight ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.05 5.05l1.42 1.42M17.53 17.53l1.42 1.42M5.05 18.95l1.42-1.42M17.53 6.47l1.42-1.42"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M13.4 3.4A9 9 0 1 0 13.4 20.6A6.8 6.8 0 0 1 13.4 3.4Z" />
        </svg>
      )}
    </button>
  );
}
