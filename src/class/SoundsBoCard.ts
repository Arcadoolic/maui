import {escapeHtml} from '@/class/EscapeHtml';
import {UI_SOUND_TOGGLES, type UiSoundToggle} from '@/class/UiSounds';
import type Config from '@/class/Config.class';

// The MAUI tab's Sounds subtab (POST /maui/sounds/save): the games' volume (Volume.ts), MAUI's own
// sounds (UiSounds.ts), and each of them played on the cabinet (POST /maui/ui-sounds/test) and
// switched off on its own.

const SOUNDS: Record<UiSoundToggle, {label: string; when: string}> = {
    move: {label: 'Next game', when: 'Each game up or down the list.'},
    category: {label: 'Category', when: 'Each category left or right.'},
    alphaJump: {label: 'Initial', when: 'Each initial while up or down is held, in "All games" and "Hiscores only".'},
    launch: {label: 'Insert coin', when: 'A game is launched.'},
    back: {label: 'Back', when: 'Back from a game.'},
    voteUp: {label: 'Thumbs up', when: 'A thumbs up after a game.'},
    voteDown: {label: 'Thumbs down', when: 'A thumbs down after a game.'},
    star: {label: 'Star', when: 'The star after a game.'},
    newPlayer: {label: '1UP', when: 'A player is created or linked to the cabinet.'},
    champion: {label: 'Fanfare', when: 'The cabinet\'s best score on the game went up.'},
    hotkeyCharge: {label: 'Charge', when: 'While a hotkey is held, until it goes off.'},
    wake: {label: 'Power on', when: 'The cabinet wakes up from sleep.'},
    updated: {label: 'Updated', when: 'A new version of MAUI is installed.'},
};

// The Play buttons: the sound of the row at the volume typed in, saved or not.
const PLAY_SCRIPT = `<script>(function () {
    var result = document.querySelector('[data-ui-sound-result]');
    document.querySelectorAll('[data-ui-sound]').forEach(function (button) {
        button.addEventListener('click', function () {
            var body = new URLSearchParams({
                sound: button.dataset.uiSound,
                volume: document.getElementById('uiSoundsVolume').value,
            });
            fetch('/maui/ui-sounds/test', {method: 'POST', body: body, credentials: 'same-origin'})
                .then(function (response) {
                    result.textContent = response.ok ? 'Played on the cabinet.' : 'The cabinet\\'s screen is not open, or a game is running.';
                })
                .catch(function () { result.textContent = 'No answer from the cabinet.'; });
        });
    });
})();</script>`;

function renderCheckbox(name: string, checked: boolean, label: string, detail: string): string {
    return `
                <label class="checkbox-row">
                    <input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>
                    <span>${label} <span class="checkbox-row-detail">${detail}</span></span>
                </label>`;
}

function renderSoundRows(disabled: UiSoundToggle[]): string {
    return UI_SOUND_TOGGLES.map(name => `
                        <tr>
                            <td><input type="checkbox" name="uiSoundsOn" value="${name}" aria-label="${escapeHtml(SOUNDS[name].label)}"
                                ${disabled.includes(name) ? '' : 'checked'}></td>
                            <td>${escapeHtml(SOUNDS[name].label)}</td>
                            <td>${escapeHtml(SOUNDS[name].when)}</td>
                            <td><button type="button" data-ui-sound="${name}">Play</button></td>
                        </tr>`).join('');
}

export function renderSoundsCard(config: Config, info?: string): string {
    return `
        <section class="card">
            <h2>Sounds</h2>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/maui/sounds/save">
                <label for="gamesVolume">Volume of the games, in % <span class="checkbox-row-detail">From the next game launched. 100 leaves MAME's own level.</span></label>
                <input type="number" id="gamesVolume" name="gamesVolume" min="0" max="100" step="5" value="${config.gamesVolume}">
                ${renderCheckbox('uiSoundsEnabled', config.uiSoundsEnabled, 'MAUI\'s sounds',
                    'Short bleeps on the list of games and around a game. The games\' own sound is not affected.')}
                <label for="uiSoundsVolume">Volume of MAUI's sounds, in % <span class="checkbox-row-detail">Of the system's volume, which stays as it is.</span></label>
                <input type="number" id="uiSoundsVolume" name="uiSoundsVolume" min="0" max="100" step="5" value="${config.uiSoundsVolume}">
                <p>Each sound, played on the cabinet at the volume above, even unticked. Unticked, the cabinet does not play it.</p>
                <p class="checkbox-row-detail" data-ui-sound-result role="status"></p>
                <div class="table-wrap">
                    <table class="favorites-table">
                        <thead><tr><th>On</th><th>Sound</th><th>When</th><th></th></tr></thead>
                        <tbody>${renderSoundRows(config.uiSoundsDisabled)}</tbody>
                    </table>
                </div>
                <button type="submit">Save</button>
            </form>
            ${PLAY_SCRIPT}
        </section>`;
}

/** The sounds left unticked in the form: its `uiSoundsOn` field holds the ticked ones. */
export function disabledFromForm(ticked: unknown): UiSoundToggle[] {
    const on = Array.isArray(ticked) ? ticked : typeof ticked === 'string' ? [ticked] : [];
    return UI_SOUND_TOGGLES.filter(name => !on.includes(name));
}
