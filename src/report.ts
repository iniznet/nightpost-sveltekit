/**
 * Every sender this package owns. The v1 payloads keep their fields and only
 * gain the v2 identity (`service`, `env`, `route`, `span_id`, `spans[]`), so a
 * pre-v2 ingest answers exactly as before (WIRE_SPEC.md, additive only).
 */
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { monitorEnabled as monitorEnabledCore, post } from '@nightpost/js';
import type { HotspotLike, MonitorTrace, TreeNode } from '@nightpost/js';
import { environmentName, projectKey, serviceName } from './config.js';
import {
	elapsedMs,
	journeyFor,
	mintSpanId,
	roundMs,
	type JourneySpan,
	type RequestJourney
} from './journey.js';
import { normaliseRoute } from './route-pattern.js';

export type SessionStatus = 'ok' | 'crashed' | 'abnormal';

/**
 * One profile per request: a sampled `load` and the handle hook both report,
 * and the request's own spans must not be counted twice.
 */
const reported = new WeakSet<object>();

/** The route pattern this request is labelled with, from the journey when it exists. */
export function requestRoute(event: RequestEvent): string {
	return journeyFor(event)?.route ?? normaliseRoute(event.route?.id ?? null, event.url.pathname);
}

function serviceOf(journey?: RequestJourney): string {
	return journey?.service ?? serviceName();
}

function envOf(journey?: RequestJourney): string {
	return journey?.env ?? environmentName();
}

function projectOf(journey?: RequestJourney): string {
	return journey?.project ?? projectKey();
}

/** The payload's own span: the root of its trace, offset zero by definition. */
function rootSpan(event: RequestEvent, route: string, durationMs: number, status: number): JourneySpan {
	const journey = journeyFor(event);
	return {
		span_id: journey?.rootSpanId ?? mintSpanId(),
		kind: 'server',
		name: route,
		start_ms: 0,
		duration_ms: roundMs(durationMs),
		status: status >= 500 ? 'error' : 'ok',
		route,
		tags: {
			status,
			route,
			memory_rss_mb: Math.round((process.memoryUsage().rss / 1048576) * 100) / 100
		}
	};
}

export function reportProfile(
	event: RequestEvent,
	durationMs: number,
	status: number,
	hotspots?: HotspotLike[],
	trace?: MonitorTrace,
	tree?: TreeNode[]
): void {
	if (reported.has(event)) {
		return;
	}
	reported.add(event);
	const journey = journeyFor(event);
	const route = requestRoute(event);
	const root = rootSpan(event, route, durationMs, status);
	const payload: Record<string, unknown> = {
		name: `${event.request.method} ${route}`,
		duration_ms: root.duration_ms,
		type: hotspots?.length ? 'callgraph' : 'request',
		environment: envOf(journey),
		env: envOf(journey),
		service: serviceOf(journey),
		route,
		span_id: root.span_id,
		spans: [root, ...(journey?.spans ?? []), ...(trace?.spans ?? [])],
		hotspots
	};
	const traceId = trace?.id ?? journey?.traceId;
	if (traceId) {
		payload.trace_id = traceId;
	}
	if (tree && tree.length > 0) {
		payload.tree = tree;
	}
	post(env, `/ingest/${projectOf(journey)}/profile`, payload);
}

export function reportError(event: RequestEvent | undefined, err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? (err.stack ?? '') : '';
	const journey = event ? journeyFor(event) : undefined;
	post(env, `/ingest/${projectOf(journey)}/error`, {
		message,
		stack,
		url: event?.url.toString() ?? '',
		route: event ? requestRoute(event) : '',
		environment: envOf(journey),
		env: envOf(journey),
		service: serviceOf(journey),
		...(journey ? { span_id: journey.rootSpanId, trace_id: journey.traceId } : {})
	});
}

let releaseReported = false;

/**
 * One deploy marker per SSR process (#158): powers the monitor's
 * "new since release" badges and the sampled crash-free estimate. Tied to
 * the same opt-in as every other sender — inert without a URL. The version
 * string is host-specific (git sha), so the caller supplies it.
 */
export function reportReleaseOnce(version?: string | null): void {
	if (releaseReported || !monitorEnabledCore(env) || !version) {
		return;
	}
	releaseReported = true;
	post(env, `/ingest/${projectKey()}/release`, {
		version,
		environment: environmentName(),
		env: environmentName(),
		service: serviceName()
	});
}

/**
 * Session outcome beacon (WIRE_SPEC.md v2): the producer's own random key,
 * never a reader identifier, idempotent on (project, session_id) so a retry
 * updates the outcome without counting the session twice. Skipped when the
 * request carries no session id.
 */
export function reportSession(event: RequestEvent, status: SessionStatus, durationMs?: number): void {
	const journey = journeyFor(event);
	if (!journey?.sessionId) {
		return;
	}
	const elapsed = durationMs ?? elapsedMs(journey.startedAt, performance.now());
	const payload: Record<string, unknown> = {
		session_id: journey.sessionId,
		status,
		route: requestRoute(event),
		duration_ms: roundMs(elapsed),
		service: serviceOf(journey),
		env: envOf(journey)
	};
	if (journey.release) {
		payload.release = journey.release;
	}
	post(env, `/ingest/${projectOf(journey)}/session`, payload);
}
