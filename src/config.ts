/**
 * Producer identity for the wire: every payload carries `service` and `env`
 * (WIRE_SPEC.md v2). A configured name wins; the defaults keep a host that set
 * none on a working, correctly labelled install.
 */
import { env } from '$env/dynamic/private';
import { nv } from '@nightpost/js';

/** The package name is the service name of a host that configured none. */
export const DEFAULT_SERVICE = '@nightpost/sveltekit';

export function serviceName(override?: string): string {
	return override?.trim() || nv(env, 'SERVICE') || DEFAULT_SERVICE;
}

export function environmentName(override?: string): string {
	return override?.trim() || nv(env, 'ENV') || env.APP_ENV || 'production';
}

export function projectKey(override?: string): string {
	return override?.trim() || nv(env, 'PROJECT_KEY') || 'front';
}
