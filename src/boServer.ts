import express from 'express';
import {Server} from 'http';
import {existsSync, mkdirSync} from 'fs';
import {join} from 'path';
import * as os from 'os';
import {execFile} from 'child_process';
import Config from '@/class/Config.class';

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
        body {
            background-color: #000000;
            color: #ffffff;
            font-family: sans-serif;
            max-width: 480px;
            margin: 48px auto;
            padding: 0 16px;
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
            margin-top: 24px;
            padding: 8px 16px;
            color: #000000;
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
        <form method="post" action="/save">
            <label for="mamePath">Dossier contenant le binaire mame</label>
            <input type="text" id="mamePath" name="mamePath" value="${escapeHtml(values.mamePath)}" required>
            <label for="avatarsPath">Dossier des avatars utilisateurs</label>
            <input type="text" id="avatarsPath" name="avatarsPath" value="${escapeHtml(values.avatarsPath)}" required>
            <button type="submit">Enregistrer</button>
        </form>
        <form method="post" action="/launch" class="launch-form">
            <button type="submit">Lancer mame</button>
        </form>
    `);
}

export function startBoServer(userDataPath: string, port: number, onConfigured: () => void): Server {
    const app = express();
    app.use(express.urlencoded({extended: false}));

    app.get('/', (req, res) => {
        const config = new Config(userDataPath);
        config.load();
        res.send(renderForm({mamePath: config.mamePath || '', avatarsPath: config.avatarsPath || ''}));
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
