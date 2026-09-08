---
'@eleven-labs/nest-profiler': patch
---

Serialize non-plain values meaningfully in `redact()` instead of collapsing them.

- `redact()` (used for SQL parameters, request/response bodies, config snapshots, …) enumerated any object's own-enumerable string keys, so a `Date` became `{}`, a `Buffer` became a byte-index map, and `Map`/`Set`/`URL`/`RegExp`/`Error` became `{}`. A `BigInt` passed through unchanged and then threw `Do not know how to serialize a BigInt` when the profile was `JSON.stringify`-d for storage.
- Well-known types are now serialized before the plain-object branch: `Date` → ISO string, `Map` → object (keys stringified, sensitive keys still masked), `Set` → array, `URL`/`RegExp` → string, `Error` → `{ name, message, stack }`, `ArrayBuffer`/`Buffer`/TypedArray → a `[<Type> <n> bytes]` placeholder, and `BigInt` → its decimal string so serialization never throws.
- Remaining class instances prefer their `toJSON()` projection when present, else fall back to own-enumerable enumeration as before.
- `isPlainObject` is now strict (prototype must be `Object.prototype` or `null`), so exotic objects are no longer property-enumerated by any consumer.
