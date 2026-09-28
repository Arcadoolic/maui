import {afterEach, beforeEach, describe, it, expect} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'fs';
import {join} from 'path';
import os from 'os';
import {spawn} from 'child_process';
import {findMameProcesses, readProcessArgs, stopMameProcesses} from '@/class/MameProcesses';

describe('findMameProcesses', () => {
    let root: string;
    let proc: string;
    let mame: string;

    beforeEach(() => {
        root = mkdtempSync(join(os.tmpdir(), 'maui-proc-'));
        proc = join(root, 'proc');
        mkdirSync(proc);
        mkdirSync(join(root, 'mame'));
        mame = join(root, 'mame', 'mame');
        writeFileSync(mame, '');
    });

    afterEach(() => {
        rmSync(root, {recursive: true, force: true});
    });

    function fakeProcess(pid: string, exe: string, argv: string[] = [exe]): void {
        mkdirSync(join(proc, pid));
        symlinkSync(exe, join(proc, pid, 'exe'));
        writeFileSync(join(proc, pid, 'cmdline'), argv.join('\0') + '\0');
    }

    it('finds the processes running the configured binary', () => {
        fakeProcess('101', mame, [mame, '-skip_gameinfo', 'pacman']);
        fakeProcess('102', '/usr/bin/bash');
        fakeProcess('103', mame);

        expect(findMameProcesses(mame, proc).sort()).toEqual([101, 103]);
    });

    it('resolves a symlinked binary path', () => {
        const link = join(root, 'mame-link');
        symlinkSync(mame, link);
        fakeProcess('101', mame);

        expect(findMameProcesses(link, proc)).toEqual([101]);
    });

    it('matches on argv[0] when the executable cannot be read', () => {
        mkdirSync(join(proc, '101'));
        writeFileSync(join(proc, '101', 'cmdline'), [mame, 'pacman'].join('\0') + '\0');

        expect(findMameProcesses(mame, proc)).toEqual([101]);
    });

    it('ignores non-pid entries and vanished processes', () => {
        mkdirSync(join(proc, 'self'));
        mkdirSync(join(proc, '104'));

        expect(findMameProcesses(mame, proc)).toEqual([]);
    });

    it('finds nothing without a configured binary or a proc filesystem', () => {
        fakeProcess('101', mame);

        expect(findMameProcesses('', proc)).toEqual([]);
        expect(findMameProcesses(mame, join(root, 'missing'))).toEqual([]);
    });
});

describe('readProcessArgs', () => {
    it('reads the arguments after argv[0], empty for a vanished process', () => {
        const proc = mkdtempSync(join(os.tmpdir(), 'maui-proc-'));
        mkdirSync(join(proc, '101'));
        writeFileSync(join(proc, '101', 'cmdline'), ['/opt/mame/mame', '-skip_gameinfo', 'pacman', ''].join('\0'));

        expect(readProcessArgs(101, proc)).toEqual(['-skip_gameinfo', 'pacman']);
        expect(readProcessArgs(102, proc)).toEqual([]);
        rmSync(proc, {recursive: true, force: true});
    });
});

describe('stopMameProcesses', () => {
    it('resolves once the processes are gone', async () => {
        const child = spawn('sleep', ['30']);
        const exited = new Promise(resolve => child.on('exit', resolve));

        await stopMameProcesses([child.pid as number]);

        expect(await exited).toBeNull();
        expect(child.signalCode).toBe('SIGQUIT');
    });

    it('falls back to SIGKILL when SIGQUIT is ignored', async () => {
        const child = spawn('sh', ['-c', 'trap "" QUIT; exec sleep 30']);
        await new Promise(resolve => setTimeout(resolve, 100));
        const exited = new Promise(resolve => child.on('exit', resolve));

        await stopMameProcesses([child.pid as number], 200);

        await exited;
        expect(child.signalCode).toBe('SIGKILL');
    });
});
