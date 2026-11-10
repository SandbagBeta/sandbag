/**
 * sandbag/no-raw-coordinates
 *
 * Access privacy is safety-critical (CLAUDE.md value 1, PRD §2, ADR 001):
 * every code path that outputs coordinates must go through the
 * location-privacy formatter in src/lib/location.ts. This rule flags code
 * that touches geographic coordinates anywhere else, so a raw-coords
 * shortcut fails CI instead of relying on review.
 *
 * Flagged (runtime code only, type declarations are allowed):
 * - property access:      area.metadata.lat, row["bbox"]
 * - object keys/patterns: { lat, lng }, const { bbox } = meta
 * - JSX attributes:       <Pin lat={...} />
 * - strings/templates:    GraphQL selections ("metadata { lat lng }"),
 *                         proximity queries (cragsNear), and the locked-down
 *                         *_coords tables (supabase.from("area_cache_coords"))
 *
 * Allowed: src/lib/location.ts and src/lib/location/** (configured in
 * eslint.config.mjs). A genuine exception elsewhere needs
 * `// eslint-disable-next-line sandbag/no-raw-coordinates -- <reason>`,
 * which the reviewer agent treats as a blocking-level item to justify.
 */

// Geographic keys. Deliberately excludes 3D-viewer names (position, point,
// coords, geometry, x/y/z) so mesh code isn't caught.
const GEO_KEY =
  /^(lat|lng|lon|latitude|longitude|latlng|lnglat|bbox|coordinates)$/i;

// The same names inside strings, plus proximity queries and *_coords tables.
const GEO_TEXT =
  /\b(lat|lng|lon|latitude|longitude|latlng|lnglat|bbox|cragsNear|cragsWithin|\w+_coords)\b/i;

const HELP =
  "Route coordinates through src/lib/location.ts (the location-privacy formatter).";

function keyName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return null;
}

function isKeyPosition(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "Property" && parent.key === node) return true;
  if (parent.type === "MemberExpression" && parent.property === node) {
    return true;
  }
  return false;
}

function isModuleSource(node) {
  const t = node.parent?.type;
  return (
    t === "ImportDeclaration" ||
    t === "ExportNamedDeclaration" ||
    t === "ExportAllDeclaration" ||
    t === "ImportExpression"
  );
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw geographic coordinates outside the location-privacy formatter",
    },
    schema: [],
    messages: {
      key: "Raw coordinate field `{{name}}` outside the formatter. {{help}}",
      text: "String references raw coordinates (`{{name}}`). {{help}}",
    },
  },
  create(context) {
    const reportKey = (node, name) =>
      context.report({ node, messageId: "key", data: { name, help: HELP } });
    const reportText = (node, value) => {
      const match = GEO_TEXT.exec(value);
      if (match) {
        context.report({
          node,
          messageId: "text",
          data: { name: match[1], help: HELP },
        });
      }
    };

    return {
      MemberExpression(node) {
        const name =
          node.computed && node.property.type !== "Literal"
            ? null
            : keyName(node.property);
        if (name && GEO_KEY.test(name)) reportKey(node.property, name);
      },
      Property(node) {
        if (node.computed) return;
        const name = keyName(node.key);
        if (name && GEO_KEY.test(name)) reportKey(node.key, name);
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (GEO_KEY.test(node.name.name)) reportKey(node, node.name.name);
      },
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (isKeyPosition(node) || isModuleSource(node)) return;
        reportText(node, node.value);
      },
      TemplateElement(node) {
        reportText(node, node.value.raw);
      },
    };
  },
};

export default rule;
