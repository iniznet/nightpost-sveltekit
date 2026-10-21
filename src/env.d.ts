// Standalone typecheck shim: in a real SvelteKit app the generated
// .svelte-kit/ambient.d.ts declares this module with the app's own env.
declare module '$env/dynamic/private' {
	export const env: Record<string, string | undefined>;
}
