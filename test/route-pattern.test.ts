import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseRoute } from '../src/route-pattern.ts';

test('a route id collapses its dynamic segment to {param}', () => {
	assert.equal(normaliseRoute('/chapters/[id]', '/chapters/42'), '/chapters/{param}');
});

test('rest and optional segments collapse like a plain parameter', () => {
	assert.equal(
		normaliseRoute('/series/[slug]/chapters/[...rest]', '/series/x/chapters/1/2'),
		'/series/{param}/chapters/{param}'
	);
	assert.equal(normaliseRoute('/export/[[...path]]', '/export'), '/export/{param}');
});

test('a route group is not part of the pattern', () => {
	assert.equal(normaliseRoute('/(app)/series/[id]', '/series/9'), '/series/{param}');
});

test('a request that matched no route falls back to the URL with its ids collapsed', () => {
	assert.equal(normaliseRoute(null, '/chapters/42'), '/chapters/{param}');
	assert.equal(
		normaliseRoute(undefined, '/users/0f8fad5b-d9cb-469f-a165-70867728950e'),
		'/users/{param}'
	);
	assert.equal(normaliseRoute(null, '/chapters/42/comments'), '/chapters/{param}/comments');
});

test('a static path is returned untouched', () => {
	assert.equal(normaliseRoute('/api/health', '/api/health'), '/api/health');
	assert.equal(normaliseRoute(null, '/'), '/');
});

test('the raw URL never survives in the pattern', () => {
	const pattern = normaliseRoute('/chapters/[id]', '/chapters/42');
	assert.ok(!pattern.includes('42'));
	assert.equal(pattern, '/chapters/{param}');
});
