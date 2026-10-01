# Pack repository (ONLINE mode)

Game packs and the configuration pack (`mame-conf-pack.zip`) are downloaded from the pack repository ([maui-repository](https://github.com/Arcadoolic/maui-repository)). The cabinet never stores the repository URL or dedicated credentials: everything goes through ONLINE mode and MAUI-API.

```mermaid
sequenceDiagram
    autonumber
    participant BO as BO server (boServer.ts)
    participant API as MAUI-API
    participant Repo as Pack repository
    participant Py as import-starting-pack.py

    Note over BO: online.json enabled? (local check, no network)<br/>otherwise 403 "ONLINE mode only"
    BO->>API: GET /repository (key + token + machine fingerprint)
    API-->>BO: { url } (or null: no repository)
    Note over BO: https only (http tolerated if the API itself is http)<br/>resolved before every action, no cache
    BO->>Repo: GET index.json, manifests (X-Maui-Key, Bearer token, X-Maui-Machine)
    Repo->>API: Caddy forward_auth: GET /api/v1/repository/authorize (same headers)
    API-->>Repo: OK / problem+json (relayed as is)
    Repo-->>BO: pack list (proxied: credentials never reach the browser)
    BO->>Py: spawn --url <repo>/<pack>.zip (credentials in env: MAUI_REPO_*)
    Py->>Repo: download conf pack first, then game packs (Range requests with --only)
```

- **Source of truth**: `online.json` (`~/.mame-awesome-ui/`) holds the MAUI-API URL, key and token; the repository URL comes from `GET /repository` (`src/class/RepositoryAuth.ts`).
- **Token protection**: redirects are refused (Node `redirect: 'error'`, custom handler in the Python script), and credentials go through the script's environment, never argv (`ps`).
- **Order**: the configuration pack is reinstalled before every game pack import; the game pack list stays locked until `catver.ini`, `genre.ini` and `Multiplayer.ini` are installed (`src/class/ConfPack.ts`).
- **OFFLINE cabinets** have no repository access and no manual pack upload in the BO: they are set up by hand.

## See also

- Repository side (hosting, publishing packs, the Caddy container): [`maui-repository/docs/STARTER-PACK-REPO.md`](https://github.com/Arcadoolic/maui-repository/blob/develop/docs/STARTER-PACK-REPO.md)
- Design decision: maui-api `docs/DECISIONS.md` D46
