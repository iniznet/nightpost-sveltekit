/**
 * The server hook half of the journey contract (WIRE_SPEC.md v2): one root
 * render span per request, a child span for every relayed `event.fetch`, one
 * `traceparent` per request on the way out and back, and a session outcome
 * beacon. Additive by design — a host that still calls `reportProfile` from a
 * sampled `load` keeps working, and the first payload for a request wins.
 *
 * Inert without NIGHTPOST_URL, like every other sender in this package: a
 * render never fails because the monitor is absent.
 */
import type { Handle, HandleServerError, RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { monitorEnabled as monitorEnabledCore, nv } from '@nightpost/js';
import { environmentName, projectKey, serviceName } from './config.js';
import {
	elapsedMs,
	formatTraceparent,
	mintSpanId,
	relaySpan,
	startJourney,
	type RequestJourney
} from './journey.js';
import { normaliseRoute } from './route-pattern.js';
import { reportProfile, reportSession } from './report.js';

/** The cookie carrying the producer's own random session key. */
export const SESSION_COOKIE = 'np_session';

export interface HandleOptions {
	/** Producer identity name; defaults to NIGHTPOST_SERVICE, then the package name. */
	service?: string;
	/** Producer environment; defaults to NIGHTPOST_ENV, then APP_ENV, then production. */
	env?: string;
	/** Tenant key in the monitor; defaults to NIGHTPOST_PROJECT_KEY, then 'front'. */
	project?: string;
	/** Deploy version the session beacon reports; defaults to NIGHTPOST_RELEASE. */
	release?: string | null;
	/** Session cookie name; an empty string opts the session beacon out. */
	sessionCookie?: string;
}

/**
 * The session id: the host's own cookie when present, else a minted key set on
 * the response. Null when the cookie API is unavailable (no beacon, never an
 * error).
 */
function readSession(event: RequestEvent, cookie: string): string | null {
	if (!cookie) {
		return null;
	}
	try {
		const existing = event.cookies.get(cookie);
		if (existing) {
			return existing;
		}
		const minted = mintSpanId() + mintSpanId();
		event.cookies.set(cookie, minted, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: event.url.protocol === 'https:'
		});
		return minted;
	} catch {
		return null;
	}
}

/**
 * `event.fetch` with a span around it: a backend that never answers still gets
 * its client span, so the gap surfaces in the journey instead of vanishing.
 */
function relayFetch(
	event: RequestEvent,
	journey: RequestJourney,
	relay: typeof fetch
): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const target = new URL(input instanceof Request ? input.url : String(input), event.url);
		const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
		const spanId = mintSpanId();
		const startedAt = performance.now();
		const headers = new Headers(
			init?.headers ?? (input instanceof Request ? input.headers : undefined)
		);
		headers.set('traceparent', formatTraceparent(journey.traceId, spanId));
		let status: 'ok' | 'error' = 'ok';
		try {
			const response = await relay(input, { ...init, headers });
			status = response.status >= 500 ? 'error' : 'ok';
			return response;
		} catch (error) {
			status = 'error';
			throw error;
		} finally {
			journey.spans.push(
				relaySpan(journey, {
					spanId,
					method,
					url: target,
					route: normaliseRoute(null, target.pathname),
					// Both instants are read from the same clock as journey.startedAt,
					// so the span carries an offset, never a wall clock.
					startedAt,
					finishedAt: performance.now(),
					status
				})
			);
		}
	}) as typeof fetch;
}

export function createHandle(options: HandleOptions = {}): Handle {
	return async ({ event, resolve }) => {
		if (!monitorEnabledCore(env)) {
			return resolve(event);
		}
		const journey = startJourney(event, {
			route: normaliseRoute(event.route?.id ?? null, event.url.pathname),
			service: serviceName(options.service),
			env: environmentName(options.env),
			project: projectKey(options.project),
			sessionId: readSession(event, options.sessionCookie ?? SESSION_COOKIE),
			release: options.release ?? nv(env, 'RELEASE') ?? null,
			inboundTraceparent: event.request.headers.get('traceparent')
		});
		try {
			// Joinable from outside: the caller gets this request's trace back.
			event.setHeaders({ traceparent: journey.traceparent });
		} catch {
			// A page that already set traceparent keeps it; telemetry never breaks a render.
		}
		event.fetch = relayFetch(event, journey, event.fetch);
		try {
			const response = await resolve(event);
			const elapsed = elapsedMs(journey.startedAt, performance.now());
			reportProfile(event, elapsed, response.status);
			reportSession(event, response.status >= 500 ? 'abnormal' : 'ok', elapsed);
			return response;
		} catch (error) {
			const elapsed = elapsedMs(journey.startedAt, performance.now());
			reportProfile(event, elapsed, 500);
			reportSession(event, 'crashed', elapsed);
			throw error;
		}
	};
}

/** A render error reached the error page: that session crashed rather than completed. */
export function createHandleError(): HandleServerError {
	return ({ event }) => {
		reportSession(event, 'crashed');
	};
}

export const handle: Handle = createHandle();

export const handleError: HandleServerError = createHandleError();
