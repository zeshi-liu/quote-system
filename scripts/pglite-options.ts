/** Local WASM transport only. API/worker clients and closing sockets need separate slots.
 * Each pg pool remains single-connection; PGlite still serializes execution. */
export const offlineSocketOptions={host:'127.0.0.1',maxConnections:4} as const;
