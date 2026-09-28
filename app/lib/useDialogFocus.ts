"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep keyboard focus inside a modal dialog while it is open: Tab and Shift+Tab
 * wrap around its controls. When it closes, focus returns to whatever opened it.
 */
export function useDialogFocus(dialog: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const trap = (event: KeyboardEvent) => {
      const root = dialog.current;
      if (event.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const inside = root.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !inside)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      // The opener may be gone or disabled by what the dialog did (a deleted row, an emptied catalog).
      if (opener?.isConnected && !opener.matches(":disabled")) opener.focus();
    };
  }, [dialog]);
}
