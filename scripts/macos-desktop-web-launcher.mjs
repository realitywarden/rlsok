// Keep the launcher's exact argv/instance nonce visible to macOS process checks.
// Next sets process.title during startup, which otherwise replaces that identity.
const originalTitle = process.title;
Object.defineProperty(process, 'title', {
  enumerable: true,
  configurable: false,
  get: () => originalTitle,
  set: () => {},
});
await import(new URL('./server/web/apps/web/server.js', import.meta.url));
