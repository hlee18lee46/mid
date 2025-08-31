// Works in browsers even if TS DOM libs aren't enabled.
const DomEx: any =
  (globalThis as any).DOMException ??
  class DOMExceptionPolyfill extends Error {
    name = "DOMException";
    constructor(message?: string, name?: string) {
      super(message);
      if (name) this.name = name;
    }
  };

export default DomEx;
export { DomEx as DOMException };
