import { Moon, Monitor, Sparkles, Sun, Trees } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";

const iconMap = {
  Sun,
  Monitor,
  Moon,
  Trees,
  Sparkles
};

function ThemeSwitcher({ className = "" }) {
  const { theme, themes, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const activeTheme = themes.find((item) => item.id === theme) || themes[0];
  const ActiveIcon = iconMap[activeTheme.icon] || Monitor;

  useEffect(() => {
    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className={`theme-switcher ${className}`.trim()} ref={containerRef}>
      <button
        className={`theme-trigger ${isOpen ? "open" : ""}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
      >
        <ActiveIcon size={18} />
        <div className="theme-trigger-copy">
          <span>Theme</span>
          <strong>{activeTheme.label}</strong>
        </div>
      </button>

      {isOpen ? (
        <div className="theme-menu" role="menu" aria-label="Choose a theme">
          {themes.map((item) => {
            const Icon = iconMap[item.icon] || Monitor;

            return (
              <button
                key={item.id}
                className={`theme-option ${item.id === theme ? "active" : ""}`}
                type="button"
                role="menuitemradio"
                aria-checked={item.id === theme}
                onClick={() => {
                  setTheme(item.id);
                  setIsOpen(false);
                }}
              >
                <div className="theme-option-icon">
                  <Icon size={17} />
                </div>
                <div className="theme-option-copy">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default ThemeSwitcher;
