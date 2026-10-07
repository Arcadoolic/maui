import User from '@/model/User.model';
import type {ApiResult, MauiApiClient, OnlinePlayer, OnlinePlayerStatus} from '@/class/MauiApiClient';

// Keeps the local players in line with MAUI-API (maui-api docs/DECISIONS.md D48): visibility and
// status of the players linked to this cabinet, as GET /players reports them. Run by OnlineSession
// at startup and every few heartbeats. Never touches `active`, the BO's own switch: a player the
// API disabled or locked is told apart by `online_status` instead, so that lifting it upstream is
// enough to bring the player back.

export interface LocalPlayer {
    id_user: number;
    pseudo_3: string;
    remote_id: string | null;
    is_public: boolean;
    online_status: OnlinePlayerStatus | null;
    is_origin: boolean;
}

export type PlayerSyncChange = Pick<LocalPlayer, 'id_user' | 'remote_id' | 'is_public' | 'online_status' | 'is_origin'>;

/**
 * The changes that bring `local` in line with `remote` (the players linked to this cabinet):
 * - a linked player takes the visibility, status and origin (maui-api D54) of the API;
 * - a player the API no longer links to this cabinet becomes local only again;
 * - a local player without remote id gets the one of the API player with the same initials, the
 *   API being the reference (a link made before the id could be saved locally).
 * Only the rows that actually change are returned.
 */
export function planPlayerSync(local: LocalPlayer[], remote: OnlinePlayer[]): PlayerSyncChange[] {
    const byId = new Map(remote.map(player => [player.id, player]));
    const claimed = new Set(local.map(player => player.remote_id).filter(id => id !== null && byId.has(id)));
    const changes: PlayerSyncChange[] = [];

    for (const player of local) {
        let target: PlayerSyncChange;
        const linked = player.remote_id !== null ? byId.get(player.remote_id) : undefined;
        const adopted = player.remote_id === null
            ? remote.find(candidate => candidate.pseudo3 === player.pseudo_3 && !claimed.has(candidate.id))
            : undefined;
        const match = linked ?? adopted;

        if (match) {
            claimed.add(match.id);
            target = {
                id_user: player.id_user, remote_id: match.id, is_public: match.isPublic, online_status: match.status,
                is_origin: match.isOrigin,
            };
        } else if (player.remote_id !== null) {
            target = {id_user: player.id_user, remote_id: null, is_public: player.is_public, online_status: null, is_origin: false};
        } else {
            continue;
        }

        if (target.remote_id !== player.remote_id || target.is_public !== player.is_public
            || target.online_status !== player.online_status || target.is_origin !== player.is_origin) {
            changes.push(target);
        }
    }
    return changes;
}

/**
 * The avatar of a local player, as a PNG and its SHA-256; null without one. Given by the BO
 * (boServer.ts), which knows where avatars are.
 */
export type LocalAvatarReader = (pseudo3: string) => {png: Uint8Array; hash: string} | null;

/** Writes the avatar of a local player. Given by the main process, as LocalAvatarReader is. */
export type LocalAvatarWriter = (pseudo3: string, png: Uint8Array) => void;

/**
 * Sends the avatar of each player created on this cabinet whose PNG differs from the one MAUI-API
 * has (maui-api D53): created or changed since. A player's picture is only changed where the
 * player was created (maui-api D56): the other cabinets it is linked to take it from MAUI-API
 * (downloadAvatars()). A PNG MAUI-API refused is not sent again during this run.
 */
export async function uploadAvatars(
    client: MauiApiClient, local: LocalPlayer[], remote: OnlinePlayer[], readAvatar: LocalAvatarReader, refused: Set<string>,
): Promise<number> {
    const byId = new Map(remote.map(player => [player.id, player]));
    let sent = 0;
    for (const player of local) {
        const online = player.remote_id !== null ? byId.get(player.remote_id) : undefined;
        const avatar = online?.isOrigin ? readAvatar(player.pseudo_3) : null;
        if (!online || !avatar || avatar.hash === online.avatar || refused.has(avatar.hash)) {
            continue;
        }
        const result = await client.uploadAvatar(online.id, avatar.png);
        if (result.kind === 'ok') {
            sent++;
        } else if (result.kind === 'rejected') {
            refused.add(avatar.hash);
        }
    }
    return sent;
}

/**
 * Takes from MAUI-API the avatar of each player linked to this cabinet but created on another one,
 * when it differs from the local picture (the default one a link starts with, or an older one):
 * it becomes the player's local avatar, shown by the front and the BO alike. A player without an
 * avatar upstream keeps its local one.
 */
export async function downloadAvatars(
    client: MauiApiClient, local: LocalPlayer[], remote: OnlinePlayer[], readAvatar: LocalAvatarReader,
    saveAvatar: LocalAvatarWriter,
): Promise<number> {
    const byId = new Map(remote.map(player => [player.id, player]));
    let saved = 0;
    for (const player of local) {
        const online = player.remote_id !== null ? byId.get(player.remote_id) : undefined;
        if (!online || online.isOrigin || online.avatar === null || readAvatar(player.pseudo_3)?.hash === online.avatar) {
            continue;
        }
        const png = await client.getAvatar(online.id);
        if (png.kind === 'ok') {
            saveAvatar(player.pseudo_3, png.value);
            saved++;
        }
    }
    return saved;
}

/** Fetches the players of this cabinet and applies planPlayerSync(). Returns the rows changed. */
export async function syncPlayers(
    client: MauiApiClient, readAvatar?: LocalAvatarReader, refusedAvatars: Set<string> = new Set(),
    saveAvatar?: LocalAvatarWriter,
): Promise<ApiResult<number>> {
    const remote = await client.listPlayers();
    if (remote.kind !== 'ok') {
        return remote;
    }
    const local = (await User.findAll()).map(user => ({
        id_user: user.id_user,
        pseudo_3: user.pseudo_3,
        remote_id: user.remote_id ?? null,
        is_public: !!user.is_public,
        online_status: user.online_status ?? null,
        is_origin: !!user.is_origin,
    }));
    const changes = planPlayerSync(local, remote.value);
    for (const {id_user: idUser, ...fields} of changes) {
        await User.update(fields, {where: {id_user: idUser}});
    }
    if (readAvatar) {
        const synced = local.map(player => ({...player, ...changes.find(change => change.id_user === player.id_user)}));
        await uploadAvatars(client, synced, remote.value, readAvatar, refusedAvatars);
        if (saveAvatar) {
            await downloadAvatars(client, synced, remote.value, readAvatar, saveAvatar);
        }
    }
    return {kind: 'ok', value: changes.length};
}
