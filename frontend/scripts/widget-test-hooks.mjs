export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
        return {
            url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href,
            shortCircuit: true,
        };
    }
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.json')) {
        return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
}
