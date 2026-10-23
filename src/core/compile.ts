// Validates a nudg file and compiles it into a Program. Every problem becomes a
// Diagnostic with a stable code, a JSON pointer, and a hint an AI can act on.

import { hexToOklab, isHexColor } from "./color.ts";
import { interpolate } from "./map.ts";
import { fromDurationBounce, fromStiffnessRatio } from "./spring.ts";
import type { Measure,
  MeasuredEndpoint,
  Channels,
  Diagnostic,
  Ease,
  EntryEffect,
  Follow,
  HostDeclaration,
  KeyframesEffect,
  Loop,
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
  EVENTS_0_14,
  EVENTS_0_15,
  CROSSING,
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

const TOP_LEVEL_KEYS = ["$schema", "nudg", "import", "host", "targets", "values", "motions", "animate", "initial", "states", "regions", "when"];
const MACHINE_KEYS = ["initial", "states", "regions"];
/** A region's object: a machine that may also have machine-level `when`. */
const REGION_KEYS = [...MACHINE_KEYS, "when"];
const STATE_KEYS = ["set", "follow", "enter", "loop", "when", ...MACHINE_KEYS];
const TRANSITION_KEYS = ["to", "nearest", "by", "momentum", "animate", "step", "commit"];
const VALUE_KEYS = ["base", "min", "max"];
const FOLLOW_KEYS = ["input", "range", "overdrag"];
const MAP_KEYS = ["map", "from", "to"];
const MOTION_KEYS = ["spring", "tween", "kick", "delay"];
const KEYFRAMES_KEYS = ["keyframes", "duration", "ease"];
const LOOP_KEYS = ["to", "keyframes", "duration", "ease", "delay", "wrap"];
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
    r.error("invalid-type", "/$schema", "\"$schema\" must be a URL string.", "Use \"https://unpkg.com/@nudg/core/spec/nudg-0.15.schema.json\", or remove it.");
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
        let motion = parseMotionObject(def, ptr("/motions", name), r);
        if (motion?.delay !== undefined) {
          r.error("delay-outside-animate", ptr(ptr("/motions", name), "delay"), "A delay belongs to one transition's choreography, not to a named motion.", `Remove it here, and write it where the motion is used: "animate": { "panel.height": { "spring": { ... }, "delay": 0.08 } }.`);
          motion = undefined;
        }
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
  /** The declared host interface (v0.13), and the names the file actually uses. */
  private host?: HostDeclaration;
  private usedHost = new Set<string>();
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

  /** `{ "measure": "sheet.height", "times": 0.5, "plus": -16 }` (v0.6). */
  private parseMeasure(kind: PropertyKind, key: string, raw: JsonObject, p: string): Measure | undefined {
    const r = this.r;
    if (!this.needsVersion("0.4", p, "A measured value")) return undefined;
    r.keys(raw, p, ["measure", "times", "plus"]);
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
    let times = 1;
    let plus = 0;
    for (const field of ["times", "plus"] as const) {
      if (!(field in raw)) continue;
      const fp = ptr(p, field);
      if (!this.needsVersion("0.6", fp, `Measurement ${field}`)) continue;
      const value = raw[field];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        r.error("invalid-measure-arithmetic", fp, `"${field}" must be a finite number.`, field === "times" ? "Use 0.5 for half, -1 to reverse, or omit it for 1." : "Use a logical-unit offset such as -16, or omit it for 0.");
        continue;
      }
      if (field === "times") times = value;
      else plus = value;
    }
    return { target, of: of as Measure["of"], times, plus };
  }

  /** A numeric endpoint, or a v0.9 measurement resolved in the endpoint property's coordinates. */
  private parseEndpoint(kind: PropertyKind, key: string, raw: Json, p: string, code: string, message: string): MeasuredEndpoint | undefined {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (isObject(raw) && "measure" in raw) {
      if (!this.needsVersion("0.9", p, "A measured endpoint")) return undefined;
      return this.parseMeasure(kind, key, raw, p);
    }
    this.r.error(code, p, message, "Use a finite number or a measure object such as { \"measure\": \"action.width\", \"times\": -1 }.");
    return undefined;
  }

  compile(doc: JsonObject): Program | undefined {
    const r = this.r;
    if ("host" in doc) this.parseHost(doc.host);
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
    if (this.host) {
      this.host.events.forEach((name, i) => {
        if (!this.usedHost.has(`event:${name}`)) r.warn("unused-host-event", ptr(ptr("/host", "events"), i), `The file declares host.${name} but no transition uses it.`, "Remove it, or handle it in a \"when\".");
      });
      for (const name of this.host.inputs.keys()) {
        if (!this.usedHost.has(`input:${name}`)) r.warn("unused-host-input", ptr(ptr("/host", "inputs"), name), `The file declares host.${name} but no map or follow reads it.`, "Remove it, or read it with \"map\" or \"follow\".");
      }
    }
    if (!machine) return undefined;
    return { version: this.version, targets: [...this.targets], ...(this.host ? { host: this.host } : {}), properties: this.properties, animate, machine };
  }

  private parseHost(raw: Json) {
    const r = this.r;
    if (!this.needsVersion("0.13", "/host", "\"host\"")) return;
    if (!isObject(raw)) {
      r.error("invalid-type", "/host", "\"host\" must be an object with \"events\" and \"inputs\".", `For example: "host": { "events": ["show", "hide"], "inputs": { "volume": { "range": [0, 1] } } }`);
      return;
    }
    r.keys(raw, "/host", ["events", "inputs"]);
    const host: HostDeclaration = { events: [], inputs: new Map() };
    const name = (value: Json, p: string, seen: (n: string) => boolean): string | undefined => {
      const bare = typeof value === "string" && value.startsWith(`${HOST}.`) ? value.slice(HOST.length + 1) : value;
      if (typeof bare !== "string" || !IDENTIFIER.test(bare)) {
        r.error("invalid-name", p, `${JSON.stringify(value)} is not a host name.`, "Write the name without \"host.\": letters, digits, \"_\" and \"-\", starting with a letter.");
        return undefined;
      }
      if (bare !== value) r.warn("host-prefix", p, `"${value}" is declared under "host" already.`, `Write "${bare}".`);
      if (seen(bare)) {
        r.error("duplicate-host-name", p, `host.${bare} is declared twice.`, "Remove the duplicate.");
        return undefined;
      }
      return bare;
    };
    if ("events" in raw) {
      if (!Array.isArray(raw.events)) r.error("invalid-type", "/host/events", "\"events\" must list event names.", `For example: "events": ["show", "hide"].`);
      else raw.events.forEach((value, i) => {
        const n = name(value, ptr("/host/events", i), (x) => host.events.includes(x));
        if (n) host.events.push(n);
      });
    }
    if ("inputs" in raw) {
      if (!isObject(raw.inputs)) r.error("invalid-type", "/host/inputs", "\"inputs\" must map input names to what they carry.", `For example: "inputs": { "volume": { "range": [0, 1], "note": "microphone level" } }.`);
      else for (const [key, spec] of Object.entries(raw.inputs)) {
        if (key === "note" || key.startsWith("x-")) continue;
        const p = ptr("/host/inputs", key);
        const n = name(key, p, (x) => host.inputs.has(x));
        if (!n) continue;
        if (!isObject(spec)) {
          r.error("invalid-type", p, "A host input is an object, {} when there is nothing to say.", `For example: { "range": [0, 1], "note": "download progress" }.`);
          continue;
        }
        r.keys(spec, p, ["range"]);
        const entry: { range?: [number, number] } = {};
        if ("range" in spec) {
          const range = spec.range;
          if (!Array.isArray(range) || range.length !== 2 || !range.every((v) => typeof v === "number" && Number.isFinite(v)) || (range[0] as number) >= (range[1] as number)) {
            // Still declared, so uses of it don't add errors of their own.
            r.error("invalid-value", ptr(p, "range"), "\"range\" must be two increasing numbers.", "For example: [0, 1].");
          } else {
            entry.range = [range[0] as number, range[1] as number];
          }
        }
        host.inputs.set(n, entry);
      }
    }
    this.host = host;
  }

  /** With a declared host (v0.13), only declared names are accepted. */
  private checkDeclared(kind: "event" | "input", bare: string, p: string): boolean {
    if (!this.host) return true;
    const declared = kind === "event" ? this.host.events : [...this.host.inputs.keys()];
    if (declared.includes(bare)) {
      this.usedHost.add(`${kind}:${bare}`);
      return true;
    }
    const guess = didYouMean(bare, declared);
    this.r.error(
      `undeclared-host-${kind}`,
      p,
      `host.${bare} is not declared under "host".`,
      guess ? `Did you mean "host.${guess}"? If not, add "${bare}" to host.${kind}s.` : `Add "${bare}" to host.${kind}s, or check the name the app ${kind === "event" ? "sends" : "supplies"}.`,
    );
    return false;
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
    if (!Array.isArray(from) || from.length < 2) {
      r.error("invalid-map", ptr(p, "from"), "\"from\" must list at least two points on the source.", "For example: \"from\": [0, 20].");
      return;
    }
    const endpointKind = sourceProp?.kind ?? kind;
    const endpointKey = sourceProp ? (source as string) : key;
    const points: MeasuredEndpoint[] = [];
    from.forEach((value, i) => {
      const point = this.parseEndpoint(endpointKind, endpointKey, value, ptr(ptr(p, "from"), i), "invalid-map", "A map endpoint must be a finite number or measure object.");
      if (point !== undefined) points.push(point);
    });
    if (points.length !== from.length) return;
    const declared = sourceKind === "input" && typeof source === "string" ? this.host?.inputs.get(source.slice(HOST.length + 1))?.range : undefined;
    if (declared) {
      points.forEach((point, i) => {
        if (typeof point === "number" && (point < declared[0] || point > declared[1])) {
          r.warn("outside-input-range", ptr(ptr(p, "from"), i), `${point} is outside the range ${JSON.stringify(declared)} declared for ${source}.`, "The app never sends this value; map within the declared range, or correct the range.");
        }
      });
    }
    const nums = points.every((point) => typeof point === "number") ? (points as number[]) : undefined;
    if (nums) {
      const rising = nums.every((n, i) => i === 0 || n > nums[i - 1]);
      const falling = nums.every((n, i) => i === 0 || n < nums[i - 1]);
      if (!rising && !falling) {
        r.error("invalid-map", ptr(p, "from"), "\"from\" must be strictly increasing or strictly decreasing.", "Remove repeated points and keep them in order.");
        return;
      }
    }
    if (!Array.isArray(to) || to.length !== points.length) {
      r.error("invalid-map", ptr(p, "to"), `"to" must list ${points.length} values, one for each point in "from".`);
      return;
    }
    const values: (Channels | Measure)[] = [];
    to.forEach((v, i) => {
      const vp = ptr(ptr(p, "to"), i);
      if (isObject(v) && "measure" in v) {
        if (!this.needsVersion("0.11", vp, "A measured map value")) return;
        const m = this.parseMeasure(kind, key, v, vp);
        if (m) values.push(m);
        return;
      }
      const c = this.parseValue(kind, key, v, vp);
      if (c) values.push(c);
    });
    if (values.length !== to.length) return;
    const map: PropertyMap = { source: source as string, sourceKind, from: points, to: values };
    prop.map = map;
    const sourceBase = sourceProp?.base[0] ?? 0;
    const channels = values.every(Array.isArray) ? (values as Channels[]) : undefined;
    if (nums && channels) {
      prop.base = interpolate({ from: nums, to: channels }, sourceBase);
    } else {
      // Until layout arrives: the value at the numeric point nearest the source's base,
      // among points whose value is a number too; else the first numeric value; else 0.
      let nearest = -1;
      let distance = Infinity;
      points.forEach((point, i) => {
        if (typeof point !== "number" || !Array.isArray(values[i])) return;
        const d = Math.abs(point - sourceBase);
        if (d < distance) [nearest, distance] = [i, d];
      });
      const fallback = values.find(Array.isArray) as Channels | undefined;
      prop.base = nearest >= 0 ? (values[nearest] as Channels) : (fallback ?? [0]);
    }
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
      if (isObject(value) && "keyframes" in value) {
        this.r.error("keyframes-outside-enter", kp, "Keyframes are a transient state-entry effect, not an ordinary motion.", `Move them to a state's "enter": { "${key}": { "keyframes": [...], "duration": 0.4 } }.`);
        continue;
      }
      const motion = this.motion(value, kp);
      if (!prop || !motion) continue;
      if (motion.kind === "spring" && motion.kick !== undefined) {
        this.r.error("kick-outside-enter", kp, "A kick can't be used in \"animate\".", "Kicks play when a state is entered. Move this motion to that state's \"enter\".");
        continue;
      }
      if (motion.delay !== undefined && !this.needsVersion("0.12", ptr(kp, "delay"), "A motion delay")) continue;
      out.set(key, motion);
    }
    return out;
  }

  private parseEnter(raw: Json, p: string): Map<string, EntryEffect> {
    const out = new Map<string, EntryEffect>();
    if (!isObject(raw)) {
      this.r.error("invalid-type", p, "\"enter\" must map properties to kicks.", `For example: "enter": { "heart.scale": { "kick": 6, "spring": { "duration": 0.4, "bounce": 0.5 } } }`);
      return out;
    }
    for (const [key, value] of Object.entries(raw)) {
      if (key === "note" || key.startsWith("x-")) continue;
      const kp = ptr(p, key);
      const prop = this.property(key, kp);
      if (prop && isObject(value) && "keyframes" in value) {
        const effect = this.parseKeyframes(prop.kind, key, value, kp);
        if (effect) out.set(key, effect);
        continue;
      }
      const motion = this.motion(value, kp);
      if (!prop || !motion) continue;
      if (motion.delay !== undefined) {
        this.r.error("delay-outside-animate", ptr(kp, "delay"), "An entry kick starts on entry; it can't wait.", "Remove the delay. To start a motion later, put a delayed motion in \"animate\" for the transition.");
        continue;
      }
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

  private parseLoop(raw: Json, p: string, state: State): Map<string, Loop> {
    const r = this.r;
    const out = new Map<string, Loop>();
    if (!this.needsVersion("0.10", p, "\"loop\"")) return out;
    if (!isObject(raw)) {
      r.error("invalid-type", p, "\"loop\" must map properties to cycles.", `For example: "loop": { "spinner.rotation": { "to": 360, "duration": 0.8, "wrap": 360 } }`);
      return out;
    }
    for (const [key, value] of Object.entries(raw)) {
      if (key === "note" || key.startsWith("x-")) continue;
      const kp = ptr(p, key);
      const prop = this.property(key, kp);
      if (!prop) continue;
      if (prop.kind === "color") {
        r.error("loop-not-numeric", kp, "A color can't loop.", "Loop a numeric property, and map the color from it with \"map\".");
        continue;
      }
      if (state.follow.has(key)) {
        r.error("loop-conflict", kp, `"${key}" is followed in this state, so it can't also loop here.`, "Loop a different property, or follow it in another state.");
        continue;
      }
      if (!isObject(value)) {
        r.error("invalid-loop", kp, "A loop is an object with \"to\" or \"keyframes\", and \"duration\".", `For example: { "to": 360, "duration": 0.8 } or { "keyframes": [{ "at": 0.5, "value": -6 }], "duration": 1.2 }.`);
        continue;
      }
      r.keys(value, kp, LOOP_KEYS);
      if (!("to" in value) && !("keyframes" in value)) {
        r.error("invalid-loop", kp, "The loop doesn't move: it has neither \"to\" nor \"keyframes\".", "Add \"to\" (the offset at the end of a cycle) for a turn or a sweep, or \"keyframes\" for a pulse that returns to 0.");
        continue;
      }
      let ok = true;
      let to: MeasuredEndpoint = 0;
      if ("to" in value) {
        const parsed = this.parseEndpoint(prop.kind, key, value.to, ptr(kp, "to"), "invalid-value", "\"to\" must be a finite number or measure object.");
        if (parsed === undefined) ok = false;
        else to = parsed;
      }
      const frames: Loop["frames"] = [];
      if ("keyframes" in value) {
        const list = value.keyframes;
        if (!Array.isArray(list) || list.length === 0) {
          r.error("invalid-keyframes", ptr(kp, "keyframes"), '"keyframes" must be a non-empty list of points inside the cycle.', 'For example: [{ "at": 0.3, "value": -6 }, { "at": 0.6, "value": 0 }].');
          ok = false;
        } else {
          let previous = 0;
          list.forEach((frame, i) => {
            const fp = ptr(ptr(kp, "keyframes"), i);
            if (!isObject(frame)) {
              r.error("invalid-keyframes", fp, "A keyframe must have normalized time and a value.", 'Write { "at": 0.5, "value": 8 }.');
              ok = false;
              return;
            }
            r.keys(frame, fp, ["at", "value"]);
            const at = frame.at;
            if (typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at >= 1 || at <= previous) {
              r.error("invalid-keyframe-time", ptr(fp, "at"), '"at" must increase strictly between 0 and 1.', "The cycle starts at 0 with offset 0 and ends at 1 with \"to\"; put the points in between in ascending order.");
              ok = false;
              return;
            }
            const point = "value" in frame ? this.parseEndpoint(prop.kind, key, frame.value, ptr(fp, "value"), "invalid-value", "A loop keyframe's value must be a finite number or measure object.") : undefined;
            if (!("value" in frame)) r.error("invalid-keyframes", ptr(fp, "value"), "The keyframe has no value.", `Add an offset for "${key}".`);
            if (point === undefined) {
              ok = false;
              return;
            }
            frames.push({ at, value: point });
            previous = at;
          });
        }
      }
      if (!("duration" in value)) {
        r.error("missing-duration", kp, "The loop has no duration.", 'Add "duration": the seconds one cycle takes, for example 0.8.');
        continue;
      }
      const duration = parseTime(value.duration);
      if (duration === undefined || duration <= 0) {
        r.error("invalid-value", ptr(kp, "duration"), '"duration" must be a time greater than 0.', 'Use seconds (0.8) or a string like "800ms".');
        continue;
      }
      let ease: Ease = "linear";
      if ("ease" in value) {
        const parsed = parseEase(value.ease, ptr(kp, "ease"), r);
        if (!parsed) continue;
        ease = parsed;
      }
      let delay = 0;
      if ("delay" in value) {
        const parsed = parseTime(value.delay);
        if (parsed === undefined) {
          r.error("invalid-value", ptr(kp, "delay"), '"delay" must be a time of 0 or more.', 'Use seconds (0.15) or a string like "150ms".');
          continue;
        }
        delay = parsed;
      }
      let wrap: number | undefined;
      if ("wrap" in value) {
        if (typeof value.wrap !== "number" || !Number.isFinite(value.wrap) || value.wrap <= 0) {
          r.error("invalid-value", ptr(kp, "wrap"), '"wrap" must be a period greater than 0.', "For a rotation, 360: a spinner then stops by the shortest turn.");
          continue;
        }
        wrap = value.wrap;
      }
      if (!ok) continue;
      out.set(key, wrap === undefined ? { to, frames, duration, ease, delay } : { to, frames, duration, ease, delay, wrap });
    }
    return out;
  }

  private parseKeyframes(kind: PropertyKind, key: string, raw: JsonObject, p: string): KeyframesEffect | undefined {
    const r = this.r;
    if (["kick", "spring", "tween"].some((name) => name in raw)) {
      r.error("enter-effect-conflict", p, "An entry effect is either keyframes or a spring kick, not both.", "Remove the kick and spring, or remove keyframes.");
      return undefined;
    }
    r.keys(raw, p, KEYFRAMES_KEYS);
    if (!this.needsVersion("0.8", ptr(p, "keyframes"), "Entry keyframes")) return undefined;
    if (!Array.isArray(raw.keyframes) || raw.keyframes.length === 0) {
      r.error("invalid-keyframes", ptr(p, "keyframes"), '"keyframes" must be a non-empty list of intermediate points.', 'For example: [{ "at": 0.25, "value": -8 }, { "at": 0.6, "value": 5 }].');
      return undefined;
    }
    const frames: KeyframesEffect["frames"] = [];
    let previous = 0;
    raw.keyframes.forEach((frame, i) => {
      const fp = ptr(ptr(p, "keyframes"), i);
      if (!isObject(frame)) {
        r.error("invalid-keyframes", fp, "A keyframe must have normalized time and a value.", 'Write { "at": 0.5, "value": 8 }.');
        return;
      }
      r.keys(frame, fp, ["at", "value"]);
      const at = frame.at;
      let ok = true;
      if (typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at >= 1 || at <= previous) {
        r.error("invalid-keyframe-time", ptr(fp, "at"), '"at" must increase strictly between 0 and 1.', "Keep the current value at 0 and the state target at 1 implicit; put intermediate frames in ascending order.");
        ok = false;
      }
      if (!("value" in frame)) {
        r.error("invalid-keyframes", ptr(fp, "value"), "The keyframe has no value.", `Add a value valid for "${key}".`);
        ok = false;
      }
      const value = "value" in frame ? this.parseValue(kind, key, frame.value, ptr(fp, "value")) : undefined;
      if (ok && value) {
        frames.push({ at: at as number, value });
        previous = at as number;
      }
    });
    if (!("duration" in raw)) {
      r.error("missing-duration", p, "The keyframes have no duration.", 'Add "duration" in seconds, for example 0.4.');
      return undefined;
    }
    const duration = parseTime(raw.duration);
    if (duration === undefined || duration <= 0) {
      r.error("invalid-value", ptr(p, "duration"), '"duration" must be a time greater than 0.', 'Use seconds (0.4) or a string like "400ms".');
      return undefined;
    }
    let ease: Ease = "linear";
    if ("ease" in raw) {
      const parsed = parseEase(raw.ease, ptr(p, "ease"), r);
      if (!parsed) return undefined;
      ease = parsed;
    }
    return frames.length === raw.keyframes.length ? { kind: "keyframes", frames, duration, ease } : undefined;
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
    const state: State = { name, set: new Map(), measure: new Map(), follow: new Map(), enter: new Map(), loop: new Map(), when: new Map(), timers: [] };

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
      if (state.follow.has(key)) r.error("follow-conflict", ptr(ptr(p, "enter"), key), `"${key}" is followed in this state, so it can't also have an entry effect here.`, "Remove the entry effect, or follow a different property.");
    }
    if ("loop" in raw) state.loop = this.parseLoop(raw.loop, ptr(p, "loop"), state);
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
        const timer = this.parseTimer(value, ep);
        const delay = this.parseAfter(event, ep, machineLevel);
        if (timer && delay !== undefined && timers) timers.push({ key: event, delay, transition: timer.transition, pause: timer.pause });
        continue;
      }
      const okEvent = this.checkEvent(event, ep);
      const transition = this.parseTransition(value, ep);
      if (okEvent && transition) out.set(event, transition);
    }
    return out;
  }

  private parseTimer(raw: Json, p: string): { transition: Transition; pause: Timer["pause"] } | undefined {
    if (!isObject(raw) || !("pause" in raw)) {
      const transition = this.parseTransition(raw, p);
      return transition ? { transition, pause: [] } : undefined;
    }
    const transitionRaw = { ...raw };
    delete transitionRaw.pause;
    const transition = this.parseTransition(transitionRaw, p);
    const pause = this.parseTimerPause(raw.pause, ptr(p, "pause"));
    return transition ? { transition, pause } : undefined;
  }

  private parseTimerPause(raw: Json, p: string): Timer["pause"] {
    const r = this.r;
    if (!this.needsVersion("0.7", p, "A pausable timer")) return [];
    if (!Array.isArray(raw) || raw.length === 0) {
      r.error("invalid-timer-pause", p, '"pause" must be a non-empty list of event pairs.', 'For example: "pause": [{ "on": "toast.hoverstart", "off": "toast.hoverend" }].');
      return [];
    }
    const out: Timer["pause"] = [];
    raw.forEach((pair, i) => {
      const pp = ptr(p, i);
      if (!isObject(pair)) {
        r.error("invalid-timer-pause", pp, "A timer pause reason must have on and off events.", 'Write { "on": "toast.hoverstart", "off": "toast.hoverend" }.');
        return;
      }
      r.keys(pair, pp, ["on", "off"]);
      let ok = true;
      for (const field of ["on", "off"] as const) {
        const fp = ptr(pp, field);
        if (typeof pair[field] !== "string") {
          r.error("invalid-timer-pause", fp, `"${field}" must be an event name.`, field === "on" ? "Name the event that pauses this reason." : "Name the event that resumes this reason.");
          ok = false;
        } else if (!this.checkEvent(pair[field], fp)) ok = false;
      }
      if (typeof pair.on === "string" && pair.on === pair.off) {
        r.error("invalid-timer-pause", ptr(pp, "off"), "A pause reason needs different on and off events.", "Use the matching end event, such as hoverend, blur, or host.resume.");
        ok = false;
      }
      if (ok) out.push({ on: pair.on as string, off: pair.off as string });
    });
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
        if (!Array.isArray(range) || range.length !== 2) {
          r.error("invalid-value", ptr(kp, "range"), "\"range\" must be two different numeric or measured endpoints.", "For example: \"range\": [0, { \"measure\": \"track.width\" }].");
          continue;
        }
        const endpoints: MeasuredEndpoint[] = [];
        range.forEach((value, i) => {
          const endpoint = this.parseEndpoint(prop.kind, key, value, ptr(ptr(kp, "range"), i), "invalid-value", "A follow range endpoint must be a finite number or measure object.");
          if (endpoint !== undefined) endpoints.push(endpoint);
        });
        if (endpoints.length !== 2) continue;
        const [a, b] = endpoints;
        if (typeof a === "number" && typeof b === "number") {
          if (a === b) {
            r.error("invalid-value", ptr(kp, "range"), "\"range\" must be two different endpoints.", "For example: \"range\": [0, 20].");
            continue;
          }
          follow.range = [Math.min(a, b), Math.max(a, b)];
        } else {
          follow.range = [a, b];
        }
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
      return this.needsVersion("0.5", p, "An app input (host.<name>)") && this.checkDeclared("input", parts[1], p);
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
    const crossing = CROSSING.exec(key);
    if (crossing) {
      // input>value or input<value (v0.15): fires when a sample crosses into the condition.
      if (!this.needsVersion("0.15", p, "A crossing event")) return false;
      return this.checkInput(crossing[1], p, p);
    }
    if (/[<>=]/.test(key)) {
      r.error("invalid-event", p, `"${key}" is not a crossing event.`, "Write an input, > or <, and a number, for example \"host.volume>0.6\" or \"list.scroll.y<40\".");
      return false;
    }
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
      return this.checkDeclared("event", event, p);
    }
    let ok = this.checkTarget(target, p);
    if (EVENTS_0_2.includes(event) && !this.needs02(p, `The "${event}" event`)) ok = false;
    if (EVENTS_0_14.includes(event) && !this.needsVersion("0.14", p, `The "${event}" event`)) ok = false;
    if (EVENTS_0_15.includes(event) && !this.needsVersion("0.15", p, `The "${event}" event`)) ok = false;
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
    for (const key of state.loop.keys()) out.add(key);
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
  let delay: number | undefined;
  if ("delay" in raw) {
    delay = parseTime(raw.delay);
    if (delay === undefined) {
      r.error("invalid-value", ptr(p, "delay"), '"delay" must be a time of 0 or more.', 'Use seconds (0.08) or a string like "80ms".');
      return undefined;
    }
  }
  const withDelay = <M extends Motion>(m: M): M => (delay ? { ...m, delay } : m);
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
    return withDelay(kick === undefined ? spring : { ...spring, kick });
  }
  if ("tween" in raw) {
    const tween = parseTween(raw.tween, ptr(p, "tween"), r);
    return tween && withDelay(tween);
  }
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

/** Edits between two names, counting two swapped neighbors ("hdie") as one. */
function editDistance(a: string, b: string): number {
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
    }
    [before, prev] = [prev, row];
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
