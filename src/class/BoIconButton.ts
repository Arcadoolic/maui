import {escapeHtml} from '@/class/EscapeHtml';

export const ICON_SVG_ATTRS = 'width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" '
    + 'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

/** Icon-only submit button; `label` is its tooltip and accessible name. */
export function renderIconButton(
    label: string, svgPaths: string, tone: 'danger' | 'ok' | 'warn' | 'accent' = 'danger', disabled = false,
): string {
    // danger (red) is the default: removing/deleting; ok (green): restoring/enabling; warn
    // (amber): switching something off without losing it; accent (blue): neither, e.g. a new PIN.
    const toneClass = tone === 'danger' ? '' : ` icon-button-${tone}`;
    return `<button type="submit" class="icon-button${toneClass}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"${disabled ? ' disabled' : ''}>
        <svg ${ICON_SVG_ATTRS}>${svgPaths}</svg>
    </button>`;
}

// Stroke-only like the other icons; dots are zero-length round-capped lines.
export const GAMEPAD_ICON_PATHS = '<path d="M5 4h6c1.7 0 3.1 1.1 3.5 2.8l.9 3.9c.3 1.4-1.3 2.4-2.4 1.5L11 10.5H5'
    + 'l-2 1.7c-1.1.9-2.7-.1-2.4-1.5l.9-3.9C1.9 5.1 3.3 4 5 4z"/>'
    + '<path d="M4.6 6.1v2.8M3.2 7.5h2.8M10.7 8.3h.01M12.4 6.7h.01"/>';
export const KEY_MOUSE_ICON_PATHS = '<rect x="0.75" y="5" width="9.5" height="6.5" rx="1"/>'
    + '<path d="M2.8 7.2h.01M4.6 7.2h.01M6.4 7.2h.01M8.2 7.2h.01M3.4 9.4h4.2"/>'
    + '<rect x="11.5" y="4.5" width="3.75" height="7" rx="1.875"/><path d="M13.375 4.5v2.3"/>';

/**
 * A button adding a control: its icon above a caption that stays visible (`caption`, also what a
 * listening script rewrites, class "icon-caption-text", and the accessible name); `label` is its
 * tooltip. `attributes` are added as they are (type, name, value, data-*...).
 */
export function renderCaptionedIconButton(label: string, caption: string, svgPaths: string, attributes: string): string {
    return `<button ${attributes} class="captioned-icon-button" title="${escapeHtml(label)}">
        <svg ${ICON_SVG_ATTRS}>${svgPaths}</svg>
        <span class="icon-caption-text">${escapeHtml(caption)}</span>
    </button>`;
}
