// How the DOM adapter measures an element. Self-contained (no imports, only page globals),
// so the Node tools can run the same function inside a page they load.

/**
 * One layout measurement of an element, in CSS pixels (logical units): the untransformed
 * box from offsets, summed up to the page, or the natural size from the scroll size.
 */
export function measureElement(el: Element, what: string): number | undefined {
  if (!(el instanceof HTMLElement)) {
    const r = el.getBoundingClientRect();
    return what === "x" ? r.left + scrollX : what === "y" ? r.top + scrollY : what === "width" || what === "naturalWidth" ? r.width : r.height;
  }
  switch (what) {
    case "x":
    case "y": {
      let sum = 0;
      for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) sum += what === "x" ? node.offsetLeft : node.offsetTop;
      return sum;
    }
    case "width":
      return el.offsetWidth;
    case "height":
      return el.offsetHeight;
    case "naturalWidth":
      return el.scrollWidth;
    case "naturalHeight":
      return el.scrollHeight;
  }
  return undefined;
}
