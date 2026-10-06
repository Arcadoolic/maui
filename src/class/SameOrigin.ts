// CSRF guard for BO routes that change where secrets are sent (the ONLINE credentials): the BO is
// reachable from the whole LAN and has no CSRF token, so a page on another site must not be able
// to post to it with the owner's session. Browsers always send Origin on a cross-site POST; the
// Referer fallback only covers old browsers that omit it on same-origin POSTs. Neither header, or
// the opaque "null" Origin, is refused.

export interface OriginHeaders {
    origin?: string;
    referer?: string;
    host?: string;
}

function hostOf(url: string): string | null {
    try {
        return new URL(url).host.toLowerCase();
    } catch {
        return null;
    }
}

export function isSameOriginRequest({origin, referer, host}: OriginHeaders): boolean {
    if (!host) {
        return false;
    }
    const source = origin ?? referer;
    if (source === undefined) {
        return false;
    }
    return hostOf(source) === host.toLowerCase();
}
