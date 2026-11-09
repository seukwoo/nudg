// Several players on one view compose, as stacked modifiers do on SwiftUI and Compose and as
// the DOM adapter composes them: transforms in order (the view's own first), opacities
// multiplied. Sizes and colors can't be combined; the last style keeps them.
//
//   <Animated.View style={compose({ transform: [{ rotate: "-8deg" }] }, rise.bind("card").style, press.bind("button").style)} />

import { Animated } from "react-native";
import { composeWith, type Style } from "./compose-rule.ts";

/** One style from several: the view's own and each player's `bind(name).style`, outermost first. */
export function compose(...styles: Style[]): Record<string, unknown> {
  return composeWith((a, b) => Animated.multiply(a, b), styles);
}
