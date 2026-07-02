export interface BundleClientOptions {
  /** Absolute path to the client entry `.ts` file. */
  entry: string;
  /** Absolute path of the browser IIFE bundle to emit. */
  outfile: string;
}

/** Bundle a client entry point into a single minified browser IIFE via esbuild. */
export function bundleClient(options: BundleClientOptions): Promise<void>;
