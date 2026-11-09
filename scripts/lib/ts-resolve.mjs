// A resolver for running the app's own TypeScript with Node alone (`pnpm seed`): the source imports its files without an extension, as the bundlers
// and the type checker read them, and Node asks for the extension. This tries `.ts`, then `/index.ts`, for a relative import it could not find. It adds
// no dependency, and it is for scripts only: the app is built by Next.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      !['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error?.code) ||
      !/^\.{1,2}\//.test(specifier)
    )
      throw error;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // try the next
      }
    }
    throw error;
  }
}
