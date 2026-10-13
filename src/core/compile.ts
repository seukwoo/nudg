// Validates a nudg file and compiles it into a Program. Every problem becomes a
// Diagnostic with a stable code, a JSON pointer, and a hint an AI can act on.

import { hexToOklab, isHexColor } from "./color.ts";
import { fromDurationBounce, fromStiffnessRatio } from "./spring.ts";
import type {
  Channels,
  Diagnostic,
  Ease,
  Machine,
  Motion,
  Program,
  Property,
  PropertyKind,
  SpringMotion,
  State,
  Transition,
} from "./types.ts";
import {
  EVENT_ALIASES,
  EVENTS,
  IDENTIFIER,
  NAMED_EASES,
  PROPERTIES,
  PROPERTY_ALIASES,
  VERSION,
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

const TOP_LEVEL_KEYS = ["$schema", "nudg", "import", "targets", "values", "motions", "animate", "initial", "states", "regions"];
const MACHINE_KEYS = ["initial", "states", "regions"];
const STATE_KEYS = ["set", "enter", "when", ...MACHINE_KEYS];
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
    r.error("invalid-type", "/$schema", "\"$schema\" must be a URL string.", "Use \"https://unpkg.com/nudg@0.1/spec/nudg-0.1.schema.json\", or remove it.");
  }

  if (!("nudg" in doc)) {
    r.error("missing-version", "", "The file does not declare a format version.", `Add "nudg": "${VERSION}" at the top.`);
  } else if (doc.nudg !== VERSION) {
    r.error("unsupported-version", "/nudg", `Format version ${JSON.stringify(doc.nudg)} is not supported.`, `This runtime reads version "${VERSION}". Write it as a string: "nudg": "${VERSION}".`);
  }

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

  const hasMachine = "states" in doc || "regions" in doc || "initial" in doc;
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

  const component = new ComponentCompiler(r, library);
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

  constructor(r: Reporter, library: Map<string, LibraryEntry>) {
    this.r = r;
    this.library = library;
  }

  compile(doc: JsonObject): Program | undefined {
    const r = this.r;
    this.parseTargets(doc.targets);
    this.parseValues(doc.values);
    const animate = "animate" in doc ? this.parseAnimate(doc.animate, "/animate") : new Map<string, Motion>();
    const machine = this.parseMachine(doc, "");

    for (const t of this.targets) {
      if (!this.usedTargets.has(t)) {
        r.warn("unused-target", ptr("/targets", [...this.targets].indexOf(t)), `Target "${t}" is declared but never used.`, "Remove it from \"targets\", or use it in a value or event.");
      }
    }
    if (!machine) return undefined;
    return { version: VERSION, targets: [...this.targets], properties: this.properties, animate, machine };
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
    for (const [key, value] of Object.entries(raw)) {
      if (key === "note" || key.startsWith("x-")) continue;
      const p = ptr("/values", key);
      const kind = this.parsePropertyPath(key, p);
      if (!kind) continue;
      // Register the property even if its value is invalid, so later uses don't cascade.
      const base = this.parseValue(kind, key, value, p) ?? (kind === "color" ? [0, 0, 0, 1] : [0]);
      this.properties.set(key, { kind, base });
    }
  }

  /** Resolves a path used outside "values"; it must have a base value. */
  private property(key: string, p: string): Property | undefined {
    const known = this.properties.get(key);
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

  private parseMachine(obj: JsonObject, p: string): Machine | undefined {
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
        r.keys(region, rp, MACHINE_KEYS);
        if (!("states" in region) && !("regions" in region)) {
          r.error("missing-states", rp, `Region "${name}" has no states.`, "Add \"initial\" and \"states\".");
          continue;
        }
        const machine = this.parseMachine(region, rp);
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

    // Transitions target sibling states in v0.1.
    for (const state of states.values()) {
      for (const [event, transition] of state.when) {
        if (states.has(transition.to)) continue;
        const guess = didYouMean(transition.to, names);
        r.error(
          "unknown-state",
          ptr(ptr(ptr(sp, state.name), "when"), event),
          `"${transition.to}" is not a sibling state of "${state.name}".`,
          guess ? `Did you mean "${guess}"?` : `Transitions can target ${names.join(", ")}. Crossing levels is not supported in v0.1.`,
        );
        ok = false;
      }
    }
    return ok ? { kind: "states", initial: initial as string, states } : undefined;
  }

  private parseState(name: string, raw: Json, p: string): State | undefined {
    const r = this.r;
    if (!isObject(raw)) {
      r.error("invalid-type", p, `State "${name}" must be an object.`, "Use {} for a state that sets nothing.");
      return undefined;
    }
    r.keys(raw, p, STATE_KEYS);
    const state: State = { name, set: new Map(), enter: new Map(), when: new Map() };

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
          const channels = this.parseValue(prop.kind, key, value, kp);
          if (channels) state.set.set(key, channels);
        }
      }
    }
    if ("enter" in raw) state.enter = this.parseEnter(raw.enter, ptr(p, "enter"));
    if ("when" in raw) {
      const when = raw.when;
      const wp = ptr(p, "when");
      if (!isObject(when)) {
        r.error("invalid-type", wp, "\"when\" must map events to target states.", `For example: "when": { "track.tap": "on" }`);
      } else {
        for (const [event, value] of Object.entries(when)) {
          if (event === "note" || event.startsWith("x-")) continue;
          const ep = ptr(wp, event);
          const okEvent = this.checkEvent(event, ep);
          const transition = this.parseTransition(value, ep);
          if (okEvent && transition) state.when.set(event, transition);
        }
      }
    }
    if ("states" in raw || "regions" in raw || "initial" in raw) {
      const machine = this.parseMachine(raw, p);
      if (!machine) return undefined;
      state.machine = machine;
    }
    return state;
  }

  private parseTransition(raw: Json, p: string): Transition | undefined {
    if (typeof raw === "string") return { to: raw, animate: new Map() };
    if (!isObject(raw)) {
      this.r.error("invalid-type", p, "A transition is a state name or an object with \"to\".", `For example: "on" or { "to": "on", "animate": { ... } }`);
      return undefined;
    }
    this.r.keys(raw, p, ["to", "animate"]);
    if (typeof raw.to !== "string") {
      this.r.error("missing-to", p, "The transition has no \"to\" state.", "Add \"to\": \"<state name>\".");
      return undefined;
    }
    const animate = "animate" in raw ? this.parseAnimate(raw.animate, ptr(p, "animate")) : new Map<string, Motion>();
    return { to: raw.to, animate };
  }

  private checkEvent(key: string, p: string): boolean {
    const r = this.r;
    const parts = key.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      r.error("invalid-event", p, `"${key}" is not an event.`, "Write events as target.event, for example \"track.tap\".");
      return false;
    }
    const [target, event] = parts;
    let ok = this.checkTarget(target, p);
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
