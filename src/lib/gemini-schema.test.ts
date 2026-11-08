import { describe, it, expect } from "vitest";
import { toGeminiParameters, toGeminiSchema } from "./gemini-schema";

describe("toGeminiSchema", () => {
  it("inlines local $defs refs, including nested inside anyOf/items", () => {
    const out = toGeminiSchema({
      type: "object",
      properties: {
        filters: {
          type: "array",
          items: {
            anyOf: [{ $ref: "#/$defs/filter" }, { $ref: "#/$defs/group" }],
          },
        },
      },
      $defs: {
        filter: { type: "object", properties: { field: { type: "string" } } },
        group: { type: "object", properties: { op: { type: "string" } } },
      },
    });
    const items = (out.properties as Record<string, { items: { anyOf: unknown[] } }>)
      .filters.items;
    expect(items.anyOf).toEqual([
      { type: "object", properties: { field: { type: "string" } } },
      { type: "object", properties: { op: { type: "string" } } },
    ]);
    expect(JSON.stringify(out)).not.toContain("$ref");
    expect(JSON.stringify(out)).not.toContain("$defs");
  });

  it("maps oneOf to anyOf", () => {
    const out = toGeminiSchema({
      oneOf: [{ type: "string" }, { type: "number" }],
    });
    expect(out).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
  });

  it("merges allOf into a single object schema", () => {
    const out = toGeminiSchema({
      allOf: [
        {
          type: "object",
          properties: { a: { type: "string" } },
          required: ["a"],
        },
        {
          type: "object",
          properties: { b: { type: "number" } },
          required: ["b"],
        },
      ],
    });
    expect(out).toEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a", "b"],
    });
  });

  it("maps const to enum and type arrays to nullable", () => {
    const out = toGeminiSchema({
      type: "object",
      properties: {
        status: { const: "OPEN" },
        note: { type: ["string", "null"] },
        count: { type: ["integer", "string", "null"] },
      },
    });
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.status).toEqual({ enum: ["OPEN"] });
    expect(props.note).toEqual({ type: "string", nullable: true });
    expect(props.count).toEqual({
      nullable: true,
      anyOf: [{ type: "integer" }, { type: "string" }],
    });
  });

  it("drops keywords Gemini rejects", () => {
    const out = toGeminiSchema({
      type: "object",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Thing",
      default: {},
      examples: [],
      additionalProperties: false,
      properties: {
        a: { type: "string", default: "x", exclusiveMinimum: 0 },
      },
      not: { type: "null" },
      dependentSchemas: {},
      if: {},
      then: {},
    });
    const json = JSON.stringify(out);
    for (const banned of [
      "$schema",
      "$ref",
      "$defs",
      "definitions",
      "title",
      "default",
      "examples",
      "additionalProperties",
      "not",
      "dependentSchemas",
      "if",
      "then",
      "exclusiveMinimum",
    ]) {
      expect(json).not.toContain(`"${banned}"`);
    }
    expect(out).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
    });
  });

  it("stays safe on recursive refs", () => {
    const out = toGeminiSchema({
      type: "object",
      properties: {
        child: { $ref: "#/$defs/node" },
      },
      $defs: {
        node: {
          type: "object",
          properties: { next: { $ref: "#/$defs/node" } },
        },
      },
    });
    // the recursive edge degrades to a permissive object instead of looping
    const child = (out.properties as Record<string, unknown>).child as {
      type: string;
      properties: Record<string, unknown>;
    };
    expect(child.properties.next).toEqual({ type: "object" });
    expect(child.type).toBe("object");
  });

  it("converts tuple items into anyOf", () => {
    const out = toGeminiSchema({
      type: "array",
      items: [{ type: "string" }, { type: "number" }],
    });
    expect(out).toEqual({
      type: "array",
      items: { anyOf: [{ type: "string" }, { type: "number" }] },
    });
  });

  it("filters required down to surviving properties", () => {
    const out = toGeminiSchema({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a", "gone"],
    });
    expect(out.required).toEqual(["a"]);
  });
});

describe("toGeminiParameters", () => {
  it("always returns an object schema", () => {
    expect(toGeminiParameters(undefined)).toEqual({
      type: "object",
      properties: {},
    });
    expect(toGeminiParameters({ type: "array", items: { type: "string" } })).toEqual(
      { type: "object", properties: {} }
    );
  });

  it("sanitizes an AG-style deeply-nested tool schema end to end", () => {
    // mirrors the failing shape from the dev log:
    // properties -> anyOf -> properties -> items -> items -> anyOf -> $ref
    const out = toGeminiParameters({
      type: "object",
      properties: {
        spec: {
          anyOf: [
            {
              type: "object",
              properties: {
                filters: { type: "array", items: { $ref: "#/$defs/filter" } },
                sorts: {
                  type: "array",
                  items: { type: "array", items: { anyOf: [{ $ref: "#/$defs/dir" }] } },
                },
              },
            },
            { type: "null" },
          ],
        },
      },
      $defs: {
        filter: {
          type: "object",
          properties: { field: { const: "amount" }, op: { oneOf: [{ const: "gt" }] } },
        },
        dir: { type: "string", enum: ["asc", "desc"], default: "asc" },
      },
    });
    expect(JSON.stringify(out)).not.toContain("$ref");
    expect(JSON.stringify(out)).not.toContain("oneOf");
    expect(JSON.stringify(out)).not.toContain('"const"');
    expect(JSON.stringify(out)).not.toContain("default");
    expect(out.type).toBe("object");
  });
});
