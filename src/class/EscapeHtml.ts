// Every value interpolated into BO HTML goes through this. Attributes are always double-quoted,
// which is why a single quote needs no escaping.
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
