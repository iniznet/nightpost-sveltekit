/**
 * @nightpost/sveltekit — SvelteKit adapter for the Nightpost reporter.
 *
 * Thin by contract: reads the app's dynamic private env, keeps the exact
 * helper names the reference wiring used (src/lib/server/monitor.ts, #145),
 * and delegates everything to @nightpost/js. Inert without a URL — nothing
 * here ever blocks or breaks a request. The project key reads
 * NIGHTPOST_PROJECT_KEY only (iniznet/fenrirealm-tracker#564).
 *
 * The journey half (root render span, relayed fetch spans, traceparent, session
 * beacon) lives in the `handle`/`handleError` hooks; see WIRE_SPEC.md v2.
 */
import { env } from '$env/dynamic/private';
import {
	forcedDeepAllowed as forcedDeepAllowedCore,
	monitorEnabled as monitorEnabledCore,
	shouldProfile as shouldProfileCore,
	shouldSample as shouldSampleCore
} from '@nightpost/js';

export {
	currentTrace,
	isTransportOutage,
	mintTrace,
	recordTraceSpan,
	runWithTrace,
	tracePropagationHeaders
} from '@nightpost/js';
export type { HotspotLike, MonitorSpan, MonitorTrace, TreeNode } from '@nightpost/js';

// The V8 profiler surface the reference wiring imported from its local
// monitor-profile module — re-exported so a host imports one module.
export {
	buildV8Tree,
	collapseNodes,
	startV8Profile,
	stopV8Profile
} from '@nightpost/js';
export type { V8Profile } from '@nightpost/js';

// The journey contract (WIRE_SPEC.md v2).
export { createHandle, createHandleError, handle, handleError, SESSION_COOKIE } from './hooks.js';
export type { HandleOptions } from './hooks.js';
export { normaliseRoute } from './route-pattern.js';
export {
	adoptTraceparent,
	elapsedMs,
	formatTraceparent,
	journeyFor,
	mintSpanId,
	mintTraceContext,
	relativeStartMs,
	relaySpan,
	roundMs,
	startJourney
} from './journey.js';
export type {
	JourneySpan,
	JourneyStart,
	RelayStart,
	RequestJourney,
	SpanKind,
	SpanStatus
} from './journey.js';
export { reportError, reportProfile, reportReleaseOnce, reportSession, requestRoute } from './report.js';
export type { SessionStatus } from './report.js';
export { environmentName, projectKey, serviceName } from './config.js';

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
