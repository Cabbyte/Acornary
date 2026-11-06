import { createContext, useContext, type ReactNode } from 'react';
import type { AppearancePreset, UIMode } from '../src/ui/theme/provider';
interface ReviewAppearance {
  preset: AppearancePreset;
  mode: UIMode;
  onPresetChange: (preset: AppearancePreset) => void;
  onModeChange: (mode: UIMode) => void;
}
const Context = createContext<ReviewAppearance | null>(null);
export const useReviewAppearance = () => useContext(Context);
export function ReviewAppearanceProvider({
  value,
  children,
}: {
  value: ReviewAppearance;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
