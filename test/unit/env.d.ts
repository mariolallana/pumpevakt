// Ambient types for the unit tests (no @types/node dependency).
declare module '*.csv?raw' {
  const text: string;
  export default text;
}
interface ImportMeta {
  readonly url: string;
}
declare module '*.sql?raw' {
  const text: string;
  export default text;
}
