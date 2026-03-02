// ESM-to-CJS conversion via acorn AST, with regex fallback

import * as acorn from "acorn";

export function esmToCjs(code: string): string {
  try {
    return esmToCjsViaAst(code);
  } catch {
    return esmToCjsViaRegex(code);
  }
}

function esmToCjsViaAst(code: string): string {
  const ast = acorn.parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const patches: Array<[number, number, string]> = [];

  const hasDefaultExport = (ast as any).body.some(
    (n: any) => n.type === "ExportDefaultDeclaration",
  );
  const hasNamedExport = (ast as any).body.some(
    (n: any) => n.type === "ExportNamedDeclaration",
  );
  const mixedExports = hasDefaultExport && hasNamedExport;

  for (const node of (ast as any).body) {
    if (node.type === "ImportDeclaration") {
      const src = node.source.value;
      const specs = node.specifiers;

      if (specs.length === 0) {
        patches.push([
          node.start,
          node.end,
          `require(${JSON.stringify(src)});`,
        ]);
      } else {
        const defSpec = specs.find(
          (s: any) => s.type === "ImportDefaultSpecifier",
        );
        const nsSpec = specs.find(
          (s: any) => s.type === "ImportNamespaceSpecifier",
        );
        const namedSpecs = specs.filter(
          (s: any) => s.type === "ImportSpecifier",
        );

        const lines: string[] = [];
        const tmpVar = `__import_${node.start}`;
        const needsTmp = defSpec && (namedSpecs.length > 0 || nsSpec);

        if (needsTmp) {
          lines.push(`const ${tmpVar} = require(${JSON.stringify(src)})`);
          lines.push(
            `const ${defSpec.local.name} = ${tmpVar}.__esModule ? ${tmpVar}.default : ${tmpVar}`,
          );
        } else if (defSpec) {
          lines.push(
            `const ${defSpec.local.name} = (function(m) { return m.__esModule ? m.default : m; })(require(${JSON.stringify(src)}))`,
          );
        }

        if (nsSpec) {
          if (!needsTmp) {
            lines.push(
              `const ${nsSpec.local.name} = require(${JSON.stringify(src)})`,
            );
          } else {
            lines.push(`const ${nsSpec.local.name} = ${tmpVar}`);
          }
        }

        if (namedSpecs.length > 0) {
          const binds = namedSpecs
            .map((s: any) =>
              s.imported.name === s.local.name
                ? s.local.name
                : `${s.imported.name}: ${s.local.name}`,
            )
            .join(", ");
          if (needsTmp) {
            lines.push(`const { ${binds} } = ${tmpVar}`);
          } else {
            lines.push(`const { ${binds} } = require(${JSON.stringify(src)})`);
          }
        }
        patches.push([node.start, node.end, lines.join(";\n") + ";"]);
      }
    } else if (node.type === "ExportDefaultDeclaration") {
      const decl = node.declaration;
      const bodyCode = code.slice(decl.start, node.end);
      const exportTarget = mixedExports ? "exports.default" : "module.exports";

      if (
        (decl.type === "FunctionDeclaration" ||
          decl.type === "ClassDeclaration") &&
        decl.id?.name
      ) {
        // preserve the declaration so the name is bound in local scope
        patches.push([
          node.start,
          node.end,
          `${bodyCode};\n${exportTarget} = ${decl.id.name};`,
        ]);
      } else {
        patches.push([node.start, node.end, `${exportTarget} = ${bodyCode}`]);
      }
    } else if (node.type === "ExportNamedDeclaration") {
      if (node.declaration) {
        const decl = node.declaration;
        if (
          decl.type === "FunctionDeclaration" ||
          decl.type === "ClassDeclaration"
        ) {
          const name = decl.id.name;
          const bodyCode = code.slice(decl.start, node.end);
          // emit declaration so name is bound locally, then export it
          patches.push([
            node.start,
            node.end,
            `${bodyCode};\nexports.${name} = ${name};`,
          ]);
        } else if (decl.type === "VariableDeclaration") {
          const lines: string[] = [];
          const needsLiveBinding = decl.kind === "let" || decl.kind === "var";
          const hasDestructuring = decl.declarations.some(
            (d: any) =>
              d.id.type === "ObjectPattern" || d.id.type === "ArrayPattern",
          );
          if (hasDestructuring) {
            const declCode = code.slice(decl.start, decl.end);
            lines.push(declCode);
            for (const d of decl.declarations) {
              for (const name of extractBindingNames(d.id)) {
                if (needsLiveBinding) {
                  lines.push(
                    `Object.defineProperty(exports, ${JSON.stringify(name)}, { get() { return ${name}; }, enumerable: true })`,
                  );
                } else {
                  lines.push(`exports.${name} = ${name}`);
                }
              }
            }
          } else {
            const declCode = code.slice(decl.start, decl.end);
            lines.push(declCode);
            for (const d of decl.declarations) {
              if (needsLiveBinding) {
                // ESM live binding: getter so reassignments are visible to importers
                lines.push(
                  `Object.defineProperty(exports, ${JSON.stringify(d.id.name)}, { get() { return ${d.id.name}; }, enumerable: true })`,
                );
              } else {
                lines.push(`exports.${d.id.name} = ${d.id.name}`);
              }
            }
          }
          patches.push([node.start, node.end, lines.join(";\n") + ";"]);
        }
      } else if (node.source) {
        const src = node.source.value;
        const tmp = `__reexport_${node.start}`;
        const lines = [`const ${tmp} = require(${JSON.stringify(src)})`];
        for (const spec of node.specifiers) {
          if (spec.local.name === "default") {
            // handle both module.exports=X and exports.default=X conventions
            lines.push(
              `exports.${spec.exported.name} = ${tmp}.__esModule ? ${tmp}.default : ${tmp}`,
            );
          } else {
            lines.push(
              `exports.${spec.exported.name} = ${tmp}.${spec.local.name}`,
            );
          }
        }
        patches.push([node.start, node.end, lines.join(";\n") + ";"]);
      } else {
        const lines = node.specifiers.map(
          (s: any) => `exports.${s.exported.name} = ${s.local.name}`,
        );
        patches.push([node.start, node.end, lines.join(";\n") + ";"]);
      }
    } else if (node.type === "ExportAllDeclaration") {
      const src = node.source.value;
      patches.push([
        node.start,
        node.end,
        `Object.assign(exports, require(${JSON.stringify(src)}))`,
      ]);
    }
  }

  let output = code;
  patches.sort((a, b) => b[0] - a[0]);
  for (const [s, e, r] of patches)
    output = output.slice(0, s) + r + output.slice(e);
  return output;
}

// extract all bound names from a destructuring pattern or identifier
function extractBindingNames(pattern: any): string[] {
  if (pattern.type === "Identifier") {
    return [pattern.name];
  }
  if (pattern.type === "ObjectPattern") {
    const names: string[] = [];
    for (const prop of pattern.properties) {
      if (prop.type === "RestElement") {
        names.push(...extractBindingNames(prop.argument));
      } else {
        names.push(...extractBindingNames(prop.value));
      }
    }
    return names;
  }
  if (pattern.type === "ArrayPattern") {
    const names: string[] = [];
    for (const elem of pattern.elements) {
      if (elem) {
        if (elem.type === "RestElement") {
          names.push(...extractBindingNames(elem.argument));
        } else {
          names.push(...extractBindingNames(elem));
        }
      }
    }
    return names;
  }
  if (pattern.type === "AssignmentPattern") {
    return extractBindingNames(pattern.left);
  }
  return [];
}

// detect whether code contains any top-level await (outside async functions)
export function hasTopLevelAwait(code: string): boolean {
  if (!/\bawait\b/.test(code)) return false;

  try {
    let ast: any;
    try {
      ast = acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: "script",
        allowAwaitOutsideFunction: true,
      });
    } catch {
      ast = acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: "module",
      });
    }

    let found = false;
    let insideAsync = 0;

    function walk(node: any): void {
      if (found || !node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      if (typeof node.type !== "string") return;

      const isAsyncFn =
        (node.type === "FunctionDeclaration" ||
          node.type === "FunctionExpression" ||
          node.type === "ArrowFunctionExpression") &&
        node.async;

      if (isAsyncFn) insideAsync++;
      if (node.type === "AwaitExpression" && insideAsync === 0) {
        found = true;
      }
      if (node.type === "ForOfStatement" && node.await && insideAsync === 0) {
        found = true;
      }
      if (!found) {
        for (const key of Object.keys(node)) {
          if (key === "type" || key === "start" || key === "end") continue;
          const val = node[key];
          if (val && typeof val === "object") walk(val);
        }
      }
      if (isAsyncFn) insideAsync--;
    }

    walk(ast);
    return found;
  } catch {
    // fallback: conservative regex
    return /(?<![.\w])await\s+(?=[\w$("'\[`!~+\-/])/.test(code);
  }
}

// strip top-level await and optionally de-async inner functions.
// "topLevelOnly": only replace top-level await with __syncAwait(), leave inner async intact.
// "full": strip async from all functions, replace ALL awaits with __syncAwait().
// full mode is needed for synchronous require() chains where async would wrap
// returns in native Promises that syncAwait() can't unwrap.
export function stripTopLevelAwait(
  code: string,
  mode: "topLevelOnly" | "full" = "topLevelOnly",
): string {
  const full = mode === "full";
  if (!full && !/\bawait\b/.test(code)) return code;
  if (full && !/\bawait\b/.test(code) && !/\basync\b/.test(code)) return code;

  try {
    let ast: any;
    try {
      ast = acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: "script",
        allowAwaitOutsideFunction: true,
      });
    } catch {
      ast = acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: "module",
      });
    }

    const patches: Array<[number, number, string]> = [];
    let insideAsync = 0;

    function walk(node: any) {
      if (!node || typeof node !== "object") return;

      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }

      if (typeof node.type !== "string") return;

      const isAsyncFn =
        (node.type === "FunctionDeclaration" ||
          node.type === "FunctionExpression" ||
          node.type === "ArrowFunctionExpression") &&
        node.async;

      if (isAsyncFn) insideAsync++;

      // in full mode, strip async so functions return plain values (not native Promises).
      // skip async generators -- yield semantics can't be replaced.
      if (full && isAsyncFn && !node.generator) {
        if (code.slice(node.start, node.start + 5) === "async") {
          let end = node.start + 5;
          while (end < code.length && (code[end] === " " || code[end] === "\t")) end++;
          patches.push([node.start, end, ""]);
        } else {
          // method syntax: { async foo() {} }
          const searchStart = Math.max(0, node.start - 30);
          const region = code.slice(searchStart, node.start);
          const asyncIdx = region.lastIndexOf("async");
          if (asyncIdx >= 0) {
            const absStart = searchStart + asyncIdx;
            let absEnd = absStart + 5;
            while (absEnd < code.length && (code[absEnd] === " " || code[absEnd] === "\t")) absEnd++;
            patches.push([absStart, absEnd, ""]);
          }
        }
      }

      // Replace only the `await` keyword + trailing whitespace. We can't use
      // node.argument.start because acorn doesn't produce ParenthesizedExpression
      // nodes, so `await (expr)` would swallow the opening paren.
      if (node.type === "AwaitExpression") {
        if (full || insideAsync === 0) {
          let awaitEnd = node.start + 5; // "await" is 5 chars
          while (
            awaitEnd < node.argument.start &&
            (code[awaitEnd] === " " || code[awaitEnd] === "\t" || code[awaitEnd] === "\n" || code[awaitEnd] === "\r")
          ) {
            awaitEnd++;
          }
          patches.push([node.start, awaitEnd, "__syncAwait("]);
          patches.push([node.end, node.end, ")"]);
        }
      }

      // strip await from `for await (...of ...)`
      if (node.type === "ForOfStatement" && node.await) {
        if (full || insideAsync === 0) {
          const forEnd = node.start + 3;
          const snippet = code.slice(forEnd, node.left.start);
          const awIdx = snippet.indexOf("await");
          if (awIdx >= 0) {
            const absStart = forEnd + awIdx;
            let absEnd = absStart + 5;
            while (absEnd < code.length && code[absEnd] === " ") absEnd++;
            patches.push([absStart, absEnd, ""]);
          }
        }
      }

      for (const key of Object.keys(node)) {
        if (key === "type" || key === "start" || key === "end") continue;
        const val = node[key];
        if (val && typeof val === "object") {
          walk(val);
        }
      }

      if (isAsyncFn) insideAsync--;
    }

    walk(ast);

    if (patches.length === 0) return code;

    let output = code;
    patches.sort((a, b) => b[0] - a[0]);
    for (const [start, end, replacement] of patches) {
      output = output.slice(0, start) + replacement + output.slice(end);
    }
    return output;
  } catch {
    // regex fallback -- can't reliably add closing parens, best-effort strip
    if (full) {
      let out = code.replace(/(?<![.\w])await\s+(?=[\w$("'\[`!~+\-/])/g, "");
      out = out.replace(/(?<![.\w])async\s+(?=function[\s*(])/g, "");
      out = out.replace(/(?<![.\w])async\s+(?=\()/g, "");
      out = out.replace(/(?<![.\w])async\s+(?=\w+\s*=>)/g, "");
      return out;
    }
    // topLevelOnly: strip top-level await keyword
    return code.replace(
      /(?<![.\w])await\s+(?=[\w$("'\[`!~+\-/])/g,
      "",
    );
  }
}

function esmToCjsViaRegex(code: string): string {
  let out = code;
  // strip TS type-only imports
  out = out.replace(
    /import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]\s*;?/g,
    "",
  );
  out = out.replace(
    /import\s+type\s+\w+\s+from\s+['"][^'"]+['"]\s*;?/g,
    "",
  );
  out = out.replace(
    /import\s+type\s+\*\s+as\s+\w+\s+from\s+['"][^'"]+['"]\s*;?/g,
    "",
  );
  // remove inline type specifiers from mixed imports
  out = out.replace(
    /import\s+\{([^}]*\btype\s+\w+[^}]*)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    (_m, specs: string, src: string) => {
      const kept = specs
        .split(",")
        .filter((s: string) => !/^\s*type\s+\w+/.test(s))
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (kept.length === 0) return "";
      const fixed = kept.join(", ").replace(/(\w+)\s+as\s+(\w+)/g, "$1: $2");
      return `const {${fixed}} = require("${src}");`;
    },
  );
  // strip TS type-only exports
  out = out.replace(
    /export\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]\s*;?/g,
    "",
  );
  out = out.replace(
    /export\s+type\s+\{[^}]*\}\s*;?/g,
    "",
  );
  out = out.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    'const $1 = require("$2");',
  );
  out = out.replace(
    /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    (_m, def, named, src) => {
      const tmp = `__import_${def}`;
      const fixed = named.replace(/(\w+)\s+as\s+(\w+)/g, "$1: $2");
      return `const ${tmp} = require("${src}"); const ${def} = ${tmp}.__esModule ? ${tmp}.default : ${tmp}; const {${fixed}} = ${tmp};`;
    },
  );
  out = out.replace(
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    'const $1 = require("$2");',
  );
  out = out.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    (_m, specs, src) => {
      const fixed = specs.replace(/(\w+)\s+as\s+(\w+)/g, "$1: $2");
      return `const {${fixed}} = require("${src}");`;
    },
  );
  out = out.replace(
    /import\s+['"]([^'"]+)['"]\s*;?/g,
    'require("$1");',
  );
  // export default
  out = out.replace(
    /export\s+default\s+class\s+(\w+)/g,
    "module.exports = class $1",
  );
  out = out.replace(
    /export\s+default\s+function\s+(\w+)/g,
    "module.exports = function $1",
  );
  out = out.replace(
    /export\s+default\s+function\s*\(/g,
    "module.exports = function(",
  );
  out = out.replace(/export\s+default\s+/g, "module.exports = ");
  // re-exports
  out = out.replace(
    /export\s+\*\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    'Object.assign(exports, require("$1"));',
  );
  out = out.replace(
    /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    (_m, specs, src) => {
      const binds = specs
        .split(",")
        .map((s: string) => {
          const parts = s.trim().split(/\s+as\s+/);
          const local = parts[0].trim();
          const exported = parts.length > 1 ? parts[1].trim() : local;
          return `exports.${exported} = require("${src}").${local}`;
        })
        .join("; ");
      return binds + ";";
    },
  );
  out = out.replace(
    /export\s+\{([^}]+)\}\s*;?/g,
    (_m, specs) => {
      const binds = specs
        .split(",")
        .map((s: string) => {
          const parts = s.trim().split(/\s+as\s+/);
          const local = parts[0].trim();
          const exported = parts.length > 1 ? parts[1].trim() : local;
          return `exports.${exported} = ${local}`;
        })
        .join("; ");
      return binds + ";";
    },
  );
  // named exports
  out = out.replace(
    /export\s+async\s+function\s+(\w+)/g,
    "exports.$1 = async function $1",
  );
  out = out.replace(/export\s+function\s+(\w+)/g, "exports.$1 = function $1");
  out = out.replace(/export\s+class\s+(\w+)/g, "exports.$1 = class $1");
  out = out.replace(/export\s+(?:const|let|var)\s+(\w+)\s*=/g, "exports.$1 =");
  return out;
}
