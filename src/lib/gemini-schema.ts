// JSON Schema -> Gemini function-declaration Schema.
//
// AG Studio's tool parameters use full JSON Schema ($defs + $ref, oneOf,
// allOf, const, nullable type arrays). Gemini's function-calling API only
// accepts a subset — $ref anywhere 400s the whole turn. This walks each
// schema once: inlining local refs, folding the unsupported constructs into
// their nearest Gemini equivalent, and dropping keywords Gemini rejects.
// Declarations are descriptive for the model only, so losing `default` /
// `additionalProperties` hints is harmless.

type Obj = Record<string, unknown>;

const ALLOWED = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "anyOf",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "minProperties",
  "maxProperties",
  "propertyOrdering",
]);

const MAX_DEPTH = 24;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** "#/a/b" JSON-pointer lookup inside the schema root (covers #/$defs/x). */
function resolvePointer(root: Obj, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let cur: unknown = root;
  for (const seg of ref
    .slice(2)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!isObj(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as Obj)[seg];
  }
  return cur;
}

/** Fold `src` into `dst` — the allOf intersection, weakly: properties merge
   recursively, required unions, everything else fills gaps only. */
function mergeSchema(dst: Obj, src: Obj) {
  for (const [k, v] of Object.entries(src)) {
    if (k === "properties" && isObj(v)) {
      const d = (dst.properties ??= {}) as Obj;
      for (const [pk, pv] of Object.entries(v)) {
        if (isObj(d[pk]) && isObj(pv)) mergeSchema(d[pk] as Obj, pv);
        else d[pk] = pv;
      }
    } else if (k === "required" && Array.isArray(v)) {
      dst.required = [
        ...new Set([...(Array.isArray(dst.required) ? dst.required : []), ...v]),
      ];
    } else if (k === "anyOf" && Array.isArray(v)) {
      dst.anyOf = [...(Array.isArray(dst.anyOf) ? dst.anyOf : []), ...v];
    } else if (!(k in dst)) {
      dst[k] = v;
    }
  }
}

function clean(node: unknown, root: Obj, seen: Set<object>, depth: number): Obj {
  if (!isObj(node)) return {};
  if (depth > MAX_DEPTH) return { type: "object" };

  if (typeof node.$ref === "string") {
    const { $ref, ...siblings } = node;
    const target = resolvePointer(root, $ref);
    if (!isObj(target) || seen.has(target)) return { type: "object" };
    const resolved = clean(
      target,
      root,
      new Set(seen).add(target),
      depth + 1
    );
    // sibling keys (e.g. a local description) still apply on top
    return { ...resolved, ...clean(siblings, root, seen, depth + 1) };
  }

  const out: Obj = {};
  const anyOf: unknown[] = [];
  const allOf: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    switch (key) {
      case "oneOf": // closest Gemini equivalent is anyOf
        if (Array.isArray(value)) anyOf.push(...value);
        break;
      case "allOf":
        if (Array.isArray(value)) allOf.push(...value);
        break;
      case "const":
        out.enum = [value];
        break;
      case "type":
        if (Array.isArray(value)) {
          if (value.includes("null")) out.nullable = true;
          const types = value.filter((t) => t !== "null");
          if (types.length === 1) out.type = types[0];
          else if (types.length > 1)
            anyOf.push(...types.map((t) => ({ type: t })));
        } else {
          out.type = value;
        }
        break;
      case "properties":
        if (isObj(value)) {
          const props: Obj = {};
          for (const [pk, pv] of Object.entries(value)) {
            if (isObj(pv)) props[pk] = clean(pv, root, seen, depth + 1);
          }
          out.properties = props;
        }
        break;
      case "items":
        if (Array.isArray(value)) {
          out.items = {
            anyOf: value.map((v) => clean(v, root, seen, depth + 1)),
          };
        } else if (isObj(value)) {
          out.items = clean(value, root, seen, depth + 1);
        }
        break;
      case "anyOf":
        if (Array.isArray(value)) anyOf.push(...value);
        break;
      case "required":
        if (Array.isArray(value)) out.required = value;
        break;
      default:
        if (ALLOWED.has(key)) out[key] = value;
    }
  }
  for (const m of allOf) mergeSchema(out, clean(m, root, seen, depth + 1));
  if (anyOf.length)
    out.anyOf = anyOf.map((m) =>
      isObj(m) ? clean(m, root, seen, depth + 1) : m
    );
  if (Array.isArray(out.required) && isObj(out.properties)) {
    out.required = (out.required as unknown[]).filter(
      (r) => typeof r === "string" && r in (out.properties as Obj)
    );
    if (!(out.required as unknown[]).length) delete out.required;
  }
  return out;
}

/** Any schema -> Gemini's accepted subset (keeps non-object roots for
   responseSchema). */
export function toGeminiSchema(schema: unknown): Obj {
  const root = isObj(schema) ? schema : {};
  return clean(root, root, new Set(), 0);
}

/** Tool parameters must be an OBJECT schema — wraps anything that isn't. */
export function toGeminiParameters(schema: unknown): Obj {
  const out = toGeminiSchema(schema);
  if (out.type !== "object") {
    return {
      type: "object",
      properties: isObj(out.properties) ? out.properties : {},
      ...(Array.isArray(out.required) ? { required: out.required } : {}),
    };
  }
  if (!isObj(out.properties)) out.properties = {};
  return out;
}
