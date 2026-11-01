import type { IconName } from './names.js';
import {
  Activity,
  Apple,
  ArrowUpDown,
  ChevronRight,
  CircleAlert,
  CupSoda,
  FileText,
  Library,
  ListFilter,
  MapPin,
  Milk,
  Minus,
  MoreHorizontal,
  Package,
  PawPrint,
  Pill,
  Plug,
  Plus,
  Search,
  Settings,
  Shirt,
  Soup,
  SprayCan,
  Wrench,
  X,
  CalendarClock,
  Archive,
  type LucideIcon,
} from 'lucide-react';

export type { IconName } from './names.js';

const ICONS: Record<IconName, LucideIcon> = {
  archive: Archive,
  activity: Activity,
  apple: Apple,
  'arrow-up-down': ArrowUpDown,
  'chevron-right': ChevronRight,
  'circle-alert': CircleAlert,
  cup: CupSoda,
  file: FileText,
  library: Library,
  filter: ListFilter,
  'map-pin': MapPin,
  milk: Milk,
  minus: Minus,
  more: MoreHorizontal,
  package: Package,
  paw: PawPrint,
  pill: Pill,
  plug: Plug,
  plus: Plus,
  search: Search,
  settings: Settings,
  shirt: Shirt,
  soup: Soup,
  spray: SprayCan,
  wrench: Wrench,
  x: X,
  'calendar-clock': CalendarClock,
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.5,
  className,
  label,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  label?: string;
}) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      className={className}
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}
