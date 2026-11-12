import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	adoptTraceparent,
	elapsedMs,
	formatTraceparent,
	mintTraceContext,
	relativeStartMs,
	relaySpan,
	roundMs,
	startJourney
} from '../src/journey.ts';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN = '00f067aa0ba902b7';

test('a span start is an offset from the request start, never a wall clock', () => {
	const requestStart = 12_345.5;
	assert.equal(relativeStartMs(requestStart, requestStart), 0);
	assert.equal(relativeStartMs(requestStart, requestStart + 42), 42);
	// The same gap on two hosts with different clocks yields the same offset.
	assert.equal(relativeStartMs(1_000, 1_042), relativeStartMs(9_000_000, 9_000_042));
});

test('an offset before the request start clamps to zero', () => {
	assert.equal(relativeStartMs(1_000, 990), 0);
	assert.equal(relativeStartMs(Number.NaN, 5), 0);
});

test('elapsed time is the gap, rounded to two decimals', () => {
	assert.equal(elapsedMs(1_000, 1_000.456), 0.46);
	assert.equal(elapsedMs(1_000, 990), 0);
	assert.equal(roundMs(Number.POSITIVE_INFINITY), 0);
});

test('a relayed backend call is a client span under the root, offsets and all', () => {
	const journey = startJourney({}, {
		route: '/chapters/{param}',
		service: 'front',
		env: 'production',
		project: 'front'
	});
	const span = relaySpan(journey, {
		spanId: SPAN,
		method: 'get',
		url: new URL('http://api.internal:8000/chapters/42'),
		route: '/chapters/{param}',
		startedAt: journey.startedAt + 25,
		finishedAt: journey.startedAt + 86
	});
	assert.equal(span.kind, 'client');
	assert.equal(span.parent_span_id, journey.rootSpanId);
	assert.equal(span.start_ms, 25);
	assert.equal(span.duration_ms, 61);
	assert.equal(span.status, 'ok');
	assert.equal(span.name, 'GET api.internal:8000');
	assert.equal(span.peer_service, 'api.internal:8000');
	assert.equal(span.route, '/chapters/{param}');
});

test('traceparent is adopted only in the exact 00-<32 hex>-<16 hex>-01 form', () => {
	assert.equal(adoptTraceparent(`00-${TRACE}-${SPAN}-01`), TRACE);
	assert.equal(adoptTraceparent(` 00-${TRACE}-${SPAN}-01 `), TRACE);
	assert.equal(adoptTraceparent(`00-${TRACE.toUpperCase()}-${SPAN}-01`), null);
	assert.equal(adoptTraceparent(`00-${TRACE}-${SPAN}-00`), null);
	assert.equal(adoptTraceparent(`01-${TRACE}-${SPAN}-01`), null);
	assert.equal(adoptTraceparent(`00-${TRACE}-${SPAN}`), null);
	assert.equal(adoptTraceparent('00-00000000000000000000000000000000-' + SPAN + '-01'), null);
	assert.equal(adoptTraceparent(undefined), null);
});

test('a minted context is a valid traceparent of the exact width', () => {
	const minted = mintTraceContext();
	assert.match(minted.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
	assert.equal(formatTraceparent(minted.traceId, minted.spanId), minted.traceparent);
});

test('an adopted inbound trace joins the journey and keeps its own root span', () => {
	const event = {};
	const journey = startJourney(event, {
		route: '/chapters/{param}',
		service: 'front',
		env: 'production',
		project: 'front',
		inboundTraceparent: `00-${TRACE}-${SPAN}-01`
	});
	assert.equal(journey.traceId, TRACE);
	assert.match(journey.traceparent, new RegExp(`^00-${TRACE}-[0-9a-f]{16}-01$`));
	assert.equal(journey.spans.length, 0);
});

test('a malformed inbound traceparent mints instead of salvaging', () => {
	const journey = startJourney({}, {
		route: '/',
		service: 'front',
		env: 'production',
		project: 'front',
		inboundTraceparent: `00-${TRACE}-${SPAN}-00`
	});
	assert.notEqual(journey.traceId, TRACE);
	assert.match(journey.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});
