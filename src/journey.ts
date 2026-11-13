/**
 * One render journey: the root span of the request, the relayed backend calls
 * beneath it, and the trace context that ties them together (WIRE_SPEC.md v2).
 *
 * Pure and import-free on purpose, so every rule here is unit-testable without
 * a SvelteKit app. `start_ms` is always an OFFSET from the request start and
 * never a wall clock: two hosts with skewed clocks still order correctly, and
 * the reader only ever reads the relative value.
 */

export type SpanKind = 'server' | 'client';
export type SpanStatus = 'ok' | 'error' | 'unset';

export interface JourneySpan {
	span_id: string;
	parent_span_id?: string;
	kind: SpanKind;
	name: string;
	start_ms: number;
	duration_ms: number;
	status: SpanStatus;
	route?: string;
	peer_service?: string;
	tags?: Record<string, string | number>;
}

export interface RequestJourney {
	/** performance.now() at the first line of the request: every start_ms counts from here. */
	startedAt: number;
	traceId: string;
	rootSpanId: string;
	/** The 00-<trace>-<root span>-01 header sent out and returned on the response. */
	traceparent: string;
	route: string;
	sessionId: string | null;
	release: string | null;
	service: string;
	env: string;
	/** Tenant key the journey reports under. */
	project: string;
	spans: JourneySpan[];
}

export interface JourneyStart {
	route: string;
	service: string;
	env: string;
	project: string;
	sessionId?: string | null;
	release?: string | null;
	/** The inbound header, adopted only when it is a valid 00-<32 hex>-<16 hex>-01. */
	inboundTraceparent?: string | null;
}

export interface RelayStart {
	spanId: string;
	method: string;
	url: URL;
	/** The pattern of the callee's path, normalised by the caller. */
	route: string;
	startedAt: number;
	finishedAt: number;
	status?: Exclude<SpanStatus, 'unset'>;
}

/** W3C traceparent, exactly the v2 form the ingest accepts; anything else is malformed. */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/;

const journeys = new WeakMap<object, RequestJourney>();

function hex(bytes: number): string {
	const buffer = new Uint8Array(bytes);
	globalThis.crypto.getRandomValues(buffer);
	return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
}

/** A fresh 16 hex span id (the OTLP width). */
export function mintSpanId(): string {
	return hex(8);
}

export function roundMs(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.round(value * 100) / 100;
}

/** The offset of an event from the request start; an offset before it clamps to zero. */
export function relativeStartMs(requestStart: number, at: number): number {
	return roundMs(Math.max(0, at - requestStart));
}

export function elapsedMs(startedAt: number, endedAt: number): number {
	return roundMs(Math.max(0, endedAt - startedAt));
}

export function formatTraceparent(traceId: string, parentSpanId: string): string {
	return `00-${traceId}-${parentSpanId}-01`;
}

export function mintTraceContext(): { traceId: string; spanId: string; traceparent: string } {
	const traceId = hex(16);
	const spanId = mintSpanId();
	return { traceId, spanId, traceparent: formatTraceparent(traceId, spanId) };
}

/**
 * The inbound trace id, or null. A malformed header is ignored, never guessed
 * at: a salvaged trace key would silently group unrelated requests.
 */
export function adoptTraceparent(value: string | null | undefined): string | null {
	const match = TRACEPARENT.exec(value?.trim() ?? '');
	if (!match || /^0+$/.test(match[1])) {
		return null;
	}
	return match[1];
}

/** Begin the journey of this request: adopt a valid inbound trace, else mint one. */
export function startJourney(event: object, start: JourneyStart): RequestJourney {
	const traceId = adoptTraceparent(start.inboundTraceparent) ?? mintTraceContext().traceId;
	const rootSpanId = mintSpanId();
	const journey: RequestJourney = {
		startedAt: performance.now(),
		traceId,
		rootSpanId,
		traceparent: formatTraceparent(traceId, rootSpanId),
		route: start.route,
		sessionId: start.sessionId ?? null,
		release: start.release ?? null,
		service: start.service,
		env: start.env,
		project: start.project,
		spans: []
	};
	journeys.set(event, journey);
	return journey;
}

export function journeyFor(event: object): RequestJourney | undefined {
	return journeys.get(event);
}

/** One relayed backend call as a client span hanging off the request's root span. */
export function relaySpan(journey: RequestJourney, relay: RelayStart): JourneySpan {
	return {
		span_id: relay.spanId,
		parent_span_id: journey.rootSpanId,
		kind: 'client',
		name: `${relay.method.toUpperCase()} ${relay.url.host}`,
		start_ms: relativeStartMs(journey.startedAt, relay.startedAt),
		duration_ms: elapsedMs(relay.startedAt, relay.finishedAt),
		status: relay.status ?? 'ok',
		route: relay.route,
		peer_service: relay.url.host
	};
}
