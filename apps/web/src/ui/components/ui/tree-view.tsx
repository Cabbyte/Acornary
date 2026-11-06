import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { cn } from '../utils';
import '../../patterns/facts.css';

export interface TreeViewNode {
  /** Stable entity identity, never a row index or shortened ID. */
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  children?: readonly TreeViewNode[];
}

export interface TreeViewProps {
  label: string;
  nodes: readonly TreeViewNode[];
  selectedId: string | null;
  expandedIds: readonly string[];
  onSelectionChange: (id: string) => void;
  onExpandedChange: (ids: string[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  error?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  className?: string;
}

interface VisibleNode {
  node: TreeViewNode;
  parentId: string | null;
}

// Base UI 1.9 has no tree primitive. Nested ul/li semantics and roving focus follow:
// https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
// Focus and selection are independent; selection/expansion remain fully controlled.
export function TreeView({
  label,
  nodes,
  selectedId,
  expandedIds,
  onSelectionChange,
  onExpandedChange,
  disabled = false,
  readOnly = false,
  loading = false,
  error,
  emptyMessage = '暂无层级',
  onRetry,
  className,
}: TreeViewProps) {
  const prefix = useId();
  const refs = useRef(new Map<string, HTMLLIElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const typeahead = useRef({ value: '', time: 0 });
  const expanded = new Set(expandedIds);
  const visible: VisibleNode[] = [];
  const visit = (items: readonly TreeViewNode[], parentId: string | null) => {
    for (const node of items) {
      visible.push({ node, parentId });
      if (expanded.has(node.id) && node.children) visit(node.children, node.id);
    }
  };
  visit(nodes, null);
  const activeId = visible.some(({ node }) => node.id === focusedId)
    ? focusedId
    : (visible.find(({ node }) => node.id === selectedId)?.node.id ?? visible[0]?.node.id);
  const focus = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    refs.current.get(id)?.focus();
  };
  const toggle = (node: TreeViewNode, open: boolean) => {
    if (disabled || loading || node.disabled || !node.children?.length) return;
    onExpandedChange(
      open ? [...new Set([...expandedIds, node.id])] : expandedIds.filter((id) => id !== node.id),
    );
  };
  const select = (node: TreeViewNode) => {
    if (!disabled && !loading && !readOnly && !node.disabled) onSelectionChange(node.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, node: TreeViewNode) => {
    // Nested treeitems must not also run their ancestor's keyboard handler.
    event.stopPropagation();
    if (disabled || loading || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = visible.findIndex((entry) => entry.node.id === node.id);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focus(visible[Math.min(index + 1, visible.length - 1)]?.node.id);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focus(visible[Math.max(index - 1, 0)]?.node.id);
        break;
      case 'Home':
        event.preventDefault();
        focus(visible[0]?.node.id);
        break;
      case 'End':
        event.preventDefault();
        focus(visible.at(-1)?.node.id);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (expanded.has(node.id)) focus(node.children?.[0]?.id);
        else toggle(node, true);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (expanded.has(node.id) && node.children?.length) toggle(node, false);
        else focus(visible[index]?.parentId ?? undefined);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        select(node);
        break;
      default:
        if (event.key.length === 1 && event.key.trim()) {
          const previous =
            event.timeStamp - typeahead.current.time < 700 ? typeahead.current.value : '';
          const value = (previous + event.key).toLocaleLowerCase();
          typeahead.current = { value, time: event.timeStamp };
          const ordered = [...visible.slice(index + 1), ...visible.slice(0, index + 1)];
          const match = ordered.find(({ node: candidate }) =>
            candidate.label.toLocaleLowerCase().startsWith(value),
          );
          if (match) {
            event.preventDefault();
            focus(match.node.id);
          }
        }
    }
  };
  const renderNodes = (items: readonly TreeViewNode[], level: number): ReactNode =>
    items.map((node, position) => {
      const hasChildren = Boolean(node.children?.length);
      const isExpanded = hasChildren && expanded.has(node.id);
      const unavailable = disabled || Boolean(node.disabled) || loading;
      const labelId = `${prefix}-${node.id}-label`;
      const descriptionId = `${prefix}-${node.id}-description`;
      return (
        <li
          key={node.id}
          ref={(element) => {
            if (element) refs.current.set(node.id, element);
            else refs.current.delete(node.id);
          }}
          role="treeitem"
          tabIndex={!disabled && !loading && activeId === node.id ? 0 : -1}
          aria-labelledby={labelId}
          aria-describedby={node.description ? descriptionId : undefined}
          aria-level={level}
          aria-posinset={position + 1}
          aria-setsize={items.length}
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-selected={node.disabled ? undefined : selectedId === node.id}
          aria-disabled={unavailable || undefined}
          className="vn-tree-item"
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocusedId(node.id);
          }}
          onKeyDown={(event) => onKeyDown(event, node)}
        >
          <div
            className="vn-tree-row"
            onClick={(event) => {
              event.stopPropagation();
              if (!disabled && !loading) {
                focus(node.id);
                select(node);
              }
            }}
          >
            {hasChildren ? (
              <BaseButton
                type="button"
                tabIndex={-1}
                className="vn-tree-toggle"
                disabled={unavailable}
                aria-label={`${isExpanded ? '收起' : '展开'}${node.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  focus(node.id);
                  toggle(node, !isExpanded);
                }}
              >
                <span aria-hidden="true">{isExpanded ? '⌄' : '›'}</span>
              </BaseButton>
            ) : (
              <span className="vn-tree-leaf" aria-hidden="true">
                ·
              </span>
            )}
            <span className="vn-tree-text">
              <span id={labelId}>{node.label}</span>
              {node.description && (
                <span id={descriptionId} className="vn-fact-meta">
                  {node.description}
                </span>
              )}
            </span>
            {selectedId === node.id && (
              <span className="vn-tree-selected" aria-hidden="true">
                ✓
              </span>
            )}
          </div>
          {isExpanded && (
            <ul role="group" className="vn-tree-group">
              {renderNodes(node.children!, level + 1)}
            </ul>
          )}
        </li>
      );
    });
  return (
    <div className={cn('vn-tree', className)}>
      {loading && (
        <p role="status" className="vn-fact-meta">
          正在加载{label}…
        </p>
      )}
      {error && (
        <div className="vn-fact-error" role="alert">
          <span>{error}</span>
          {onRetry && (
            <BaseButton
              type="button"
              className="vn-fact-button"
              onClick={onRetry}
              disabled={disabled || loading}
            >
              重试
            </BaseButton>
          )}
        </div>
      )}
      {nodes.length > 0 ? (
        <ul
          role="tree"
          aria-label={label}
          aria-busy={loading || undefined}
          aria-disabled={disabled || undefined}
          aria-readonly={readOnly || undefined}
          className="vn-tree-root"
        >
          {renderNodes(nodes, 1)}
        </ul>
      ) : (
        !loading && !error && <p className="vn-fact-meta">{emptyMessage}</p>
      )}
    </div>
  );
}
