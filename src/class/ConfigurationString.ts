// The single string a cabinet owner pastes into the BO to go ONLINE: `MAUI1.` + base64url(JSON
// {url, key, token}). Format owned by MAUI-API (its docs/DECISIONS.md D14, reference parser in
// app/Support/ConfigurationString.php).

export const CONFIGURATION_PREFIX = 'MAUI1.';
const API_PATH = '/api/v1';

export interface OnlineCredentials {
    // API base URL without the version prefix, see toApiBaseUrl().
    url: string;
    key: string;
    token: string;
}

export type ConfigurationStringErrorReason = 'unsupported_version' | 'malformed' | 'incomplete' | 'invalid_url';

const MESSAGES: Record<ConfigurationStringErrorReason, string> = {
    unsupported_version: 'Unsupported configuration, update MAUI.',
    malformed: 'This is not a MAUI configuration string (it should start with MAUI1.).',
    incomplete: 'Incomplete configuration string: url, key or token is missing.',
    invalid_url: 'The configuration string holds an invalid API URL.',
};

export class ConfigurationStringError extends Error {
    public constructor(public readonly reason: ConfigurationStringErrorReason) {
        super(MESSAGES[reason]);
        this.name = 'ConfigurationStringError';
    }
}

function decodePayload(payload: string): unknown {
    // Buffer's base64url decoder silently skips invalid characters: check the alphabet first.
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(payload)) {
        throw new ConfigurationStringError('malformed');
    }
    try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        throw new ConfigurationStringError('malformed');
    }
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value !== '';
}

function isHttpUrl(value: string): boolean {
    try {
        const {protocol} = new URL(value);
        return protocol === 'https:' || protocol === 'http:';
    } catch {
        return false;
    }
}

export function parseConfigurationString(input: string): OnlineCredentials {
    const trimmed = input.trim();
    if (!trimmed.startsWith(CONFIGURATION_PREFIX)) {
        throw new ConfigurationStringError(/^MAUI\d+\./.test(trimmed) ? 'unsupported_version' : 'malformed');
    }

    const data = decodePayload(trimmed.slice(CONFIGURATION_PREFIX.length));
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new ConfigurationStringError('malformed');
    }

    // Unknown fields are ignored on purpose: only a breaking change bumps the MAUI1 prefix.
    const {url, key, token} = data as Record<string, unknown>;
    if (!isNonEmptyString(url) || !isNonEmptyString(key) || !isNonEmptyString(token)) {
        throw new ConfigurationStringError('incomplete');
    }
    if (!isHttpUrl(url)) {
        throw new ConfigurationStringError('invalid_url');
    }
    return {url, key, token};
}

export function toApiBaseUrl(url: string): string {
    return url.replace(/\/+$/, '') + API_PATH;
}
