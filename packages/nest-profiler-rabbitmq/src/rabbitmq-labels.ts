/**
 * Display labels standing in for the values RabbitMQ leaves implicit — an empty exchange name is
 * the default exchange, an absent queue name is one the broker generates. Shared by the
 * subscription and topology descriptions so both name them identically.
 */

/** Label standing in for the RabbitMQ default exchange (an empty or absent exchange name). */
export const DEFAULT_EXCHANGE_LABEL = '(default)';

/** Label standing in for a queue whose name the broker generates (`amq.gen-*`). */
export const GENERATED_QUEUE_LABEL = '(broker-generated)';

/**
 * Falls back to a label when a name is absent **or empty** — `''` is a meaningful RabbitMQ value
 * (the default exchange), so `??` would let it through as a blank cell.
 */
export function orLabel(value: string | undefined, label: string): string {
  return value !== undefined && value.length > 0 ? value : label;
}

/**
 * Names an empty string for what it means under the key that holds it. `x-dead-letter-exchange: ''`
 * is not "unset" — it is the default exchange, which is exactly how a retry queue redelivers
 * straight to a queue by name; rendered blank it reads like a missing value.
 */
export function formatEmptyValue(name: string, value: string): string {
  if (value.length > 0) return value;
  return name.toLowerCase().includes('exchange') ? DEFAULT_EXCHANGE_LABEL : '(empty)';
}
