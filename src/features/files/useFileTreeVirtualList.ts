import { useEffect, useMemo, useRef } from "react";
import { measureElement as defaultMeasureElement, useVirtualizer } from "@tanstack/react-virtual";
import { joinPath, useFilesStore } from "./store";
import type { VisibleNode } from "./FileTreeRow";

/**
 * Flattens the expanded store tree into the visible row list and owns the
 * virtualizer that renders it, including the root-load effect and the
 * hidden-panel scroll/measure safeguards.
 */
export function useFileTreeVirtualList() {
  const root = useFilesStore((s) => s.root);
  const children = useFilesStore((s) => s.children);
  const expanded = useFilesStore((s) => s.expanded);
  const loadingDirs = useFilesStore((s) => s.loadingDirs);
  const ensureDir = useFilesStore((s) => s.ensureDir);

  // Load the root level whenever it changes and hasn't been fetched yet.
  useEffect(() => {
    if (root) void ensureDir(root);
  }, [root, ensureDir]);

  const visible = useMemo<VisibleNode[]>(() => {
    const out: VisibleNode[] = [];
    const walk = (dirPath: string, depth: number) => {
      const entries = children[dirPath];
      if (!entries) return;
      for (const e of entries) {
        const path = joinPath(dirPath, e.name);
        out.push({
          ...e,
          path,
          depth,
          expanded: e.isDir && !!expanded[path],
          loading: e.isDir && !!loadingDirs[path],
        });
        // Only already-expanded levels are walked — the tree never loads
        // recursively; each expansion triggers exactly one listDir call.
        if (e.isDir && expanded[path]) walk(path, depth + 1);
      }
    };
    if (root) walk(root, 0);
    return out;
  }, [children, expanded, loadingDirs, root]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
    // Rows are recreated on every store update; key measurements by path so
    // expand/collapse/refresh never reassigns a cached size to the wrong row.
    getItemKey: (index) => visible[index]?.path ?? index,
    // ChatPage keeps this panel mounted under `display: none` while the
    // changes tab is active, and ResizeObserver then reports every rendered
    // row as 0px tall. virtual-core has no zero-size guard: accepting those
    // entries poisons itemSizeCache and fires phantom scroll adjustments
    // (writes dropped on the box-less scroller while scrollOffset eagerly
    // drifts), which can leave the virtualizer scrolled past real rows — a
    // blank band at the top of the tree. Keep the last known height instead.
    measureElement: (el, entry, instance) => {
      const size = defaultMeasureElement(el, entry, instance);
      if (size > 0) return size;
      const index = instance.indexFromElement(el);
      return (
        instance.itemSizeCache.get(instance.options.getItemKey(index)) ?? 28
      );
    },
  });

  // Safety net for the same hidden→shown transition: if the DOM scroll
  // position and the virtualizer's offset still diverge (WKWebView restores
  // scrollTop without a scroll event), re-sync through the virtualizer's own
  // scroll pipeline. The synthetic event is a no-op when already in sync
  // (virtual-core's spurious-event guard).
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    let lastHeight = el.getBoundingClientRect().height;
    const ro = new ResizeObserver(() => {
      const height = el.getBoundingClientRect().height;
      if (lastHeight === 0 && height > 0) el.dispatchEvent(new Event("scroll"));
      lastHeight = height;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { parentRef, virtualizer, visible };
}
