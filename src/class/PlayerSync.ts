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
}

export type PlayerSyncChange = Pick<LocalPlayer, 'id_user' | 'remote_id' | 'is_public' | 'online_status'>;

/**
 * The changes that bring `local` in line with `remote` (the players linked to this cabinet):
 * - a linked player takes the visibility and status of the API;
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
            target = {id_user: player.id_user, remote_id: match.id, is_public: match.isPublic, online_status: match.status};
        } else if (player.remote_id !== null) {
            target = {id_user: player.id_user, remote_id: null, is_public: player.is_public, online_status: null};
        } else {
            continue;
        }

        if (target.remote_id !== player.remote_id || target.is_public !== player.is_public
            || target.online_status !== player.online_status) {
            changes.push(target);
        }
    }
    return changes;
}

/** Fetches the players of this cabinet and applies planPlayerSync(). Returns the rows changed. */
export async function syncPlayers(client: MauiApiClient): Promise<ApiResult<number>> {
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
    }));
    const changes = planPlayerSync(local, remote.value);
    for (const {id_user: idUser, ...fields} of changes) {
        await User.update(fields, {where: {id_user: idUser}});
    }
    return {kind: 'ok', value: changes.length};
}
