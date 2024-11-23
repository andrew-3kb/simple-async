export const runNextTick = (fn: () => void) => {
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(fn);
    return;
  }
  if (typeof setTimeout !== "undefined") {
    setTimeout(fn, 0);
    return;
  }
  fn();
};

export const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
