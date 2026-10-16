// The slice of React Native this adapter uses, so the package typechecks without it.
// At runtime the app's own react-native is used (an optional peer dependency).
declare module "react-native" {
  export namespace Animated {
    class Value {
      constructor(value: number);
      setValue(value: number): void;
      interpolate(config: { inputRange: number[]; outputRange: string[] | number[]; extrapolate?: "extend" | "clamp" | "identity" }): unknown;
    }
    class Color {
      constructor(value: string);
      setValue(value: string): void;
    }
  }
  export interface LayoutChangeEvent {
    nativeEvent: { layout: { x: number; y: number; width: number; height: number } };
  }
  export const AccessibilityInfo: { isReduceMotionEnabled(): Promise<boolean> };
}
