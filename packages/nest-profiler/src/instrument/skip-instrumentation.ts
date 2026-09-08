/* eslint-disable @typescript-eslint/no-unsafe-function-type */

/**
 * Which values the instrumentation must hand back untouched.
 *
 * Every rule here answers the same question — "would a Proxy around this break it?" — and every
 * one of them is a real failure, not a precaution. A Proxy is transparent to almost everything in
 * JavaScript; the exceptions are narrow, sharp, and each costs an application that boots into a
 * crash rather than a missing span.
 */

/**
 * Prototypes of the built-ins whose methods read internal slots (`[[MapData]]`, `[[SetData]]`,
 * `[[DateValue]]`…) off their receiver.
 *
 * Internal slots live on the target and never forward through a Proxy, so such a method invoked
 * with the instrumentation Proxy as its receiver throws "called on incompatible receiver".
 *
 * `%TypedArray%.prototype`, reached through `Uint8Array`'s parent, covers every typed array — and
 * through it Node's `Buffer`. `Array` is deliberately absent: its methods are generic and
 * Proxy-safe.
 */
const SLOT_BACKED_PROTOTYPES: ReadonlySet<object> = new Set<object>([
  Map.prototype,
  Set.prototype,
  WeakMap.prototype,
  WeakSet.prototype,
  Date.prototype,
  RegExp.prototype,
  Promise.prototype,
  ArrayBuffer.prototype,
  ...(typeof SharedArrayBuffer === 'undefined' ? [] : [SharedArrayBuffer.prototype]),
  DataView.prototype,
  WeakRef.prototype,
  FinalizationRegistry.prototype,
  Object.getPrototypeOf(Uint8Array.prototype) as object,
]);

/**
 * The prototypes every ordinary function hangs off — plain, async, generator, async generator,
 * arrow, bound. Anything else above a callable means it was built as an object that happens to be
 * invocable.
 */
const INTRINSIC_FUNCTION_PROTOTYPES: ReadonlySet<object | null> = new Set<object | null>([
  Function.prototype,
  Object.getPrototypeOf(async function () {}) as object,
  Object.getPrototypeOf(function* () {}) as object,
  Object.getPrototypeOf(async function* () {}) as object,
]);

const privateMemberCache = new WeakMap<Function, boolean>();

/** Whether a value is a class rather than a function — calling one is construction, not a call. */
export function isClass(value: Function): boolean {
  return /^\s*class\s+/.test(Function.prototype.toString.call(value));
}

/**
 * Whether a function is really an object with a call signature — a Mongoose model carrying its
 * statics, an Axios instance carrying its API — rather than a method worth tracing.
 *
 * Two tells, either sufficient: a prototype that is not one of the intrinsic function prototypes
 * (Mongoose sets `Model.__proto__`), or own enumerable properties, which a plain method never has
 * but statics are. Wrapping one silently drops everything hanging off it — `svc.model.find` became
 * `undefined` mid-request — so anything matching must be handed back as-is.
 */
export function isCallableObject(fn: Function): boolean {
  return (
    !INTRINSIC_FUNCTION_PROTOTYPES.has(Object.getPrototypeOf(fn) as object) ||
    Object.keys(fn).length > 0
  );
}

/**
 * Whether the instance's prototype chain passes through a slot-backed built-in, meaning the native
 * methods it inherits would throw if invoked with a Proxy as their receiver.
 */
export function isSlotBackedBuiltIn(instance: object): boolean {
  let proto: object | null = Object.getPrototypeOf(instance) as object | null;
  while (proto) {
    if (SLOT_BACKED_PROTOTYPES.has(proto)) return true;
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return false;
}

/**
 * Whether a constructor is engine-provided rather than user code.
 *
 * A slot-backed instance whose whole chain is native (`new Map()`, `Buffer.from(...)`) carries
 * nothing worth tracing; one with a user class on top (`class Cache extends Map`) does.
 */
export function isNativeFunction(fn: unknown): boolean {
  // No constructor at all (`Object.create(Map.prototype)`) means nothing user-defined either.
  if (typeof fn !== 'function') return true;
  try {
    return /\{\s*\[native code\]\s*\}$/.test(Function.prototype.toString.call(fn));
  } catch {
    return true;
  }
}

/**
 * Whether any class in the instance's prototype chain declares native private members
 * (`#field`, `#method()`).
 *
 * Such a member is branded to the instance itself and no Proxy trap can satisfy the check: a
 * method invoked with the Proxy as receiver throws "Receiver must be an instance of class".
 *
 * Detection reads the class source, because a private name can only be touched from inside the
 * lexical class body — a class whose text contains no `#name` token cannot perform a brand check.
 * A `#` inside a string or a comment can false-positive, which merely selects the raw receiver:
 * every call still works, only nested self-call spans are lost. A cheap test with a harmless
 * failure mode beats an exact one.
 */
export function usesNativePrivateMembers(instance: object): boolean {
  let proto: object | null = Object.getPrototypeOf(instance) as object | null;
  while (proto && proto !== Object.prototype) {
    const ctor = (proto as { constructor?: unknown }).constructor;
    if (typeof ctor === 'function' && ctor !== Object) {
      let hasPrivate = privateMemberCache.get(ctor);
      if (hasPrivate === undefined) {
        hasPrivate = declaresPrivateMembers(ctor);
        privateMemberCache.set(ctor, hasPrivate);
      }
      if (hasPrivate) return true;
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return false;
}

function declaresPrivateMembers(ctor: Function): boolean {
  try {
    // A `#` starting a private name is never preceded by an identifier character; this matches
    // declarations, `obj.#x` and `#x in obj` alike.
    return /(^|[^\w$])#[\w$]/.test(Function.prototype.toString.call(ctor));
  } catch {
    // A constructor whose source is unavailable (bound functions, natives) cannot be a class body
    // with private members.
    return false;
  }
}
