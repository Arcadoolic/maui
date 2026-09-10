import express from 'express';
import {Server} from 'http';
import {existsSync, mkdirSync} from 'fs';
import {join} from 'path';
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
    </style>
</head>
<body>
    ${body}
</body>
</html>`;
}

function renderForm(values: {mamePath: string, avatarsPath: string}, error?: string): string {
    return renderPage(`
        <h1>Configuration mame-awesome-ui</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/save">
            <label for="mamePath">Dossier contenant le binaire mame</label>
            <input type="text" id="mamePath" name="mamePath" value="${escapeHtml(values.mamePath)}" required>
            <label for="avatarsPath">Dossier des avatars utilisateurs</label>
            <input type="text" id="avatarsPath" name="avatarsPath" value="${escapeHtml(values.avatarsPath)}" required>
            <button type="submit">Enregistrer</button>
        </form>
    `);
}

export function startBoServer(userDataPath: string, port: number, onConfigured: () => void): Server {
    const app = express();
    app.use(express.urlencoded({extended: false}));

    app.get('/', (req, res) => {
        res.send(renderForm({mamePath: '', avatarsPath: ''}));
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

        server.close();
        onConfigured();
    });

    const server = app.listen(port, () => {
        console.log(`BO server listening on http://localhost:${port}`);
    });

    return server;
}
