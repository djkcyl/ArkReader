export function digitalAxis(negative: boolean, positive: boolean): number {
  return Number(positive) - Number(negative);
}
export function joystickAxis(raw: number, invert = false): number {
  const value = Number.isFinite(raw) ? raw : 0,
    dead = 0.19;
  const result =
    value > 1
      ? 1
      : value < -1
        ? -1
        : Math.abs(value) < dead
          ? 0
          : value > 0
            ? (value - dead) / (1 - dead)
            : -((-value - dead) / (1 - dead));
  return invert ? -result : result;
}
/** Duplicate named axes select the greatest magnitude; ties retain the first. */
export function strongestAxis(values: readonly number[]): number {
  let result = 0;
  for (const value of values) if (Math.abs(value) > Math.abs(result)) result = value;
  return result;
}
export type NavigationPad = {
  index: number;
  connected: boolean;
  mapping: string;
  axes: readonly number[];
  buttons: readonly {
    pressed: boolean;
  }[];
};
export class NavigationGamepads {
  private pressed = new Map<number, boolean>();
  sample(pads: readonly (NavigationPad | null)[]): {
    x: number;
    y: number;
    submit: boolean;
    cancel: boolean;
  } {
    const current = new Map<number, boolean>(),
      xs: number[] = [],
      ys: number[] = [];
    let down = false;
    for (const pad of pads) {
      // Nonstandard device button/axis order cannot be inferred from its index.
      if (!pad?.connected || pad.mapping !== 'standard') continue;
      xs.push(joystickAxis(pad.axes[0] ?? 0));
      ys.push(joystickAxis(pad.axes[1] ?? 0, true));
      const pressed = !!pad.buttons[1]?.pressed;
      if (pressed && !this.pressed.get(pad.index)) down = true;
      current.set(pad.index, pressed);
    }
    this.pressed = current;
    // The shipped InputManager binds BOTH names to joystick button 1.
    return { x: strongestAxis(xs), y: strongestAxis(ys), submit: down, cancel: down };
  }
  clear(): void {
    this.pressed.clear();
  }
}
