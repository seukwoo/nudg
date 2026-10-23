// Host side of the animated list, shared by animated-list.html and the examples site.
// One nudg player per row; the host owns the order: it shifts the neighbours while a row
// is dragged, passes the drop offset, and commits the new order once the drop settles.
export function createAnimatedList(list, program, play, { onState } = {}) {
  const players = new Map();
  let count = list.children.length;

  function attach(row, state) {
    const player = play(program, null, {
      bind: { row, handle: row.querySelector(".handle") },
      state,
      exit: "removed",
      onExit: () => {
        players.get(row)?.destroy();
        players.delete(row);
        row.remove();
      },
      onState,
      onSettle: (states) => states.includes("order/dropping") && commit(row),
      onFrame: (values) => drag?.row === row && track(values["row.y"]),
    });
    players.set(row, player);
    row.querySelector(".delete").addEventListener("click", () => player.send("host.remove"));
    row.querySelector(".handle").addEventListener("pointerdown", () => start(row));
    return player;
  }

  // While a row is dragged: where it started, where it would land, and its neighbours' shifts.
  let drag;
  const rows = () => [...list.children].filter((row) => players.has(row));
  function start(row) {
    const order = rows();
    drag = { row, from: order.indexOf(row), to: order.indexOf(row), height: row.offsetHeight, order };
    players.get(row).input("host.drop", 0);
  }
  function track(y) {
    const to = Math.max(0, Math.min(drag.order.length - 1, drag.from + Math.round(y / drag.height)));
    if (to === drag.to) return;
    drag.to = to;
    players.get(drag.row).input("host.drop", (to - drag.from) * drag.height);
    drag.order.forEach((row, i) => {
      if (row === drag.row) return;
      const shift = i > drag.from && i <= to ? "host.shift-up" : i < drag.from && i >= to ? "host.shift-down" : "host.rest";
      players.get(row).send(shift);
    });
  }
  function commit(row) {
    if (drag?.row !== row) return;
    const { order, from, to } = drag;
    drag = undefined;
    if (to !== from) list.insertBefore(row, to < from ? order[to] : order[to].nextSibling);
    for (const other of order) players.get(other).send("host.commit");
  }

  for (const row of [...list.children]) attach(row, ["presence/present", "order/rest"]);

  return {
    add(label) {
      const row = list.firstElementChild.cloneNode(true);
      row.removeAttribute("style");
      row.removeAttribute("data-nudg-state");
      row.querySelector(".label").textContent = label ?? `Item ${++count}`;
      list.append(row);
      attach(row).send("host.insert");
    },
    destroy() {
      for (const player of players.values()) player.destroy();
      players.clear();
    },
  };
}
