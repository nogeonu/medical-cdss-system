declare module 'openseadragon' {
  function OpenSeadragon(options: Record<string, unknown>): { destroy(): void };
  export = OpenSeadragon;
}
