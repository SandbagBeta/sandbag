"use client";

import { useEffect, useState, type RefObject } from "react";

/** True when the browser can create a WebGL context (never throws). */
export function hasWebGL(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}

export interface HeroMode {
  /** False until the client has checked; SSR and first paint show the poster. */
  checked: boolean;
  /** Mount the canvas at all: WebGL works and motion is not reduced. */
  live: boolean;
  /** Render nothing new: the hero is off-screen or the tab is hidden. */
  paused: boolean;
}

/**
 * Decides whether the hero runs the 3D scene. The poster is the answer for no
 * WebGL and for `prefers-reduced-motion`; off-screen or hidden only pauses.
 */
export function useHeroMode(boxRef: RefObject<Element | null>): HeroMode {
  const [live, setLive] = useState(false);
  const [checked, setChecked] = useState(false);
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);

  useEffect(() => {
    // No matchMedia (very old browsers, jsdom): stay on the poster.
    const reduce =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const update = () => {
      setLive(reduce !== null && !reduce.matches && hasWebGL());
      setChecked(true);
    };
    update();
    reduce?.addEventListener?.("change", update);
    return () => reduce?.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState !== "hidden");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry) setInView(entry.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [boxRef]);

  return { checked, live, paused: !inView || !tabVisible };
}
