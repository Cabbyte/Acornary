import { createContext, useContext, useState, type ReactNode, type CSSProperties } from 'react';
import './vnext.css';
export type AppearancePreset = 'sage' | 'apricot' | 'berry' | 'terracotta';
export type UIMode = 'daily' | 'management';
const ThemeContext = createContext<{
  preset: AppearancePreset;
  mode: UIMode;
  portalContainer: HTMLElement | null;
}>({ preset: 'sage', mode: 'daily', portalContainer: null });
export const useAcornaryTheme = () => useContext(ThemeContext);
export function AcornaryThemeProvider({
  preset,
  mode,
  children,
  className = '',
  style,
}: {
  preset: AppearancePreset;
  mode: UIMode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  return (
    <ThemeContext.Provider value={{ preset, mode, portalContainer }}>
      <div
        data-acornary-ui="vnext"
        data-acornary-preset={preset}
        data-acornary-mode={mode}
        className={`vn-root ${className}`}
        style={style}
      >
        {children}
        <div ref={setPortalContainer} className="vn-portal-root" />
      </div>
    </ThemeContext.Provider>
  );
}
