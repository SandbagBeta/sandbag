"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Called before the subtree is remounted (e.g. to clear a loader cache). */
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

/** Catches load/render failures from the 3D subtree; never crashes the page. */
export class ViewerErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  retry = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full w-full flex-col items-center justify-center gap-3 bg-stone-100 p-6 text-center text-stone-900 dark:bg-stone-900 dark:text-stone-100"
      >
        <p className="text-base font-semibold">Couldn&apos;t load this scan</p>
        <p className="max-w-prose text-sm text-stone-600 dark:text-stone-400">
          {describeError(error)}
        </p>
        <button
          type="button"
          onClick={this.retry}
          className="bg-granite focus-visible:ring-sandstone dark:bg-sandstone rounded-md px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 focus-visible:ring-2 focus-visible:outline-none dark:text-stone-950 dark:hover:bg-amber-200"
        >
          Retry
        </button>
      </div>
    );
  }
}

/** Map loader errors to a short human-readable reason. */
export function describeError(error: Error): string {
  const msg = error.message || "";
  if (/404|not found/i.test(msg)) return "The file was not found (404).";
  if (/fetch|network/i.test(msg)) {
    return "Network error while fetching the file.";
  }
  if (/gltf|glb|json|unexpected/i.test(msg)) {
    return "The file is not a valid GLB.";
  }
  return msg || "Unknown error.";
}
