/// <reference types="vite/client" />

declare const __WS_URL__: string;

declare module '*.vert' {
  const content: string;
  export default content;
}

declare module '*.frag' {
  const content: string;
  export default content;
}
