/* eslint-disable @typescript-eslint/no-unused-vars */
import { Subject, Observable } from 'rxjs'
import { posix as posixPath } from 'path'
import { Injector } from '@angular/core'
import { FileDownload, FileUpload, Logger, LogService } from 'tabby-core'
import * as russh from 'russh'

export interface SFTPExecResult {
    stdout: string
    stderr: string
    exitCode: number
}

export interface SFTPFile {
    name: string
    fullPath: string
    isDirectory: boolean
    isSymlink: boolean
    mode: number
    size: number
    modified: Date
    uid?: number
    gid?: number
    user?: string
    group?: string
}

export class SFTPFileHandle {
    position = 0

    constructor (
        private inner: russh.SFTPFile|null,
    ) { }

    async read (): Promise<Uint8Array> {
        if (!this.inner) {
            return Promise.resolve(new Uint8Array(0))
        }
        return this.inner.read(256 * 1024)
    }

    async write (chunk: Uint8Array): Promise<void> {
        if (!this.inner) {
            throw new Error('File handle is closed')
        }
        await this.inner.writeAll(chunk)
    }

    async close (): Promise<void> {
        await this.inner?.shutdown()
        this.inner = null
    }
}

export class SFTPSession {
    get closed$ (): Observable<void> { return this.closed }
    private closed = new Subject<void>()
    private logger: Logger

    constructor (
        private sftp: russh.SFTP,
        injector: Injector,
        private exec?: (command: string) => Promise<SFTPExecResult>,
        private username?: string,
    ) {
        this.logger = injector.get(LogService).create('sftp')
        sftp.closed$.subscribe(() => {
            this.closed.next()
            this.closed.complete()
        })
    }

    async readdir (p: string): Promise<SFTPFile[]> {
        this.logger.debug('readdir', p)
        const entries = await this.sftp.readDirectory(p)
        return entries.map(entry => this._makeFile(
            posixPath.join(p, entry.name), entry,
        ))
    }

    readlink (p: string): Promise<string> {
        this.logger.debug('readlink', p)
        return this.sftp.readlink(p)
    }

    async stat (p: string): Promise<SFTPFile> {
        this.logger.debug('stat', p)
        const stats = await this.sftp.stat(p)
        return {
            name: posixPath.basename(p),
            fullPath: p,
            isDirectory: stats.type === russh.SFTPFileType.Directory,
            isSymlink: stats.type === russh.SFTPFileType.Symlink,
            mode: stats.permissions ?? 0,
            size: stats.size,
            modified: new Date((stats.mtime ?? 0) * 1000),
            uid: stats.uid,
            gid: stats.gid,
            user: stats.user,
            group: stats.group,
        }
    }

    async open (p: string, mode: number): Promise<SFTPFileHandle> {
        this.logger.debug('open', p, mode)
        const handle = await this.sftp.open(p, mode)
        return new SFTPFileHandle(handle)
    }

    async rmdir (p: string): Promise<void> {
        await this.sftp.removeDirectory(p)
    }

    async mkdir (p: string): Promise<void> {
        await this.sftp.createDirectory(p)
    }

    async rename (oldPath: string, newPath: string): Promise<void> {
        this.logger.debug('rename', oldPath, newPath)
        await this.sftp.rename(oldPath, newPath)
    }

    async unlink (p: string): Promise<void> {
        await this.sftp.removeFile(p)
    }

    async chmod (p: string, mode: string|number): Promise<void> {
        this.logger.debug('chmod', p, mode)
        await this.sftp.chmod(p, mode)
    }

    async chown (p: string, owner: string, group?: string): Promise<void> {
        if (!this.exec) {
            throw new Error('Cannot change owner without an SSH session')
        }
        const quoted = this.shellQuote(p)
        const spec = group ? `${owner}:${group}` : owner
        const result = await this.exec(`chown ${this.shellQuote(spec)} ${quoted}`)
        if (result.exitCode && result.exitCode !== 0) {
            throw new Error(result.stderr || result.stdout || 'chown failed')
        }
    }

    async getHomePath (): Promise<string> {
        if (this.exec) {
            try {
                const home = (await this.exec('printf %s "$HOME"')).stdout.trim()
                if (home.startsWith('/')) {
                    return home
                }
            } catch (e) {
                this.logger.debug('Could not detect home directory', e)
            }
        }
        if (this.username === 'root') {
            return '/root'
        }
        if (this.username) {
            return `/home/${this.username}`
        }
        return '/'
    }

    async exists (p: string): Promise<boolean> {
        try {
            await this.stat(p)
            return true
        } catch {
            return false
        }
    }

    async createFile (p: string): Promise<void> {
        const handle = await this.open(p, russh.OPEN_WRITE | russh.OPEN_CREATE | russh.OPEN_TRUNCATE)
        await handle.close()
    }

    async writeTextFile (p: string, content: string): Promise<void> {
        const handle = await this.open(p, russh.OPEN_WRITE | russh.OPEN_CREATE | russh.OPEN_TRUNCATE)
        const data = new TextEncoder().encode(content)
        if (data.length) {
            await handle.write(data)
        }
        await handle.close()
    }

    async readTextFile (p: string, maxBytes: number): Promise<string> {
        const handle = await this.open(p, russh.OPEN_READ)
        const chunks: Uint8Array[] = []
        let total = 0
        while (true) {
            const chunk = await handle.read()
            if (!chunk.length) {
                break
            }
            total += chunk.length
            if (total > maxBytes) {
                await handle.close()
                throw new Error('File is too large')
            }
            chunks.push(chunk)
        }
        await handle.close()
        const buffer = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
            buffer.set(chunk, offset)
            offset += chunk.length
        }
        if (buffer.includes(0)) {
            throw new Error('Binary file')
        }
        return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
    }

    async copy (src: string, dest: string): Promise<void> {
        const source = await this.stat(src)
        if (source.isDirectory) {
            await this.mkdir(dest).catch(() => null)
            for (const child of await this.readdir(src)) {
                await this.copy(child.fullPath, posixPath.join(dest, child.name))
            }
            return
        }
        const reader = await this.open(src, russh.OPEN_READ)
        const writer = await this.open(dest, russh.OPEN_WRITE | russh.OPEN_CREATE | russh.OPEN_TRUNCATE)
        try {
            while (true) {
                const chunk = await reader.read()
                if (!chunk.length) {
                    break
                }
                await writer.write(chunk)
            }
        } finally {
            await reader.close()
            await writer.close()
        }
        if (source.mode) {
            await this.chmod(dest, source.mode).catch(() => null)
        }
    }

    private shellQuote (value: string): string {
        return `'${value.replace(/'/g, `'\\''`)}'`
    }

    async upload (path: string, transfer: FileUpload): Promise<void> {
        this.logger.info('Uploading into', path)
        const tempPath = path + '.tabby-upload'
        try {
            let existing = 0
            try {
                existing = (await this.stat(tempPath)).size
            } catch {
                existing = 0
            }
            const flags = existing
                ? russh.OPEN_WRITE | russh.OPEN_APPEND
                : russh.OPEN_WRITE | russh.OPEN_CREATE
            const handle = await this.open(tempPath, flags)
            transfer.pausable = true
            let skipped = 0
            while (true) {
                await transfer.waitIfPaused()
                if (transfer.isCancelled()) {
                    throw new Error('Transfer cancelled')
                }
                const chunk = await transfer.read()
                if (!chunk.length) {
                    break
                }
                if (skipped < existing) {
                    const remain = existing - skipped
                    if (chunk.length <= remain) {
                        skipped += chunk.length
                        continue
                    }
                    await handle.write(chunk.subarray(remain))
                    skipped = existing
                } else {
                    await handle.write(chunk)
                }
            }
            await handle.close()
            await this.unlink(path).catch(() => null)
            await this.rename(tempPath, path)
            transfer.close()
        } catch (e) {
            transfer.cancel()
            this.unlink(tempPath).catch(() => null)
            throw e
        }
    }

    async download (path: string, transfer: FileDownload, onChunk?: (bytes: number) => void): Promise<void> {
        this.logger.info('Downloading', path)
        try {
            const handle = await this.open(path, russh.OPEN_READ)
            transfer.pausable = true
            while (true) {
                await transfer.waitIfPaused()
                if (transfer.isCancelled()) {
                    throw new Error('Transfer cancelled')
                }
                const chunk = await handle.read()
                if (!chunk.length) {
                    break
                }
                await transfer.write(chunk)
                onChunk?.(chunk.length)
            }
            transfer.setCompleted(true)
            transfer.close()
            handle.close()
        } catch (e) {
            transfer.cancel()
            throw e
        }
    }

    private _makeFile (p: string, entry: russh.SFTPDirectoryEntry): SFTPFile {
        return {
            fullPath: p,
            name: posixPath.basename(p),
            isDirectory: entry.metadata.type === russh.SFTPFileType.Directory,
            isSymlink: entry.metadata.type === russh.SFTPFileType.Symlink,
            mode: entry.metadata.permissions ?? 0,
            size: entry.metadata.size,
            modified: new Date((entry.metadata.mtime ?? 0) * 1000),
            uid: entry.metadata.uid,
            gid: entry.metadata.gid,
            user: entry.metadata.user,
            group: entry.metadata.group,
        }
    }
}
