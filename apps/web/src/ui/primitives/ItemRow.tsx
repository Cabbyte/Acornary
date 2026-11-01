import type { ReactNode } from 'react';
import { FactChip } from './FactChip.js';
import { StatusTag, type Tone } from './StatusTag.js';
import styles from './ItemRow.module.css';

const MAX_FACTS = 3;

export interface ItemRowStatus {
  tone: Tone;
  label: string;
}

export interface ItemRowProps {
  title: string;
  /** 40x40 thumbnail slot; pass an <img alt="">, a category mark, or a line icon. */
  thumbnail?: ReactNode;
  /** Scannable facts; only the first three are rendered. */
  facts?: readonly ReactNode[];
  /** Human-readable location path. Never a raw id/UUID. */
  location?: string;
  status?: ItemRowStatus;
  /** Overflow menu trigger slot, e.g. an IconButton. */
  overflow?: ReactNode;
  /** The checkbox column only appears when this is true. */
  selectionMode?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  /** Whole-row click target. Omit for a non-interactive row. */
  onOpen?: () => void;
  /** Overrides the generated "name, location, status" accessible label. */
  openLabel?: string;
  className?: string;
  id?: string;
}

/**
 * One item per ledger row: thumbnail, name, up to three facts, location, status,
 * and an overflow action. The whole row opens via a stretched native button, so
 * Enter/Space work without making the checkbox or overflow button nested controls.
 */
export function ItemRow({
  title,
  thumbnail,
  facts,
  location,
  status,
  overflow,
  selectionMode = false,
  selected = false,
  onSelectedChange,
  onOpen,
  openLabel,
  className,
  id,
}: ItemRowProps) {
  const visibleFacts = facts?.slice(0, MAX_FACTS) ?? [];
  const accessibleLabel = openLabel ?? [title, location, status?.label].filter(Boolean).join('，');

  return (
    <div
      id={id}
      className={[styles.row, className].filter(Boolean).join(' ')}
      data-selected={selected ? 'true' : undefined}
    >
      {selectionMode && (
        <label className={styles.checkbox}>
          <input
            className={styles.checkboxInput}
            type="checkbox"
            checked={selected}
            aria-label={`选择 ${title}`}
            onChange={(event) => onSelectedChange?.(event.target.checked)}
          />
        </label>
      )}
      {onOpen && (
        <button
          type="button"
          className={styles.open}
          aria-label={accessibleLabel}
          onClick={onOpen}
        />
      )}
      {thumbnail && <div className={styles.thumbnail}>{thumbnail}</div>}
      <div className={styles.main}>
        <div className={styles.title} title={title}>
          {title}
        </div>
        {visibleFacts.length > 0 && (
          <div className={styles.facts}>
            {visibleFacts.map((fact, index) => (
              <FactChip key={index}>{fact}</FactChip>
            ))}
          </div>
        )}
        {location && <div className={styles.location}>{location}</div>}
      </div>
      {status && (
        <div className={styles.status}>
          <StatusTag tone={status.tone}>{status.label}</StatusTag>
        </div>
      )}
      {overflow && <div className={styles.overflow}>{overflow}</div>}
    </div>
  );
}
