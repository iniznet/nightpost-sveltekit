/**
 * @nightpost/sveltekit — SvelteKit adapter for the Nightpost reporter.
 *
 * Thin by contract: reads the app's dynamic private env, keeps the exact
 * helper names the reference wiring used (src/lib/server/monitor.ts, #145),
 * and delegates everything to @nightpost/js. Inert without a URL — nothing
 * here ever blocks or breaks a request.
 */
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';
import {
	forcedDeepAllowed as forcedDeepAllowedCore,
	monitorEnabled as monitorEnabledCore,
	post,
	shouldProfile as shouldProfileCore,
	shouldSample as shouldSampleCore
} from '@nightpost/js';
import type { HotspotLike, MonitorTrace, TreeNode } from '@nightpost/js';

export {
	currentTrace,
	isTransportOutage,
	mintTrace,
	recordTraceSpan,
	runWithTrace,
	tracePropagationHeaders
} from '@nightpost/js';
export type { HotspotLike, MonitorSpan, MonitorTrace, TreeNode } from '@nightpost/js';

export function monitorEnabled(): boolean {
	return monitorEnabledCore(env);
}

export function shouldSample(): boolean {
	return shouldSampleCore(env);
}

export function shouldProfile(): boolean {
	return shouldProfileCore(env);
}

export function forcedDeepAllowed(): boolean {
	return forcedDeepAllowedCore(env);
}

export function reportProfile(
	event: RequestEvent,
	durationMs: number,
	status: number,
	hotspots?: HotspotLike[],
	trace?: MonitorTrace,
	tree?: TreeNode[]
): void {
	const route = event.route?.id ?? event.url.pathname;
	const rounded = Math.round(durationMs * 100) / 100;
	const payload: Record<string, unknown> = {
		name: `${event.request.method} ${route}`,
		duration_ms: rounded,
		type: hotspots?.length ? 'callgraph' : 'request',
		environment: env.APP_ENV ?? 'production',
		spans: [
			{
				name: 'request',
				duration_ms: rounded,
				tags: {
					status,
					route,
					memory_rss_mb: Math.round((process.memoryUsage().rss / 1048576) * 100) / 100
				}
			},
			...(trace?.spans ?? [])
		],
		hotspots
	};
	if (trace) {
		payload.trace_id = trace.id;
	}
	if (tree && tree.length > 0) {
		payload.tree = tree;
	}
	post(env, `/ingest/${env.NIGHTPOST_PROJECT_KEY ?? env.MONITOR_PROJECT_KEY ?? 'front'}/profile`, payload);
}

export function reportError(event: RequestEvent | undefined, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? (err.stack ?? '') : '';
	post(env, `/ingest/${env.NIGHTPOST_PROJECT_KEY ?? env.MONITOR_PROJECT_KEY ?? 'front'}/error`, {
		message,
		stack,
		url: event?.url.toString() ?? '',
		route: event?.route?.id ?? '',
		environment: env.APP_ENV ?? 'production'
	});
}

let releaseReported = false;

/**
 * One deploy marker per SSR process (#158): powers the monitor's
 * "new since release" badges and the sampled crash-free estimate. Tied to
 * the same opt-in as every other sender — inert without a URL. The version
 * string is host-specific (git sha), so the caller supplies it.
 */
export function reportReleaseOnce(version: string): void {
	if (releaseReported || !monitorEnabled() || !version) return;
	releaseReported = true;
	post(env, `/ingest/${env.NIGHTPOST_PROJECT_KEY ?? env.MONITOR_PROJECT_KEY ?? 'front'}/release`, {
		version,
		environment: env.APP_ENV ?? 'production'
	});
}
