// src/global.d.ts
export {};

declare global {
  interface Window {
    midnight?: Record<string, any>;
  }
}
