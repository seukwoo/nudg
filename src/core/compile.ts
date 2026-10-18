// Validates a nudg file and compiles it into a Program. Every problem becomes a
// Diagnostic with a stable code, a JSON pointer, and a hint an AI can act on.

import { hexToOklab, isHexColor } from "./color.ts";
import { interpolate } from "./map.ts";
import { fromDurationBounce, fromStiffnessRatio } from "./spring.ts";
import type { Measure,
  Channels,
  Diagnostic,
  Ease,
  Follow,
  Machine,
  Timer,
  Motion,
  Program,
  Property,
  PropertyMap,
  PropertyKind,
  SpringMotion,
  State,
  Transition,
} from "./types.ts";
import { MEASUREMENTS,
  EVENT_ALIASES,
  EVENTS,
  EVENTS_0_2,
  HOST,
  IDENTIFIER,
  INPUTS,
  KEY_ALIASES,
  KEY_NAME,
  KEY_NAMES,
  NAMED_EASES,
  PROPERTIES,
  PROPERTY_ALIASES,
  VERSION,
  VERSIONS,
} from "./vocabulary.ts";

export interface Source {
  /** Used to resolve imports and to label diagnostics. */
  path: string;
  text: string;
}

/** Returns the file's text, or undefined if it doesn't exist. */
export type ReadFile = (path: string) => string | undefined;

export interface CompileResult {
  /** Present only when there are no errors. */
  program?: Program;
  /** Named motions this file defines or imports. */
  motions: Map<string, Motion>;
  diagnostics: Diagnostic[];
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface LibraryEntry {
  /** Undefined when the definition itself was invalid; avoids cascading errors. */
  motion?: Motion;
  origin: string;
}

const TOP_LEVEL_KEYS = ["$schema", "nudg", "import", "targets", "values", "motions", "animate", "initial", "states", "regions", "when"];
const MACHINE_KEYS = ["initial", "states", "regions"];
/** A region's object: a machine that may also have machine-level `when`. */
const REGION_KEYS = [...MACHINE_KEYS, "when"];
const STATE_KEYS = ["set", "follow", "enter", "when", ...MACHINE_KEYS];
const TRANSITION_KEYS = ["to", "nearest", "by", "momentum", "animate", "step", "commit"];
const VALUE_KEYS = ["base", "min", "max"];
const FOLLOW_KEYS = ["input", "range", "overdrag"];
const MAP_KEYS = ["map", "from", "to"];
const MOTION_KEYS = ["spring", "tween", "kick"];
const TWEEN_KEYS = ["duration", "ease"];
const SPRING_FORMS = [
  { keys: ["duration", "bounce"], required: ["duration"] },
  { keys: ["response", "dampingFraction"], required: ["response"] },
  { keys: ["stiffness", "dampingRatio"], required: ["stiffness", "dampingRatio"] },
  { keys: ["stiffness", "damping", "mass"], required: ["stiffness", "damping"] },
];
const SPRING_KEYS = [...new Set(SPRING_FORMS.flatMap((f) => f.keys))];
const EXAMPLE_SPRING = `{ "spring": { "duration": 0.3, "bounce": 0.2 } }`;

export function compile(source: Source, readFile?: ReadFile): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const cache = new Map<string, Map<string, LibraryEntry>>();
  const result = compileFile(source, { diagnostics, readFile, cache, stack: [normalizePath(source.path)] }, undefined);
  const motions = new Map<string, Motion>();
  for (const [name, entry] of result.library) if (entry.motion) motions.set(name, entry.motion);
  const failed = diagnostics.some((d) => d.severity === "error");
  return { program: failed ? undefined : result.program, motions, diagnostics };
}

interface Shared {
  diagnostics: Diagnostic[];
  readFile?: ReadFile;
  cache: Map<string, Map<string, LibraryEntry>>;
  stack: string[];
}

function compileFile(
  source: Source,
  shared: Shared,
  file: string | undefined,
): { program?: Program; library: Map<string, LibraryEntry> } {
  const r = new Reporter(shared.diagnostics, file);
  const library = new Map<string, LibraryEntry>();

  let doc: Json;
  try {
    doc = JSON.parse(source.text);
  } catch (e) {
    r.error("json-parse", "", `Not valid JSON: ${(e as Error).message}`, "nudg files are strict JSON: no comments, no trailing commas. Use a \"note\" field for comments.");
    return { library };
  }
  if (!isObject(doc)) {
    r.error("invalid-type", "", "A nudg file must be a JSON object.");
    return { library };
  }
  r.keys(doc, "", TOP_LEVEL_KEYS);
  if ("$schema" in doc && typeof doc.$schema !== "string") {
    r.error("invalid-type", "/$schema", "\"$schema\" must be a URL string.", "Use \"https://unpkg.com/@nudg/core/spec/nudg-0.5.schema.json\", or remove it.");
  }

  if (!("nudg" in doc)) {
    r.error("missing-version", "", "The file does not declare a format version.", `Add "nudg": "${VERSION}" at the top.`);
  } else if (typeof doc.nudg !== "string" || !VERSIONS.includes(doc.nudg)) {
    r.error("unsupported-version", "/nudg", `Format version ${JSON.stringify(doc.nudg)} is not supported.`, `This runtime reads versions ${VERSIONS.map((v) => `"${v}"`).join(" and ")}. Write it as a string, e.g. "nudg": "${VERSION}".`);
  }
  const version = typeof doc.nudg === "string" && VERSIONS.includes(doc.nudg) ? doc.nudg : VERSION;

  // Imports, then local motions.
  if ("import" in doc) {
    const imports = doc.import;
    if (!Array.isArray(imports) || imports.some((i) => typeof i !== "string")) {
      r.error("invalid-type", "/import", "\"import\" must be an array of file paths.", `For example: "import": ["./motion/brand.nudg.json"]`);
    } else {
      imports.forEach((imp, i) => {
        const entries = loadImport(source.path, imp as string, ptr("/import", i), shared, r);
        for (const [name, entry] of entries) addToLibrary(library, name, entry, ptr("/import", i), r);
      });
    }
  }
  const self = normalizePath(source.path);
  if ("motions" in doc) {
    const defs = doc.motions;
    if (!isObject(defs)) {
      r.error("invalid-type", "/motions", "\"motions\" must be an object of named motions.", `For example: "motions": { "snappy": ${EXAMPLE_SPRING} }`);
    } else {
      // Register names first so a definition error doesn't also produce unknown-motion errors.
      const local = new Map<string, Json>();
      for (const [name, def] of Object.entries(defs)) {
        if (name === "note" || name.startsWith("x-")) continue;
        const p = ptr("/motions", name);
        if (!IDENTIFIER.test(name)) {
          r.error("invalid-name", p, `"${name}" is not a valid motion name.`, "Use letters, digits, \"_\" and \"-\", starting with a letter.");
          continue;
        }
        local.set(name, def);
      }
      for (const [name, def] of local) {
        const motion = parseMotionObject(def, ptr("/motions", name), r);
        addToLibrary(library, name, { motion, origin: self }, ptr("/motions", name), r);
      }
    }
  }

  const hasMachine = "states" in doc || "regions" in doc || "initial" in doc || "when" in doc;
  const hasComponentKeys = hasMachine || "targets" in doc || "values" in doc || "animate" in doc;
  if (!hasComponentKeys) {
    if (!("motions" in doc) && !("import" in doc)) {
      r.warn("empty-file", "", "The file defines no machine and no motions.", "Add \"initial\" and \"states\" for a component, or \"motions\" for a library.");
    }
    return { library };
  }
  if (!hasMachine) {
    r.error("missing-machine", "", "The file has targets or values but no states.", "Add \"initial\" and \"states\", or remove \"targets\", \"values\" and \"animate\" to make this a motion library.");
  }

  const component = new ComponentCompiler(r, library, version);
  const program = component.compile(doc);
  return { program, library };
}

function loadImport(importer: string, spec: string, p: string, shared: Shared, r: Reporter): Map<string, LibraryEntry> {
  const path = normalizePath(joinPath(dirname(importer), spec));
  if (shared.stack.includes(path)) {
    r.error("import-cycle", p, `Importing "${spec}" creates a cycle: ${[...shared.stack, path].join(" → ")}.`, "Move the shared motions into a library that doesn't import back.");
    return new Map();
  }
  const cached = shared.cache.get(path);
  if (cached) return cached;
  if (!shared.readFile) {
    r.error("import-unavailable", p, `Can't load "${spec}": no file reader was provided.`, "Pass a readFile function to compile().");
    return new Map();
  }
  const text = shared.readFile(path);
  if (text === undefined) {
    r.error("import-not-found", p, `Imported file "${spec}" was not found (looked for ${path}).`, "Import paths are relative to the importing file.");
    return new Map();
  }
  shared.stack.push(path);
  const { library } = compileFile({ path, text }, shared, path);
  shared.stack.pop();
  shared.cache.set(path, library);
  return library;
}

function addToLibrary(library: Map<string, LibraryEntry>, name: string, entry: LibraryEntry, p: string, r: Reporter) {
  const existing = library.get(name);
  if (existing && existing.origin !== entry.origin) {
    r.error("duplicate-motion", p, `Motion "${name}" is defined in both ${existing.origin} and ${entry.origin}.`, "Give one of them a different name; nudg does not shadow names.");
    return;
  }
  library.set(name, entry);
}

class ComponentCompiler {
  private targets = new Set<string>();
  private usedTargets = new Set<string>();
  private properties = new Map<string, Property>();
  private r: Reporter;
  private library: Map<string, LibraryEntry>;
  private version: string;
  private versionReported = new Set<string>();

  constructor(r: Reporter, library: Map<string, LibraryEntry>, version: string) {
    this.r = r;
    this.library = library;
    this.version = version;
  }

  /** Reports (once per path) a feature newer than the file's format version. Returns false if it's not allowed. */
  private needsVersion(min: string, p: string, what: string): boolean {
    if (VERSIONS.indexOf(this.version) >= VERSIONS.indexOf(min)) return true;
    if (!this.versionReported.has(p)) {
      this.versionReported.add(p);
      this.r.error("needs-version", p, `${what} needs format ${min}.`, `Change "nudg" to "${min}" at the top of the file.`);
    }
    return false;
  }

  private needs02(p: string, what: string): boolean {
    return this.needsVersion("0.2", p, what);
  }

  private needs03(p: string, what: string): boolean {
    return this.needsVersion("0.3", p, what);
  }

  /** `{ "measure": "seg2.x" }` (v0.4): a value the host's layout report supplies. */
  private parseMeasure(kind: PropertyKind, key: string, raw: JsonObject, p: string): Measure | undefined {
    const r = this.r;
    if (!this.needsVersion("0.4", p, "A measured value")) return undefined;
    r.keys(raw, p, ["measure"]);
    if (kind === "color") {
      r.error("invalid-measure", p, `"${key}" is a color; layout measures positions and sizes.`, "Measure into a numeric property such as x, y, width or height.");
      return undefined;
    }
    const mp = ptr(p, "measure");
    const spec = raw.measure;
    const dot = typeof spec === "string" ? spec.lastIndexOf(".") : -1;
    if (typeof spec !== "string" || dot <= 0) {
      r.error("invalid-measure", mp, `${JSON.stringify(spec)} is not a measurement.`, `Write target.measurement, for example "seg2.x" or "content.naturalHeight".`);
      return undefined;
    }
    const target = spec.slice(0, dot);
    const of = spec.slice(dot + 1);
    if (!(MEASUREMENTS as readonly string[]).includes(of)) {
      const guess = didYouMean(of, [...MEASUREMENTS]);
      r.error("invalid-measure", mp, `"${of}" is not a measurement.`, guess ? `Did you mean "${target}.${guess}"? Measurements are ${MEASUREMENTS.join(", ")}.` : `Measurements are ${MEASUREMENTS.join(", ")}.`);
      return undefined;
    }
    if (!this.checkTarget(target, mp)) return undefined;
    const prop = key.split(".")[1];
    if ((of === "x" || of === "y") && prop !== of) {
      r.error(
        "invalid-measure",
        mp,
        `"${spec}" is a position, which aligns "${key.split(".")[0]}.${of}" with ${target}; it can't go into "${key}".`,
        prop === "x" || prop === "y" ? `Measure "${target}.${prop}" for "${key}".` : `Measure a size into "${key}", such as "${target}.${prop === "height" ? "height" : "width"}".`,
      );
      return undefined;
    }
    return { target, of: of as Measure["of"] };
  }

  compile(doc: JsonObject): Program | undefined {
    const r = this.r;
    this.parseTargets(doc.targets);
    this.parseValues(doc.values);
    const animate = "animate" in doc ? this.parseAnimate(doc.animate, "/animate") : new Map<string, Motion>();
    if ("when" in doc && "regions" in doc) {
      r.error("machine-when-regions", "/when", "\"when\" next to \"regions\" has no states to switch between.", "Put \"when\" inside the region whose states it switches.");
    }
    const machine = this.parseMachine(doc, "", true);

    for (const t of this.targets) {
      if (!this.usedTargets.has(t)) {
        r.warn("unused-target", ptr("/targets", [...this.targets].indexOf(t)), `Target "${t}" is declared but never used.`, "Remove it from \"targets\", or use it in a value or event.");
      }
    }
    if (!machine) return undefined;
    return { version: this.version, targets: [...this.targets], properties: this.properties, animate, machine };
  }

  private parseTargets(raw: Json | undefined) {
    const r = this.r;
    if (raw === undefined) {
      r.error("missing-targets", "", "The file does not list its targets.", "Add \"targets\": [\"knob\", \"track\"] with the names your values and events use.");
      return;
    }
    if (!Array.isArray(raw)) {
      r.error("invalid-type", "/targets", "\"targets\" must be an array of names.");
      return;
    }
    raw.forEach((t, i) => {
      const p = ptr("/targets", i);
      if (typeof t !== "string" || !IDENTIFIER.test(t)) {
        r.error("invalid-name", p, `${JSON.stringify(t)} is not a valid target name.`, "Use letters, digits, \"_\" and \"-\", starting with a letter.");
      } else if (t === HOST) {
        r.error("reserved-name", p, `"${HOST}" is reserved for events the app sends (host.<name>).`, "Give the target another name.");
      } else if (this.targets.has(t)) {
        r.error("duplicate-target", p, `Target "${t}" is listed twice.`, "Remove the duplicate.");
      } else {
        this.targets.add(t);
      }
    });
  }

  private parseValues(raw: Json | undefined) {
    const r = this.r;
    if (raw === undefined) return;
    if (!isObject(raw)) {
      r.error("invalid-type", "/values", "\"values\" must be an object mapping properties to base values.", `For example: "values": { "knob.x": 0 }`);
      return;
    }
    const maps: [string, JsonObject, string, PropertyKind][] = [];
    for (const [key, value] of Object.entries(raw)) {
      if (key === "note" || key.startsWith("x-")) continue;
      const p = ptr("/values", key);
      const kind = this.parsePropertyPath(key, p);
      if (!kind) continue;
      const placeholder = kind === "color" ? [0, 0, 0, 1] : [0];
      if (isObject(value) && "measure" in value) {
        this.properties.set(key, { kind, base: placeholder, measure: this.parseMeasure(kind, key, value, p) });
        continue;
      }
      if (isObject(value) && "map" in value) {
        // Mapped properties resolve after every plain base value is known.
        this.properties.set(key, { kind, base: placeholder, map: { source: "", sourceKind: "property", from: [], to: [] } });
        maps.push([key, value, p, kind]);
        continue;
      }
      if (isObject(value)) {
        this.properties.set(key, this.parseBounded(kind, key, value, p) ?? { kind, base: placeholder });
        continue;
      }
      // Register the property even if its value is invalid, so later uses don't cascade.
      const base = this.parseValue(kind, key, value, p) ?? placeholder;
      this.properties.set(key, { kind, base });
    }
    for (const [key, value, p, kind] of maps) this.parseMap(key, value, p, kind);
  }

  /** `{ "base": 0, "min": 0, "max": 200 }` (v0.3). */
  private parseBounded(kind: PropertyKind, key: string, raw: JsonObject, p: string): Property | undefined {
    const r = this.r;
    if (!this.needs03(p, "A value with bounds")) return undefined;
    r.keys(raw, p, VALUE_KEYS);
    if (!("base" in raw)) {
      r.error("missing-base", p, `"${key}" has bounds but no base value.`, `Add "base": <the value when no state sets it>, e.g. { "base": 0, "min": 0, "max": 200 }.`);
      return undefined;
    }
    const base = this.parseValue(kind, key, raw.base, ptr(p, "base"));
    if (!base) return undefined;
    const prop: Property = { kind, base };
    if (!("min" in raw) && !("max" in raw)) return prop;
    if (kind === "color") {
      r.error("invalid-bounds", p, "A color has no min or max.", "Bounds are for numeric properties such as x or opacity.");
      return prop;
    }
    for (const bound of ["min", "max"] as const) {
      if (!(bound in raw)) continue;
      const n = raw[bound];
      if (typeof n !== "number" || !Number.isFinite(n)) {
        r.error("invalid-bounds", p, `"${bound}" must be a number.`);
        return prop;
      }
      prop[bound] = n;
    }
    if (prop.min !== undefined && prop.max !== undefined && prop.min > prop.max) {
      r.error("invalid-bounds", p, `"min" (${prop.min}) is greater than "max" (${prop.max}).`, "Swap them.");
      delete prop.min;
      delete prop.max;
      return prop;
    }
    if ((prop.min !== undefined && base[0] < prop.min) || (prop.max !== undefined && base[0] > prop.max)) {
      r.error("out-of-range", p, `The base value ${base[0]} is outside [${prop.min ?? "-∞"}, ${prop.max ?? "∞"}].`, "Move the base inside the bounds, or widen them.");
    }
    return prop;
  }

  private parseMap(key: string, raw: JsonObject, p: string, kind: PropertyKind) {
    const r = this.r;
    if (!this.needs02(p, "A mapped value")) return;
    r.keys(raw, p, MAP_KEYS);
    const prop = this.properties.get(key)!;
    const source = raw.map;
    const sourceProp = typeof source === "string" ? this.properties.get(source) : undefined;
    let sourceKind: PropertyMap["sourceKind"] = "property";
    if (sourceProp) {
      if (sourceProp.map || sourceProp.kind === "color") {
        const reason = sourceProp.map ? "is itself mapped" : "is a color";
        r.error("invalid-map-source", ptr(p, "map"), `The map's source ${JSON.stringify(source)} ${reason}.`, "Map from a numeric property with its own base value, or from a continuous input in format 0.5.");
        return;
      }
      this.usedTargets.add((source as string).split(".")[0]);
    } else if (typeof source === "string" && this.looksLikeInput(source)) {
      if (!this.checkInput(source, ptr(p, "map"), ptr(p, "map"))) return;
      sourceKind = "input";
    } else {
      const reason = typeof source !== "string" ? "must name a property or input" : "has no base value";
      r.error("invalid-map-source", ptr(p, "map"), `The map's source ${JSON.stringify(source)} ${reason}.`, "Map from a numeric property in \"values\", or from an input such as \"host.volume\" in format 0.5.");
      return;
    }
    const from = raw.from;
    const to = raw.to;
    if (!Array.isArray(from) || from.length < 2 || from.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      r.error("invalid-map", ptr(p, "from"), "\"from\" must list at least two numbers on the source.", "For example: \"from\": [0, 20].");
      return;
    }
    const nums = from as number[];
    const rising = nums.every((n, i) => i === 0 || n > nums[i - 1]);
    const falling = nums.every((n, i) => i === 0 || n < nums[i - 1]);
    if (!rising && !falling) {
      r.error("invalid-map", ptr(p, "from"), "\"from\" must be strictly increasing or strictly decreasing.", "Remove repeated points and keep them in order.");
      return;
    }
    if (!Array.isArray(to) || to.length !== nums.length) {
      r.error("invalid-map", ptr(p, "to"), `"to" must list ${nums.length} values, one for each point in "from".`);
      return;
    }
    const channels: Channels[] = [];
    to.forEach((v, i) => {
      const c = this.parseValue(kind, key, v, ptr(ptr(p, "to"), i));
      if (c) channels.push(c);
    });
    if (channels.length !== to.length) return;
    const map: PropertyMap = { source: source as string, sourceKind, from: nums, to: channels };
    prop.map = map;
    prop.base = interpolate(map, sourceProp?.base[0] ?? 0);
  }

  /** Resolves a path used outside "values"; it must have a base value, and not be mapped. */
  private property(key: string, p: string): Property | undefined {
    const known = this.properties.get(key);
    if (known?.map) {
      this.usedTargets.add(key.split(".")[0]);
      this.r.error("mapped-property", p, `"${key}" is mapped from ${known.map.source || "another property"}, so it can't be set, animated, followed or kicked.`, `Change its source instead, or give "${key}" a plain base value in "values".`);
      return undefined;
    }
    if (known) {
      this.usedTargets.add(key.split(".")[0]);
      return known;
    }
    const kind = this.parsePropertyPath(key, p);
    if (kind) {
      this.r.error("missing-base-value", p, `"${key}" has no base value.`, `Add "${key}" to "values" with the value it has when no state sets it.`);
    }
    return undefined;
  }

  private parsePropertyPath(key: string, p: string): PropertyKind | undefined {
    const r = this.r;
    const parts = key.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      r.error("invalid-path", p, `"${key}" is not a property path.`, "Write properties as target.property, for example \"knob.x\".");
      return undefined;
    }
    const [target, prop] = parts;
    let ok = this.checkTarget(target, p);
    const kind = PROPERTIES[prop];
    if (!kind) {
      const alias = PROPERTY_ALIASES[prop];
      const guess = alias ?? didYouMean(prop, Object.keys(PROPERTIES));
      r.error(
        "unknown-property",
        p,
        `"${prop}" is not a nudg property.`,
        guess
          ? `Use "${target}.${guess}"${alias ? ` (nudg's name for ${prop})` : ""}.`
          : `Properties are ${Object.keys(PROPERTIES).join(", ")}.`,
      );
      ok = false;
    }
    return ok ? kind : undefined;
  }

  private checkTarget(target: string, p: string): boolean {
    if (this.targets.has(target)) {
      this.usedTargets.add(target);
      return true;
    }
    const guess = didYouMean(target, [...this.targets]);
    this.r.error(
      "unknown-target",
      p,
      `Target "${target}" is not declared.`,
      guess ? `Did you mean "${guess}"? Otherwise add "${target}" to "targets".` : `Add "${target}" to "targets".`,
    );
    return false;
  }

  private parseValue(kind: PropertyKind, key: string, raw: Json, p: string): Channels | undefined {
    const r = this.r;
    if (kind === "color") {
      if (isHexColor(raw)) return hexToOklab(raw);
      r.error("invalid-value", p, `${JSON.stringify(raw)} is not a color.`, "Use a hex color such as \"#4ADE80\" (#RGB, #RRGGBB or #RRGGBBAA).");
      return undefined;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) return [raw];
    if (kind === "length" && typeof raw === "string") {
      const m = /^(-?(?:\d+\.?\d*|\.\d+))(px|pt|dp|%)$/.exec(raw);
      if (m && m[2] !== "%") return [Number(m[1])];
      if (m) {
        r.error("unsupported-unit", p, "Percent units are not supported yet.", "Use logical units: a bare number, or \"px\", \"pt\", \"dp\".");
        return undefined;
      }
    }
    r.error(
      "invalid-value",
      p,
      `${JSON.stringify(raw)} is not a valid value for ${key}.`,
      kind === "length" ? "Use a number in logical units, such as 20 or \"20px\"." : "Use a plain number.",
    );
    return undefined;
  }

  private parseAnimate(raw: Json, p: string): Map<string, Motion> {
    const out = new Map<string, Motion>();
    if (!isObject(raw)) {
      this.r.error("invalid-type", p, "\"animate\" must map properties to motions.", `For example: "animate": { "knob.x": ${EXAMPLE_SPRING} }`);
      return out;
    }
    for (const [key, value] of Object.entries(raw)) {
      if (key === "note" || key.startsWith("x-")) continue;
      const kp = ptr(p, key);
      const prop = this.property(key, kp);
      const motion = this.motion(value, kp);
      if (!prop || !motion) continue;
      if (motion.kind === "spring" && motion.kick !== undefined) {
        this.r.error("kick-outside-enter", kp, "A kick can't be used in \"animate\".", "Kicks play when a state is entered. Move this motion to that state's \"enter\".");
        continue;
      }
      out.set(key, motion);
    }
    return out;
  }

  private parseEnter(raw: Json, p: string): Map<string, SpringMotion> {
    const out = new Map<string, SpringMotion>();
    if (!isObject(raw)) {
      this.r.error("invalid-type", p, "\"enter\" must map properties to kicks.", `For example: "enter": { "heart.scale": { "kick": 6, "spring": { "duration": 0.4, "bounce": 0.5 } } }`);
      return out;
    }
    for (const [key, value] of Object.entries(raw)) {
      if (key === "note" || key.startsWith("x-")) continue;
      const kp = ptr(p, key);
      const prop = this.property(key, kp);
      const motion = this.motion(value, kp);
      if (!prop || !motion) continue;
      if (motion.kind !== "spring" || motion.kick === undefined) {
        this.r.error("enter-without-kick", kp, "Motions in \"enter\" must have a kick.", "Add \"kick\" (velocity in units per second) next to the spring, or move this motion to \"animate\".");
        continue;
      }
      if (prop.kind === "color") {
        this.r.error("kick-on-color", kp, "A color can't be kicked.", "Kick a numeric property such as scale or x.");
        continue;
      }
      out.set(key, motion);
    }
    return out;
  }

  private motion(raw: Json, p: string): Motion | undefined {
    if (typeof raw === "string") {
      const entry = this.library.get(raw);
      if (entry) return entry.motion;
      const guess = didYouMean(raw, [...this.library.keys()]);
      this.r.error(
        "unknown-motion",
        p,
        `No motion named "${raw}".`,
        guess ? `Did you mean "${guess}"?` : "Define it under \"motions\", or import a library that does.",
      );
      return undefined;
    }
    return parseMotionObject(raw, p, this.r);
  }

  /** `ownWhen`: the object is a machine (top level or region), so its `when` is machine-level. */
  private parseMachine(obj: JsonObject, p: string, ownWhen = false): Machine | undefined {
    const r = this.r;
    const hasStates = "states" in obj;
    const hasRegions = "regions" in obj;
    if (hasStates && hasRegions) {
      r.error("machine-conflict", p, "Use either \"states\" or \"regions\" here, not both.", "To run states in parallel, put each group of states in its own region.");
      return undefined;
    }
    if (hasRegions) {
      if ("initial" in obj) r.error("initial-with-regions", ptr(p, "initial"), "Regions all start together, so they take no \"initial\".", "Remove \"initial\", or set it inside each region.");
      const raw = obj.regions;
      if (!isObject(raw) || Object.keys(raw).length === 0) {
        r.error("invalid-type", ptr(p, "regions"), "\"regions\" must be a non-empty object of named machines.");
        return undefined;
      }
      const regions = new Map<string, Machine>();
      for (const [name, region] of Object.entries(raw)) {
        if (name === "note" || name.startsWith("x-")) continue;
        const rp = ptr(ptr(p, "regions"), name);
        if (!IDENTIFIER.test(name)) r.error("invalid-name", rp, `"${name}" is not a valid region name.`, "Use letters, digits, \"_\" and \"-\", starting with a letter.");
        if (!isObject(region)) {
          r.error("invalid-type", rp, "A region must be an object with \"initial\" and \"states\".");
          continue;
        }
        r.keys(region, rp, REGION_KEYS);
        if (!("states" in region) && !("regions" in region)) {
          r.error("missing-states", rp, `Region "${name}" has no states.`, "Add \"initial\" and \"states\".");
          continue;
        }
        if ("when" in region && "regions" in region) {
          r.error("machine-when-regions", ptr(rp, "when"), "\"when\" next to \"regions\" has no states to switch between.", "Put \"when\" inside the region whose states it switches.");
        }
        const machine = this.parseMachine(region, rp, true);
        if (machine) regions.set(name, machine);
      }
      if (regions.size !== Object.keys(raw).filter((k) => k !== "note" && !k.startsWith("x-")).length) return undefined;
      this.checkRegionConflicts(regions, p);
      return { kind: "regions", regions };
    }
    if (!hasStates) {
      r.error("missing-states", p, "\"initial\" is set but there are no \"states\".", "Add \"states\".");
      return undefined;
    }

    const sp = ptr(p, "states");
    const raw = obj.states;
    if (!isObject(raw) || Object.keys(raw).length === 0) {
      r.error("invalid-type", sp, "\"states\" must be a non-empty object of named states.");
      return undefined;
    }
    const names = Object.keys(raw).filter((k) => k !== "note" && !k.startsWith("x-"));
    let ok = true;
    let initial = obj.initial;
    if (initial === undefined) {
      r.error("missing-initial", p, "There is no \"initial\" state.", `Add "initial": "${names[0]}".`);
      ok = false;
    } else if (typeof initial !== "string" || !names.includes(initial)) {
      const guess = typeof initial === "string" ? didYouMean(initial, names) : undefined;
      r.error("unknown-state", ptr(p, "initial"), `${JSON.stringify(initial)} is not one of the states here.`, guess ? `Did you mean "${guess}"?` : `States here are ${names.join(", ")}.`);
      ok = false;
    }

    const states = new Map<string, State>();
    for (const name of names) {
      const stp = ptr(sp, name);
      if (!IDENTIFIER.test(name)) {
        r.error("invalid-name", stp, `"${name}" is not a valid state name.`, "Use letters, digits, \"_\" and \"-\", starting with a letter.");
        ok = false;
      }
      const state = this.parseState(name, raw[name], stp);
      if (state) states.set(name, state);
      else ok = false;
    }

    const machineWhen = ownWhen && "when" in obj ? this.parseWhen(obj.when, ptr(p, "when"), true) : new Map<string, Transition>();

    // Transitions target sibling states (machine-level ones, this machine's states).
    const checkTargets = (when: Map<string, Transition>, wp: string, from?: string) => {
      for (const [event, transition] of when) {
        if (transition.to === undefined && !transition.nearest) continue;
        const targets: [string, string][] = transition.nearest
          ? transition.nearest.states.map((n, i) => [n, ptr(ptr(ptr(wp, event), "nearest"), i)])
          : [[transition.to!, ptr(wp, event)]];
        for (const [target, tp] of targets) {
          if (states.has(target)) continue;
          const guess = didYouMean(target, names);
          r.error(
            "unknown-state",
            tp,
            from ? `"${target}" is not a sibling state of "${from}".` : `"${target}" is not one of the states here.`,
            guess ? `Did you mean "${guess}"?` : `Transitions can target ${names.join(", ")}. Crossing levels is not supported yet.`,
          );
          ok = false;
        }
      }
    };
    for (const state of states.values()) {
      const wp = ptr(ptr(sp, state.name), "when");
      checkTargets(state.when, wp, state.name);
      checkTargets(new Map(state.timers.map((t) => [t.key, t.transition])), wp, state.name);
    }
    checkTargets(machineWhen, ptr(p, "when"));
    return ok ? { kind: "states", initial: initial as string, states, when: machineWhen } : undefined;
  }

  private parseState(name: string, raw: Json, p: string): State | undefined {
    const r = this.r;
    if (!isObject(raw)) {
      r.error("invalid-type", p, `State "${name}" must be an object.`, "Use {} for a state that sets nothing.");
      return undefined;
    }
    r.keys(raw, p, STATE_KEYS);
    const state: State = { name, set: new Map(), measure: new Map(), follow: new Map(), enter: new Map(), when: new Map(), timers: [] };

    if ("set" in raw) {
      const set = raw.set;
      if (!isObject(set)) {
        r.error("invalid-type", ptr(p, "set"), "\"set\" must map properties to values.");
      } else {
        for (const [key, value] of Object.entries(set)) {
          if (key === "note" || key.startsWith("x-")) continue;
          const kp = ptr(ptr(p, "set"), key);
          const prop = this.property(key, kp);
          if (!prop) continue;
          if (isObject(value) && "measure" in value) {
            const measure = this.parseMeasure(prop.kind, key, value, kp);
            if (!measure) continue;
            state.set.set(key, [0]);
            state.measure.set(key, measure);
            continue;
          }
          const channels = this.parseValue(prop.kind, key, value, kp);
          if (!channels) continue;
          if ((prop.min !== undefined && channels[0] < prop.min) || (prop.max !== undefined && channels[0] > prop.max)) {
            r.error("out-of-range", kp, `${channels[0]} is outside "${key}"'s bounds [${prop.min ?? "-∞"}, ${prop.max ?? "∞"}].`, "Use a value inside the bounds, or widen them in \"values\".");
            continue;
          }
          state.set.set(key, channels);
        }
      }
    }
    if ("follow" in raw) state.follow = this.parseFollow(raw.follow, ptr(p, "follow"), state);
    if ("enter" in raw) state.enter = this.parseEnter(raw.enter, ptr(p, "enter"));
    for (const key of state.enter.keys()) {
      if (state.follow.has(key)) r.error("follow-conflict", ptr(ptr(p, "enter"), key), `"${key}" is followed in this state, so it can't also be kicked here.`, "Remove the kick, or follow a different property.");
    }
    if ("when" in raw) state.when = this.parseWhen(raw.when, ptr(p, "when"), false, state.timers);
    if ("states" in raw || "regions" in raw || "initial" in raw) {
      const machine = this.parseMachine(raw, p);
      if (!machine) return undefined;
      state.machine = machine;
    }
    return state;
  }

  private parseWhen(raw: Json, wp: string, machineLevel: boolean, timers?: Timer[]): Map<string, Transition> {
    const out = new Map<string, Transition>();
    if (machineLevel && !this.needs02(wp, "\"when\" on a machine")) return out;
    if (!isObject(raw)) {
      this.r.error("invalid-type", wp, "\"when\" must map events to target states.", `For example: "when": { "track.tap": "on" }`);
      return out;
    }
    for (const [event, value] of Object.entries(raw)) {
      if (event === "note" || event.startsWith("x-")) continue;
      const ep = ptr(wp, event);
      if (event.startsWith("after:") || event === "after") {
        const transition = this.parseTransition(value, ep);
        const delay = this.parseAfter(event, ep, machineLevel);
        if (transition && delay !== undefined && timers) timers.push({ key: event, delay, transition });
        continue;
      }
      const okEvent = this.checkEvent(event, ep);
      const transition = this.parseTransition(value, ep);
      if (okEvent && transition) out.set(event, transition);
    }
    return out;
  }

  /** `after:<time>` (v0.3): seconds after the state was entered. */
  private parseAfter(key: string, p: string, machineLevel: boolean): number | undefined {
    const r = this.r;
    if (!this.needs03(p, "A timer (\"after:\")")) return undefined;
    if (machineLevel) {
      r.error("after-on-machine", p, "A timer can't be on a machine: \"after\" counts from entering one state.", "Put it in the \"when\" of the state it should time.");
      return undefined;
    }
    const delay = parseTime(key.slice("after:".length));
    if (delay === undefined || !key.startsWith("after:")) {
      r.error("invalid-after", p, `"${key}" is not a timer.`, `Write "after:<time>", e.g. "after:3s", "after:300ms" or "after:0.5".`);
      return undefined;
    }
    return delay;
  }

  private parseFollow(raw: Json, p: string, state: State): Map<string, Follow> {
    const r = this.r;
    const out = new Map<string, Follow>();
    if (!this.needs02(p, "\"follow\"")) return out;
    if (!isObject(raw)) {
      r.error("invalid-type", p, "\"follow\" must map properties to inputs.", `For example: "follow": { "knob.x": { "input": "track.drag.x", "range": [0, 20] } }`);
      return out;
    }
    for (const [key, value] of Object.entries(raw)) {
      if (key === "note" || key.startsWith("x-")) continue;
      const kp = ptr(p, key);
      const prop = this.property(key, kp);
      if (!prop) continue;
      if (prop.kind === "color") {
        r.error("follow-not-numeric", kp, "A color can't follow an input.", "Follow a numeric property, and map the color from it with \"map\".");
        continue;
      }
      if (state.set.has(key)) {
        r.error("follow-conflict", kp, `"${key}" is both set and followed in this state.`, "Remove it from \"set\"; while following, the input decides its value.");
        continue;
      }
      const spec: JsonObject | undefined = typeof value === "string" ? { input: value } : isObject(value) ? value : undefined;
      if (!spec) {
        r.error("invalid-type", kp, "A follow is an input name or an object with \"input\".", `For example: "track.drag.x" or { "input": "track.drag.x", "range": [0, 20], "overdrag": 0.3 }`);
        continue;
      }
      if (isObject(value)) r.keys(value, kp, FOLLOW_KEYS);
      if (!this.checkInput(spec.input, typeof value === "string" ? kp : ptr(kp, "input"), kp)) continue;
      const follow: Follow = { input: spec.input as string, overdrag: 0 };
      if (prop.min !== undefined && prop.max !== undefined) follow.range = [prop.min, prop.max];
      if ("range" in spec) {
        const range = spec.range;
        if (!Array.isArray(range) || range.length !== 2 || range.some((n) => typeof n !== "number" || !Number.isFinite(n)) || range[0] === range[1]) {
          r.error("invalid-value", ptr(kp, "range"), "\"range\" must be two different numbers.", "For example: \"range\": [0, 20].");
          continue;
        }
        const [a, b] = range as number[];
        follow.range = [Math.min(a, b), Math.max(a, b)];
      }
      if ("overdrag" in spec) {
        const o = spec.overdrag;
        if (typeof o !== "number" || !(o >= 0 && o <= 1)) {
          r.error("invalid-value", ptr(kp, "overdrag"), "\"overdrag\" must be a number from 0 (hard stop) to 1 (no resistance).", "0.3 feels like a rubber band.");
          continue;
        }
        follow.overdrag = o;
      }
      out.set(key, follow);
    }
    return out;
  }

  /** `p` locates the input name; `unknownAt` is where an unknown input is reported. */
  private checkInput(raw: Json | undefined, p: string, unknownAt: string): boolean {
    const parts = typeof raw === "string" ? raw.split(".") : [];
    const target = parts[0];
    const input = parts.slice(1).join(".");
    if (target === HOST && parts.length === 2 && IDENTIFIER.test(parts[1])) {
      return this.needsVersion("0.5", p, "An app input (host.<name>)");
    }
    if (input === "scroll.x" || input === "scroll.y") {
      if (!this.needsVersion("0.5", p, "A scroll input")) return false;
      return this.checkTarget(target, p);
    }
    if (INPUTS.includes(input)) return this.checkTarget(target, p);
    const options = target && this.targets.has(target)
      ? [...INPUTS.map((i) => `${target}.${i}`), `${target}.scroll.x`, `${target}.scroll.y`, "host.<name>"]
      : [...INPUTS.map((i) => `<target>.${i}`), "<target>.scroll.x", "<target>.scroll.y", "host.<name>"];
    this.r.error("unknown-input", unknownAt, `${JSON.stringify(raw)} is not an input.`, `Inputs are ${options.join(", ")}.`);
    return false;
  }

  private looksLikeInput(source: string): boolean {
    if (source.startsWith(`${HOST}.`)) return true;
    const parts = source.split(".");
    const input = parts.slice(1).join(".");
    return INPUTS.includes(input) || input.startsWith("scroll.");
  }

  private parseTransition(raw: Json, p: string): Transition | undefined {
    const r = this.r;
    if (typeof raw === "string") return { to: raw, animate: new Map() };
    if (!isObject(raw)) {
      r.error("invalid-type", p, "A transition is a state name or an object with \"to\" or \"nearest\".", `For example: "on" or { "to": "on", "animate": { ... } }`);
      return undefined;
    }
    r.keys(raw, p, TRANSITION_KEYS);
    const animate = "animate" in raw ? this.parseAnimate(raw.animate, ptr(p, "animate")) : new Map<string, Motion>();
    if ("nearest" in raw) {
      if (!this.needs02(p, "\"nearest\"")) return undefined;
      if ("to" in raw) {
        r.error("transition-conflict", p, "A transition has either \"to\" or \"nearest\", not both.");
        return undefined;
      }
      const states = raw.nearest;
      if (!Array.isArray(states) || states.length === 0 || states.some((n) => typeof n !== "string")) {
        r.error("invalid-type", ptr(p, "nearest"), "\"nearest\" must list state names.", `For example: "nearest": ["off", "on"]`);
        return undefined;
      }
      const by = raw.by;
      const byProp = typeof by === "string" ? this.properties.get(by) : undefined;
      if (typeof by !== "string" || !byProp || byProp.kind === "color" || byProp.map) {
        r.error("invalid-by", ptr(p, "by"), `"by" must name a numeric property with its own base value${typeof by === "string" ? `, and ${JSON.stringify(by)} isn't one` : ""}.`, "Use the property the candidate states set, such as \"knob.x\".");
        return undefined;
      }
      this.usedTargets.add(by.split(".")[0]);
      let momentum = 0.5;
      if ("momentum" in raw) {
        const m = raw.momentum;
        if (typeof m !== "number" || !(m >= 0)) {
          r.error("invalid-value", ptr(p, "momentum"), "\"momentum\" must be seconds of projection, 0 or more.", "0.5 (the default) suits most throws; 0 uses position only.");
          return undefined;
        }
        momentum = m;
      }
      return { nearest: { states: states as string[], by, momentum }, animate };
    }
    for (const key of ["by", "momentum"]) {
      if (key in raw) r.error("unknown-key", ptr(p, key), `"${key}" only goes with "nearest".`, "Add \"nearest\", or remove it.");
    }
    const transition: Transition = { animate };
    if ("step" in raw) transition.step = this.parseStep(raw.step, ptr(p, "step"));
    if ("commit" in raw) transition.commit = this.parseCommit(raw.commit, ptr(p, "commit"));
    if (typeof raw.to === "string") transition.to = raw.to;
    else if (!("step" in raw) && !("commit" in raw)) {
      r.error("missing-to", p, "The transition has no \"to\" state.", "Add \"to\": \"<state name>\", or \"nearest\": [...] with \"by\".");
      return undefined;
    } else if ("to" in raw) {
      r.error("invalid-type", ptr(p, "to"), "\"to\" must be a state name.");
      return undefined;
    }
    return transition;
  }

  /** `"step": { "thumb.x": 10 }` (v0.3): adds to a property's base value. */
  private parseStep(raw: Json, p: string): Map<string, number> | undefined {
    const r = this.r;
    if (!this.needs03(p, "\"step\"")) return undefined;
    const out = new Map<string, number>();
    if (!isObject(raw)) {
      r.error("invalid-type", p, "\"step\" must map properties to amounts.", `For example: "step": { "thumb.x": 10 }`);
      return undefined;
    }
    for (const [key, value] of Object.entries(raw)) {
      if (key === "note" || key.startsWith("x-")) continue;
      const kp = ptr(p, key);
      const prop = this.property(key, kp);
      if (!prop) continue;
      if (prop.kind === "color") {
        r.error("invalid-step", kp, "A color can't be stepped.", "Step a numeric property such as x or opacity.");
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        r.error("invalid-value", kp, "The step amount must be a number.", "Negative steps down.");
        continue;
      }
      out.set(key, value);
    }
    return out;
  }

  /** `"commit": ["thumb.x"]` (v0.3): the property's current value becomes its base. */
  private parseCommit(raw: Json, p: string): string[] | undefined {
    const r = this.r;
    if (!this.needs03(p, "\"commit\"")) return undefined;
    if (!Array.isArray(raw) || raw.some((k) => typeof k !== "string")) {
      r.error("invalid-type", p, "\"commit\" must list property paths.", `For example: "commit": ["thumb.x"]`);
      return undefined;
    }
    const out: string[] = [];
    (raw as string[]).forEach((key, i) => {
      const kp = ptr(p, i);
      const prop = this.property(key, kp);
      if (!prop) return;
      if (prop.kind === "color") {
        r.error("invalid-commit", kp, "A color can't be committed.", "Commit a numeric property such as x.");
        return;
      }
      out.push(key);
    });
    return out;
  }

  private checkEvent(key: string, p: string): boolean {
    const r = this.r;
    const parts = key.split(".");
    if (parts.length === 3 && parts[1] === "key") {
      // target.key.<name> (v0.3)
      if (!this.needs03(p, "A key event")) return false;
      const [target, , name] = parts;
      const ok = this.checkTarget(target, p);
      if (KEY_NAMES.includes(name) || KEY_NAME.test(name)) return ok;
      const alias = KEY_ALIASES[name] ?? KEY_ALIASES[name.toLowerCase()];
      const lower = name.toLowerCase();
      const guess = alias ?? (KEY_NAMES.includes(lower) || KEY_NAME.test(lower) ? lower : didYouMean(lower, KEY_NAMES));
      r.error(
        "invalid-event",
        p,
        `"${name}" is not a key name.`,
        guess
          ? `Use "${target}.key.${guess}".`
          : name.includes("+")
            ? "Keys have no modifiers; use the key alone, e.g. \"key.a\"."
            : `Key names are the lowercase KeyboardEvent.key values: ${KEY_NAMES.join(", ")}, single characters, f1–f12.`,
      );
      return false;
    }
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      r.error("invalid-event", p, `"${key}" is not an event.`, "Write events as target.event, for example \"track.tap\" or \"thumb.key.arrowright\".");
      return false;
    }
    const [target, event] = parts;
    if (target === HOST) {
      if (!this.needs02(p, "A host event")) return false;
      if (!IDENTIFIER.test(event)) {
        r.error("invalid-event", p, `"${event}" is not a valid host event name.`, "Use letters, digits, \"_\" and \"-\", starting with a letter.");
        return false;
      }
      return true;
    }
    let ok = this.checkTarget(target, p);
    if (EVENTS_0_2.includes(event) && !this.needs02(p, `The "${event}" event`)) ok = false;
    if (!(EVENTS as readonly string[]).includes(event)) {
      const alias = EVENT_ALIASES[event] ?? EVENT_ALIASES[event.toLowerCase()];
      const guess = alias ?? didYouMean(event, [...EVENTS]);
      r.error("unknown-event", p, `"${event}" is not a nudg event.`, guess ? `Use "${target}.${guess}".` : `Events are ${EVENTS.join(", ")}.`);
      ok = false;
    }
    return ok;
  }

  private checkRegionConflicts(regions: Map<string, Machine>, p: string) {
    const seen = new Map<string, string>();
    for (const [name, machine] of regions) {
      for (const key of settable(machine)) {
        const other = seen.get(key);
        if (other) {
          this.r.error("region-conflict", ptr(ptr(p, "regions"), name), `Regions "${other}" and "${name}" both set "${key}".`, "Parallel regions must set different properties. Move the property into one region, or split it (for example scale and x).");
        } else {
          seen.set(key, name);
        }
      }
    }
  }
}

function settable(machine: Machine): Set<string> {
  const out = new Set<string>();
  const children = machine.kind === "states" ? [...machine.states.values()] : [];
  for (const state of children) {
    for (const key of state.set.keys()) out.add(key);
    for (const key of state.follow.keys()) out.add(key);
    if (state.machine) for (const key of settable(state.machine)) out.add(key);
  }
  if (machine.kind === "regions") for (const m of machine.regions.values()) for (const key of settable(m)) out.add(key);
  return out;
}

function parseMotionObject(raw: Json, p: string, r: Reporter): Motion | undefined {
  if (!isObject(raw)) {
    r.error("invalid-type", p, "A motion is a motion name or an object with \"spring\" or \"tween\".", `For example: ${EXAMPLE_SPRING}`);
    return undefined;
  }
  r.keys(raw, p, MOTION_KEYS);
  if ("spring" in raw && "tween" in raw) {
    r.error("motion-conflict", p, "A motion has either \"spring\" or \"tween\", not both.");
    return undefined;
  }
  let kick: number | undefined;
  if ("kick" in raw) {
    if (typeof raw.kick !== "number" || !Number.isFinite(raw.kick)) {
      r.error("invalid-value", ptr(p, "kick"), "\"kick\" must be a number (velocity in units per second).");
      return undefined;
    }
    if (!("spring" in raw)) {
      r.error("kick-needs-spring", p, "A kick needs a spring to carry the value back.", `Add "spring": { "duration": 0.4, "bounce": 0.5 }.`);
      return undefined;
    }
    kick = raw.kick;
  }
  if ("spring" in raw) {
    const spring = parseSpring(raw.spring, ptr(p, "spring"), r);
    if (!spring) return undefined;
    return kick === undefined ? spring : { ...spring, kick };
  }
  if ("tween" in raw) return parseTween(raw.tween, ptr(p, "tween"), r);
  r.error("missing-motion-kind", p, "The motion has neither \"spring\" nor \"tween\".", `For example: ${EXAMPLE_SPRING}`);
  return undefined;
}

function parseSpring(raw: Json, p: string, r: Reporter): SpringMotion | undefined {
  if (!isObject(raw)) {
    r.error("invalid-type", p, "\"spring\" must be an object.", `For example: "spring": { "duration": 0.3, "bounce": 0.2 }`);
    return undefined;
  }
  if ("tension" in raw || "friction" in raw) {
    r.error(
      "spring-ambiguous-form",
      p,
      "\"tension\" and \"friction\" mean different things in different tools, so nudg doesn't guess.",
      "If the numbers come from a tool that treats them as stiffness and damping (mass 1), write \"stiffness\" and \"damping\" with the same numbers. Otherwise convert them, or describe the feel with \"duration\" + \"bounce\".",
    );
    return undefined;
  }
  r.keys(raw, p, SPRING_KEYS);
  const present = Object.keys(raw).filter((k) => SPRING_KEYS.includes(k));
  const candidates = SPRING_FORMS.filter((f) => present.every((k) => f.keys.includes(k)));
  if (candidates.length === 0) {
    r.error("spring-mixed-forms", p, `These spring parameters belong to different forms: ${present.join(", ")}.`, `Use one form: ${SPRING_FORMS.map((f) => f.keys.join(" + ")).join("; or ")}.`);
    return undefined;
  }
  const form = candidates.find((f) => f.required.every((k) => present.includes(k)));
  if (!form) {
    const missing = candidates[0].required.filter((k) => !present.includes(k));
    r.error("spring-incomplete", p, `The spring is missing ${missing.join(" and ")}.`, `Add ${missing.map((k) => `"${k}"`).join(" and ")}, or use the default form: "duration" + "bounce".`);
    return undefined;
  }

  let ok = true;
  const num = (key: string, check: (n: number) => boolean, rule: string, fallback?: number): number => {
    if (!(key in raw)) return fallback as number;
    const v = raw[key];
    const n = key === "duration" || key === "response" ? parseTime(v) : typeof v === "number" ? v : undefined;
    if (n === undefined || !Number.isFinite(n) || !check(n)) {
      r.error("invalid-value", ptr(p, key), `"${key}" ${rule}.`, key === "duration" || key === "response" ? "Use seconds (0.3) or a string like \"300ms\"." : undefined);
      ok = false;
      return NaN;
    }
    return n;
  };
  const positive = (n: number) => n > 0;

  let params: Omit<SpringMotion, "kind">;
  if (form === SPRING_FORMS[0]) {
    const duration = num("duration", positive, "must be greater than 0");
    const bounce = num("bounce", (n) => n < 1, "must be below 1 (0 is no overshoot; negative is overdamped)", 0);
    params = fromDurationBounce(duration, bounce);
  } else if (form === SPRING_FORMS[1]) {
    const response = num("response", positive, "must be greater than 0");
    const fraction = num("dampingFraction", positive, "must be greater than 0", 1);
    params = fromDurationBounce(response, 1 - fraction);
  } else if (form === SPRING_FORMS[2]) {
    params = fromStiffnessRatio(num("stiffness", positive, "must be greater than 0"), num("dampingRatio", positive, "must be greater than 0"));
  } else {
    params = {
      stiffness: num("stiffness", positive, "must be greater than 0"),
      damping: num("damping", positive, "must be greater than 0"),
      mass: num("mass", positive, "must be greater than 0", 1),
    };
  }
  return ok ? { kind: "spring", ...params } : undefined;
}

function parseTween(raw: Json, p: string, r: Reporter): Motion | undefined {
  if (!isObject(raw)) {
    r.error("invalid-type", p, "\"tween\" must be an object.", `For example: "tween": { "duration": 0.2, "ease": "out" }`);
    return undefined;
  }
  r.keys(raw, p, TWEEN_KEYS);
  if (!("duration" in raw)) {
    r.error("missing-duration", p, "The tween has no \"duration\".", "Add \"duration\" in seconds, for example 0.2.");
    return undefined;
  }
  const duration = parseTime(raw.duration);
  if (duration === undefined) {
    r.error("invalid-value", ptr(p, "duration"), "\"duration\" must be a time of 0 or more.", "Use seconds (0.2) or a string like \"200ms\".");
    return undefined;
  }
  let ease: Ease = NAMED_EASES["in-out"];
  if ("ease" in raw) {
    const parsed = parseEase(raw.ease, ptr(p, "ease"), r);
    if (!parsed) return undefined;
    ease = parsed;
  }
  return { kind: "tween", duration, ease };
}

function parseEase(raw: Json, p: string, r: Reporter): Ease | undefined {
  if (typeof raw === "string") {
    const named = NAMED_EASES[raw];
    if (named) return named;
    // Common spellings from CSS and animation libraries.
    const normalized = raw.replace(/^ease-?/i, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() || "in-out";
    const guess = NAMED_EASES[normalized] ? normalized : didYouMean(raw, Object.keys(NAMED_EASES));
    r.error("unknown-ease", p, `"${raw}" is not a nudg ease.`, guess ? `Use "${guess}".` : `Eases are ${Object.keys(NAMED_EASES).join(", ")}, or a cubic Bézier [x1, y1, x2, y2].`);
    return undefined;
  }
  if (Array.isArray(raw) && raw.length === 4 && raw.every((n) => typeof n === "number" && Number.isFinite(n))) {
    const [x1, y1, x2, y2] = raw as number[];
    if (x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1) return [x1, y1, x2, y2];
    r.error("invalid-value", p, "Bézier x values must be between 0 and 1.", "Keep x1 and x2 (the first and third numbers) in [0, 1].");
    return undefined;
  }
  r.error("invalid-value", p, "\"ease\" must be a name or a cubic Bézier [x1, y1, x2, y2].", `Eases are ${Object.keys(NAMED_EASES).join(", ")}.`);
  return undefined;
}

/** Seconds from a bare number or "300ms" / "0.3s". */
function parseTime(raw: Json | undefined): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const m = /^(\d+\.?\d*|\.\d+)(ms|s)$/.exec(raw);
  if (!m) return undefined;
  return m[2] === "ms" ? Number(m[1]) / 1000 : Number(m[1]);
}

class Reporter {
  private diagnostics: Diagnostic[];
  private file?: string;

  constructor(diagnostics: Diagnostic[], file?: string) {
    this.diagnostics = diagnostics;
    this.file = file;
  }

  error(code: string, path: string, message: string, hint?: string) {
    this.push("error", code, path, message, hint);
  }

  warn(code: string, path: string, message: string, hint?: string) {
    this.push("warning", code, path, message, hint);
  }

  /** Reports unknown keys, allowing "note" and "x-" extensions everywhere. */
  keys(obj: JsonObject, path: string, allowed: string[]) {
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith("x-")) continue;
      if (key === "note") {
        if (typeof value !== "string") this.error("invalid-type", ptr(path, key), "\"note\" must be a string.");
        continue;
      }
      if (allowed.includes(key)) continue;
      const guess = didYouMean(key, allowed);
      this.error(
        "unknown-key",
        ptr(path, key),
        `Unknown key "${key}".`,
        guess ? `Did you mean "${guess}"?` : `Allowed here: ${allowed.join(", ")}, note. Prefix extensions with "x-".`,
      );
    }
  }

  private push(severity: Diagnostic["severity"], code: string, path: string, message: string, hint?: string) {
    const d: Diagnostic = { severity, code, message, path };
    if (this.file) d.file = this.file;
    if (hint) d.hint = hint;
    this.diagnostics.push(d);
  }
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ptr(base: string, key: string | number): string {
  return `${base}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

/** The closest candidate within a small edit distance, if any. */
export function didYouMean(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  const lower = input.toLowerCase();
  for (const c of candidates) {
    const d = c.toLowerCase() === lower ? 0 : editDistance(lower, c.toLowerCase());
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return bestDistance <= Math.max(1, Math.floor(input.length / 3)) ? best : undefined;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// Minimal POSIX path helpers; the core doesn't depend on a platform's path module.
function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "." : path.slice(0, i) || "/";
}

function joinPath(base: string, rel: string): string {
  return rel.startsWith("/") ? rel : `${base}/${rel}`;
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length && out[out.length - 1] !== "..") out.pop();
    else if (part === ".." && absolute) continue;
    else out.push(part);
  }
  return (absolute ? "/" : "") + (out.join("/") || ".");
}
