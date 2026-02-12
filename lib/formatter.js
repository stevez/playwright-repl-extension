/**
 * Formats the CDP accessibility tree nodes into readable lines.
 * Each visible node gets a ref like [ref=e1] for later use in click/fill.
 */
export function formatAccessibilityTree(nodes) {
  if (!nodes || nodes.length === 0) return ["(empty tree)"];

  const lines = [];
  let refCounter = 1;

  for (const node of nodes) {
    const role = node.role?.value;
    const name = node.name?.value;

    // Skip generic/invisible/structural nodes
    if (!role || role === "none" || role === "generic" || role === "InlineTextBox") continue;
    if (role === "StaticText" && !name) continue;
    if (node.ignored) continue;

    let line = `- ${role}`;
    if (name) line += ` "${name}"`;
    line += ` [ref=e${refCounter}]`;
    refCounter++;
    lines.push(line);
  }

  return lines.length > 0 ? lines : ["(empty tree)"];
}
