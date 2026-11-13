/**
 * Route PATTERN normalisation for the journey wire contract (WIRE_SPEC.md v2):
 * a `route` and a server span's `name` are the pattern, never the URL that hit
 * it. Two readers on /chapters/7 and /chapters/8 are one route, and the pattern
 * is the only join key a reader can group on, so an id must never travel in a
 * span name.
 */

/** `[id]`, `[[id]]`, `[...rest]` and `[[...rest]]` collapse the same way. */
const DYNAMIC_SEGMENT = /^\[{1,2}\.{0,3}[^\[\]]+\]{1,2}$/;

/** SvelteKit route groups `(app)` are not part of the URL shape. */
const GROUP_SEGMENT = /^\(.+\)$/;

/** A concrete value standing where a parameter belongs, when only the URL is left. */
const ID_SEGMENT =
	/^(?:\d+|\d+-[^/]*|[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function collapse(segments: string[], collapseIds: boolean): string {
	return segments
		.filter((segment) => !GROUP_SEGMENT.test(segment))
		.map((segment) => {
			if (DYNAMIC_SEGMENT.test(segment)) {
				return '{param}';
			}
			if (collapseIds && ID_SEGMENT.test(segment)) {
				return '{param}';
			}
			return segment;
		})
		.join('/');
}

/**
 * The pattern a request should be labelled with: SvelteKit's route id when the
 * request matched one, otherwise the pathname with its id-shaped segments
 * collapsed. Always the same shape for the same page, never the raw URL.
 */
export function normaliseRoute(routeId: string | null | undefined, pathname: string): string {
	const pattern = routeId?.trim();
	if (pattern) {
		return collapse(pattern.split('/'), false) || '/';
	}
	return collapse(pathname.split('/'), true) || '/';
}
