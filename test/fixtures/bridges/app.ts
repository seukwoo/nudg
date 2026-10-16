// A page with real MUI and Radix components driven by nudg, bundled by test/bridges.test.ts.
import { createElement as h, useState, useRef, useEffect } from "react";
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

function App() {
  const [mui, setMui] = useState(false);
  const [radix, setRadix] = useState(false);
  const [checked, setChecked] = useState(false);
  const api = useRef({ setMui, setRadix, setChecked });
  useEffect(() => void ((window as any).__app = api.current), []);

  const sw = useNudg(switchDoc, { watch: true });
  const content = useNudg(radixDoc, { watch: true, exit: "hidden" });

  return h("div", null,
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
