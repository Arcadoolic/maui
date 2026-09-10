import express from 'express';
import {Server} from 'http';
import {existsSync, mkdirSync, readdirSync} from 'fs';
import {join, dirname} from 'path';
import * as os from 'os';
import {execFile} from 'child_process';
import Config from '@/class/Config.class';

declare const __static: string;

type PathField = 'mamePath' | 'avatarsPath';

const MAME_BINARY_NAMES = ['mame.exe', 'mame64.exe', 'mame'];

function findMameBinary(mamePath: string): string|null {
    for (const name of MAME_BINARY_NAMES) {
        if (existsSync(join(mamePath, name))) {
            return name;
        }
    }
    return null;
}

/**
 * Same directory MameService pins mame's ini/home to (see Helpers.getMameHomePath()).
 * Duplicated here rather than imported: Helpers.class.ts pulls in the renderer-only
 * @electron/remote at module scope, which isn't safe to load in the main process bundle.
 */
function getMameHomePath(): string {
    const homePath = join(os.homedir(), '.mame-awesome-ui', 'mame-home');
    if (!existsSync(homePath)) {
        mkdirSync(homePath, {recursive: true});
    }
    return homePath;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderPage(body: string): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <title>mame-awesome-ui - Configuration</title>
    <style>
        html {
            min-height: 100%;
            background-color: #000000;
            background-image: url('/background.jpg');
            background-size: cover;
            background-repeat: repeat;
            background-position: 0 0;
        }
        body {
            color: #ffffff;
            font-family: sans-serif;
            max-width: 480px;
            margin: 48px auto;
            padding: 24px 16px;
            background-color: rgba(0, 0, 0, 0.55);
            border-radius: 8px;
        }
        a {
            color: #8ab4f8;
        }
        label {
            display: block;
            margin-top: 16px;
        }
        input {
            width: 100%;
            box-sizing: border-box;
            padding: 8px;
            margin-top: 4px;
        }
        button {
            padding: 8px 16px;
            color: #000000;
        }
        form > button[type="submit"]:last-child {
            margin-top: 24px;
        }
        .error {
            color: #ff6b6b;
        }
        .info {
            color: #8ab4f8;
        }
        .launch-form {
            margin-top: 40px;
            padding-top: 24px;
            border-top: 1px solid #333333;
        }
        .path-row {
            display: flex;
            gap: 8px;
            margin-top: 4px;
        }
        .path-row input {
            margin-top: 0;
        }
        .current-path {
            font-family: monospace;
            word-break: break-all;
            background-color: #111111;
            padding: 8px;
        }
        .button-link {
            display: inline-block;
            padding: 8px 16px;
            background-color: #ffffff;
            color: #000000;
            text-decoration: none;
            border-radius: 4px;
        }
        .browse-list {
            list-style: none;
            padding: 0;
            margin: 16px 0;
            max-height: 400px;
            overflow-y: auto;
        }
        .browse-list li {
            padding: 6px 0;
            border-bottom: 1px solid #222222;
        }
    </style>
</head>
<body>
    ${body}
</body>
</html>`;
}

function renderForm(values: {mamePath: string, avatarsPath: string}, error?: string, info?: string): string {
    return renderPage(`
        <h1>Configuration mame-awesome-ui</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        ${info ? `<p class="info">${escapeHtml(info)}</p>` : ''}
        <form method="post" action="/save" novalidate>
            <label for="mamePath">Dossier contenant le binaire mame</label>
            <div class="path-row">
                <input type="text" id="mamePath" name="mamePath" value="${escapeHtml(values.mamePath)}">
                <button type="submit" formaction="/browse?target=mamePath" formmethod="get">Parcourir</button>
            </div>
            <label for="avatarsPath">Dossier des avatars utilisateurs</label>
            <div class="path-row">
                <input type="text" id="avatarsPath" name="avatarsPath" value="${escapeHtml(values.avatarsPath)}">
                <button type="submit" formaction="/browse?target=avatarsPath" formmethod="get">Parcourir</button>
            </div>
            <button type="submit">Enregistrer</button>
        </form>
        <form method="post" action="/launch" class="launch-form">
            <button type="submit">Lancer mame</button>
        </form>
    `);
}

function renderBrowsePage(target: PathField, currentDir: string, formValues: {mamePath: string, avatarsPath: string}): string {
    let entries: string[] = [];
    let error: string|undefined;
    try {
        entries = readdirSync(currentDir, {withFileTypes: true})
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch {
        error = `Impossible de lire le dossier "${currentDir}".`;
    }

    const parentDir = dirname(currentDir);
    const canGoUp = parentDir !== currentDir;
    const carryQuery = `mamePath=${encodeURIComponent(formValues.mamePath)}&avatarsPath=${encodeURIComponent(formValues.avatarsPath)}`;
    const navLink = (dir: string) => `/browse?target=${target}&path=${encodeURIComponent(dir)}&${carryQuery}`;
    const selectLink = (dir: string) => {
        const selected = {...formValues, [target]: dir};
        return `/?mamePath=${encodeURIComponent(selected.mamePath)}&avatarsPath=${encodeURIComponent(selected.avatarsPath)}`;
    };

    const rows = entries.map(name => {
        const fullPath = join(currentDir, name);
        return `<li><a href="${navLink(fullPath)}">📁 ${escapeHtml(name)}</a></li>`;
    }).join('');

    return renderPage(`
        <h1>Choisir un dossier</h1>
        <p class="current-path">${escapeHtml(currentDir)}</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <p>
            <a class="button-link" href="${selectLink(currentDir)}">Choisir ce dossier</a>
            ${canGoUp ? ` &nbsp; <a href="${navLink(parentDir)}">⬆ Dossier parent</a>` : ''}
        </p>
        <ul class="browse-list">${rows || '<li><em>Aucun sous-dossier</em></li>'}</ul>
        <p><a href="/?${carryQuery}">Annuler</a></p>
    `);
}

export function startBoServer(userDataPath: string, port: number, onConfigured: () => void): Server {
    const app = express();
    app.use(express.urlencoded({extended: false}));

    app.get('/background.jpg', (req, res) => {
        res.sendFile(join(__static, 'img/background.jpg'));
    });

    app.get('/', (req, res) => {
        const config = new Config(userDataPath);
        config.load();
        const mamePath = typeof req.query.mamePath === 'string' ? req.query.mamePath : (config.mamePath || '');
        const avatarsPath = typeof req.query.avatarsPath === 'string' ? req.query.avatarsPath : (config.avatarsPath || '');
        res.send(renderForm({mamePath, avatarsPath}));
    });

    app.get('/browse', (req, res) => {
        const target: PathField = req.query.target === 'avatarsPath' ? 'avatarsPath' : 'mamePath';
        const formValues = {
            mamePath: typeof req.query.mamePath === 'string' ? req.query.mamePath : '',
            avatarsPath: typeof req.query.avatarsPath === 'string' ? req.query.avatarsPath : '',
        };

        let currentDir = typeof req.query.path === 'string' && req.query.path ? req.query.path : formValues[target];
        if (!currentDir || !existsSync(currentDir)) {
            const config = new Config(userDataPath);
            config.load();
            currentDir = (target === 'mamePath' ? config.mamePath : config.avatarsPath) || os.homedir();
        }
        if (!existsSync(currentDir)) {
            currentDir = os.homedir();
        }

        res.send(renderBrowsePage(target, currentDir, formValues));
    });

    app.post('/save', (req, res) => {
        const mamePath: string = (req.body.mamePath || '').trim();
        const avatarsPath: string = (req.body.avatarsPath || '').trim();

        if (!existsSync(mamePath)) {
            res.status(422).send(renderForm({mamePath, avatarsPath}, `Le dossier "${mamePath}" n'existe pas.`));
            return;
        }
        const mameBinaryName = findMameBinary(mamePath);
        if (!mameBinaryName) {
            res.status(422).send(renderForm({mamePath, avatarsPath}, `Aucun binaire mame trouvé dans "${mamePath}".`));
            return;
        }

        try {
            if (!existsSync(avatarsPath)) {
                mkdirSync(avatarsPath, {recursive: true});
            }
        } catch {
            res.status(422).send(renderForm({mamePath, avatarsPath}, `Impossible de créer le dossier "${avatarsPath}".`));
            return;
        }

        const config = new Config(userDataPath);
        config.mamePath = mamePath;
        config.mameBinaryName = mameBinaryName;
        config.avatarsPath = avatarsPath;
        config.save();

        res.send(renderPage('<h1>Configuration enregistrée</h1><p>L\'application redémarre automatiquement.</p>'));

        onConfigured();
    });

    app.post('/launch', (req, res) => {
        const config = new Config(userDataPath);
        config.load();

        if (!config.mamePath || !config.mameBinaryName) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || '', avatarsPath: config.avatarsPath || ''},
                'Aucune configuration valide enregistrée : impossible de lancer mame.',
            ));
            return;
        }

        const mameBinary = join(config.mamePath, config.mameBinaryName);
        if (!existsSync(mameBinary)) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath, avatarsPath: config.avatarsPath},
                `Le binaire "${mameBinary}" est introuvable.`,
            ));
            return;
        }

        // Same launch shape as MameService.startGame(), minus -skip_gameinfo/romName:
        // no rom selected here, so mame opens its own UI, on the dedicated home
        // directory mame-awesome-ui always pins it to.
        const iniPath = getMameHomePath();
        const mameProcess = execFile(mameBinary, ['-inipath', iniPath, '-homepath', iniPath], {
            killSignal: 'SIGQUIT',
            cwd: iniPath,
        }, error => {
            if (error) {
                console.error('[boServer] mame exited with an error:', error);
            }
        });
        mameProcess.once('error', error => {
            console.error('[boServer] failed to launch mame:', error);
        });

        res.send(renderForm(
            {mamePath: config.mamePath, avatarsPath: config.avatarsPath},
            undefined,
            'Mame a été lancé, vérifiez qu\'une fenêtre s\'est bien ouverte sur cette machine.',
        ));
    });

    return app.listen(port, () => {
        console.log(`BO server listening on http://localhost:${port}`);
    });
}
