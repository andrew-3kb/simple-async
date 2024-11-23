export const isPromise = (
  possiblePromise: unknown,
): possiblePromise is Promise<unknown> => {
  return (
    typeof possiblePromise === "object" &&
    possiblePromise !== null &&
    "then" in possiblePromise &&
    "catch" in possiblePromise &&
    typeof possiblePromise.then === "function" &&
    typeof possiblePromise.catch === "function"
  );
};

export type PendingProimse<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export const createPendingPromise = <T>(): PendingProimse<T> => {
  const callbacks = {} as {
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
  };
  const promise = new Promise<T>((resolve, reject) => {
    Object.assign(callbacks, { resolve, reject });
  });
  return { promise, ...callbacks };
};
