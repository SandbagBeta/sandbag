/**
 * Pure area-tree building for the browse pages (#30). Input: cached OpenBeta
 * area rows (names, paths, ancestor ids: public, ADR 001 D2) and how many
 * published scans sit directly on each area. No coordinates anywhere.
 */
import type { AreaCache } from "@/lib/types";

export type AreaRow = Pick<
  AreaCache,
  "openbeta_area_id" | "name" | "path_tokens" | "ancestors"
>;

export interface AreaNode {
  id: string;
  name: string;
  /** Published scans on this area and everything below it. */
  scanCount: number;
  /** Only children that contain at least one published scan, by name. */
  children: AreaNode[];
}

export interface Crumb {
  id: string;
  name: string;
}

/**
 * Build the tree of areas that contain published scans. An ancestor missing
 * from `rows` still appears, named from the descendant's `path_tokens`, so the
 * tree never breaks on a partially cached chain.
 */
export function buildAreaTree(
  rows: AreaRow[],
  directCounts: ReadonlyMap<string, number>,
): AreaNode[] {
  const byId = new Map(rows.map((r) => [r.openbeta_area_id, r]));
  const nodes = new Map<string, AreaNode>();
  const parentOf = new Map<string, string | null>();

  const ensure = (id: string, name: string, parent: string | null) => {
    let node = nodes.get(id);
    if (!node) {
      node = { id, name, scanCount: 0, children: [] };
      nodes.set(id, node);
      parentOf.set(id, parent);
    }
    return node;
  };

  for (const [areaId, count] of directCounts) {
    if (count <= 0) continue;
    const row = byId.get(areaId);
    if (!row) continue; // FK guarantees a row; skip defensively.
    const chain = crumbs(row);
    chain.forEach((c, i) => {
      const node = ensure(c.id, c.name, i === 0 ? null : chain[i - 1]!.id);
      node.scanCount += count;
    });
  }

  const roots: AreaNode[] = [];
  for (const [id, node] of nodes) {
    const parent = parentOf.get(id);
    if (parent) nodes.get(parent)?.children.push(node);
    else roots.push(node);
  }
  const sort = (list: AreaNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sort(n.children));
    return list;
  };
  return sort(roots);
}

/**
 * Root-first breadcrumb including the area itself. `ancestors` excludes the
 * area and `path_tokens` includes it (cache contract), so they zip 1:1.
 */
export function crumbs(row: AreaRow): Crumb[] {
  const ids = [...row.ancestors, row.openbeta_area_id];
  return ids.map((id, i) => ({
    id,
    name: row.path_tokens[i] ?? (id === row.openbeta_area_id ? row.name : "…"),
  }));
}

export function findNode(tree: AreaNode[], id: string): AreaNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}
