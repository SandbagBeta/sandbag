"use client";

import { AnnotateEditor } from "@/components/viewer/annotate/AnnotateEditor";
import type { AnnotateEditorProps } from "@/components/viewer/annotate/AnnotateEditor";

export function AnnotateClient(props: Omit<AnnotateEditorProps, "label">) {
  return <AnnotateEditor {...props} label="3D scan of the demo boulder" />;
}
