import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { PrinterSession, printerPreferences } from './printer-session';
const key = 'acornary.printer.preferences.v1';
const Context = createContext<PrinterSession | null>(null);
export function PrinterProvider({ children, expired }: { children: ReactNode; expired: boolean }) {
  const [printer] = useState(() => {
    let preferences;
    try {
      preferences = JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      /* Storage is optional. */
    }
    return new PrinterSession(printerPreferences(preferences), (p) =>
      localStorage.setItem(key, JSON.stringify(p)),
    );
  });
  useEffect(() => () => printer.dispose(), [printer]);
  useEffect(() => {
    if (expired) printer.dispose();
  }, [expired, printer]);
  return <Context.Provider value={printer}>{children}</Context.Provider>;
}
export function usePrinter() {
  const printer = useContext(Context);
  if (!printer) throw new Error('PrinterProvider missing');
  const state = useSyncExternalStore(printer.subscribe, printer.getSnapshot);
  return { printer, ...state };
}
