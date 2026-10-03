/** WGSL sources are imported as strings, with `// #import` lines resolved (tools/vite-wgsl.js). */
declare module '*.wgsl' {
  const source: string;
  export default source;
}
