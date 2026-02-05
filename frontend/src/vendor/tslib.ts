/* Minimal tslib helpers required by echarts-for-react ESM build. */
// @ts-nocheck
/* eslint-disable @typescript-eslint/ban-types, @typescript-eslint/no-explicit-any */

export function __extends(d: Function, b: Function | null): void {
  if (typeof Object.setPrototypeOf === "function") {
    Object.setPrototypeOf(d, b);
  } else {
    (d as { __proto__?: Function | null }).__proto__ = b;
  }

  function __(): void {
    this.constructor = d;
  }

  d.prototype =
    b === null ? Object.create(b) : (((__ as unknown) as Function).prototype = b.prototype, new (__ as any)());
}

export const __assign: typeof Object.assign =
  Object.assign ||
  function __assignPolyfill(target: Record<string, unknown>, ...sources: Record<string, unknown>[]) {
    for (const source of sources) {
      for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
    return target;
  };

export function __rest(source: Record<string, unknown>, exclude: (string | symbol)[]): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  for (const prop in source) {
    if (Object.prototype.hasOwnProperty.call(source, prop) && exclude.indexOf(prop) < 0) {
      target[prop] = source[prop];
    }
  }
  if (source != null && typeof Object.getOwnPropertySymbols === "function") {
    for (const symbol of Object.getOwnPropertySymbols(source)) {
      if (exclude.indexOf(symbol) < 0 && Object.prototype.propertyIsEnumerable.call(source, symbol)) {
        target[symbol as unknown as string] = (source as Record<string, unknown>)[symbol as unknown as string];
      }
    }
  }
  return target;
}

export function __awaiter<T>(
  thisArg: unknown,
  _arguments: unknown,
  PromiseCtor: PromiseConstructorLike,
  generator: (...args: unknown[]) => Generator<unknown, T, unknown>,
): Promise<T> {
  function adopt(value: unknown): Promise<unknown> {
    return value instanceof PromiseCtor
      ? value
      : new (PromiseCtor as PromiseConstructor)(function (resolve) {
          resolve(value);
        });
  }
  return new (PromiseCtor as PromiseConstructor)(function (resolve, reject) {
    function fulfilled(value: unknown): void {
      try {
        step(generator.next(value));
      } catch (error) {
        reject(error);
      }
    }
    function rejected(value: unknown): void {
      try {
        step(generator.throw ? generator.throw(value) : { done: true, value });
      } catch (error) {
        reject(error);
      }
    }
    function step(result: IteratorResult<unknown, T>): void {
      if (result.done) {
        resolve(result.value);
      } else {
        adopt(result.value).then(fulfilled, rejected);
      }
    }
    step(generator.apply(thisArg, _arguments as [])).next();
  });
}

export function __generator(thisArg: unknown, body: (state: any) => unknown): Generator {
  let _ = { label: 0, sent: () => undefined as unknown, trys: [] as unknown[], ops: [] as unknown[] };
  let f = 0;
  let y: any;
  let t: any;
  let g: Generator;

  function verb(n: number) {
    return (v: unknown) => step([n, v]);
  }

  function step(op: [number, unknown]) {
    if (f) {
      throw new TypeError("Generator is already executing.");
    }
    while (_) {
      try {
        f = 1;
        if (y && (t = op[0] & 2 ? y.return : op[0] ? y.throw || ((t = y.return) && t.call(y), 0) : y.next)) {
          t = t.call(y, op[1]);
          if (!t.done) {
            return t;
          }
          op = [op[0] & 2, t.value];
        }
        switch (op[0]) {
          case 0:
          case 1:
            t = op;
            break;
          case 4:
            _.label += 1;
            return { value: op[1], done: false };
          case 5:
            _.label += 1;
            y = op[1];
            op = [0, undefined];
            continue;
          case 7:
            op = _.ops.pop() as [number, unknown];
            _.trys.pop();
            continue;
          default:
            if (!(_.trys.length && (t = _.trys[_.trys.length - 1])) && (op[0] === 6 || op[0] === 2)) {
              _ = null as any;
              continue;
            }
            if (op[0] === 3 && (!t || (op[1] as number) > t[0] && (op[1] as number) < t[3])) {
              _.label = op[1] as number;
              break;
            }
            if (op[0] === 6 && _.label < (t[1] as number)) {
              _.label = t[1] as number;
              t = op;
              break;
            }
            if (t && _.label < (t[2] as number)) {
              _.label = t[2] as number;
              _.ops.push(op);
              break;
            }
            if (t[2]) {
              _.ops.pop();
            }
            _.trys.pop();
            continue;
        }
        op = body.call(thisArg, _);
      } catch (error) {
        op = [6, error];
        y = 0;
      } finally {
        f = 0;
      }
    }
    if (op[0] & 5) {
      throw op[1];
    }
    return { value: op[0] ? op[1] : undefined, done: true };
  }

  g = {
    next: verb(0),
    throw: verb(1),
    return: verb(2),
    [Symbol.iterator]() {
      return this;
    },
  } as Generator;

  return g;
}
