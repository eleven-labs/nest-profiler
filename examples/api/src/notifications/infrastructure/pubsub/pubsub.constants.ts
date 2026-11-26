/**
 * Topic the catalog publishes its domain events to. One topic for every product event — the event
 * name travels in the `eventType` attribute, which is what a subscription would filter on.
 */
export const PRODUCT_EVENTS_TOPIC = 'catalog.product-events';
