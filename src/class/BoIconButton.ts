import {escapeHtml} from '@/class/EscapeHtml';

export const ICON_SVG_ATTRS = 'width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" '
    + 'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

/** Icon-only submit button; `label` is its tooltip and accessible name. */
export function renderIconButton(
    label: string, svgPaths: string, tone: 'danger' | 'ok' | 'warn' | 'accent' = 'danger',
): string {
    // danger (red) is the default: removing/deleting; ok (green): restoring/enabling; warn
    // (amber): switching something off without losing it; accent (blue): neither, e.g. a new PIN.
    const toneClass = tone === 'danger' ? '' : ` icon-button-${tone}`;
    return `<button type="submit" class="icon-button${toneClass}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        <svg ${ICON_SVG_ATTRS}>${svgPaths}</svg>
    </button>`;
}
