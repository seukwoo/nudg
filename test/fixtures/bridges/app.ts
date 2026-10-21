// A page with real MUI and Radix components driven by nudg, bundled by test/bridges.test.ts.
import { createElement as h, useState, useRef, useEffect, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import Dialog from "@mui/material/Dialog";
import * as RadixDialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { nudgTransition, presets, useNudg } from "../../../src/react/index.ts";

const muiTransition = nudgTransition();
const switchDoc = {
  nudg: "0.3",
  targets: ["track", "knob"],
  values: { "knob.x": 0 },
  animate: { "knob.x": { spring: { duration: 0.3, bounce: 0.2 } } },
  initial: "off",
  when: { "host.checked": "on", "host.unchecked": "off" },
  states: { off: {}, on: { set: { "knob.x": 20 } } },
};
const radixDoc = presets.appear({ target: "content" });
const meterDoc = (span: number) => ({ nudg: "0.5", targets: ["fill"], values: { "fill.x": { map: "host.level", from: [0, 1], to: [0, span] } }, initial: "idle", states: { idle: {} } });

// Reports the level from a child's layout effect, which runs before the parent's player exists.
function Level({ input }: { input: (name: string, value: number) => boolean }) {
  useLayoutEffect(() => void ((window as any).__early = input("host.level", 0.25)), []);
  return null;
}

function App() {
  const [mui, setMui] = useState(false);
  const [radix, setRadix] = useState(false);
  const [checked, setChecked] = useState(false);
  const [span, setSpan] = useState(100);
  const meter = useNudg(meterDoc(span));
  const api = useRef({ setMui, setRadix, setChecked, setSpan, meter });
  api.current.meter = meter;
  useEffect(() => void ((window as any).__app = api.current), []);

  const sw = useNudg(switchDoc, { watch: true });
  const content = useNudg(radixDoc, { watch: true, exit: "hidden" });

  return h("div", null,
    h(Level, { input: meter.input }),
    h("div", { id: "fill", ref: meter.bind("fill"), style: { width: 10, height: 10, background: "#000" } }),
    h(Dialog, { open: mui, onClose: () => setMui(false), slots: { transition: muiTransition } }, h("div", { id: "mui-body", style: { padding: 24 } }, "MUI dialog")),
    h(RadixDialog.Root, { open: radix, onOpenChange: setRadix },
      h(RadixDialog.Portal, { forceMount: true },
        h(RadixDialog.Content, { forceMount: true, ref: content.bind("content"), id: "radix-content", "aria-describedby": undefined, style: { position: "fixed", top: 40, left: 40, padding: 24, background: "#fff", visibility: content.present ? undefined : "hidden" } },
          h(RadixDialog.Title, null, "Radix dialog")))),
    h(Switch.Root, { id: "switch", checked, onCheckedChange: setChecked, ref: sw.bind("track"), style: { width: 44, height: 24, background: "#ccc", borderRadius: 12, border: 0, position: "relative" } },
      h(Switch.Thumb, { ref: sw.bind("knob"), id: "thumb", style: { display: "block", width: 20, height: 20, borderRadius: 10, background: "#fff", marginTop: 2 } })),
  );
}

createRoot(document.getElementById("root")!).render(h(App));
