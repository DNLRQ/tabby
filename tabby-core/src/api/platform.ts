import { MenuItemOptions } from './menu'
import { Subject, Observable } from 'rxjs'

/* eslint-disable @typescript-eslint/no-unused-vars */
export interface ClipboardContent {
    text: string
    html?: string
}

export interface MessageBoxOptions {
    type: 'warning'|'error'
    message: string
    detail?: string
    buttons: string[]
    defaultId?: number
    cancelId?: number
}

export interface MessageBoxResult {
    response: number
}

export abstract class FileTransfer {
    abstract getName (): string
    abstract getSize (): number
    abstract close (): void
    pausable = false
    readonly startedAt = Date.now()
    host = ''
    direction = ''
    remotePath = ''

    getSpeed (): number {
        return this.lastChunkSpeed
    }

    getCompletedBytes (): number {
        return this.completedBytes
    }

    getStatus (): string {
        return this.status
    }

    getTotalSize (): number {
        return this.totalSize
    }

    isComplete (): boolean {
        if (this.completed) {
            return true
        }
        const size = this.getSize()
        return size > 0 && this.completedBytes >= size
    }

    isCancelled (): boolean {
        return this.cancelled
    }

    isPaused (): boolean {
        return this.paused
    }

    pause (): void {
        this.paused = true
    }

    resume (): void {
        this.paused = false
        const waiters = this.pauseWaiters.splice(0)
        for (const waiter of waiters) {
            waiter()
        }
    }

    async waitIfPaused (): Promise<void> {
        while (this.paused && !this.cancelled) {
            await new Promise<void>(resolve => this.pauseWaiters.push(resolve))
        }
    }

    cancel (): void {
        this.cancelled = true
        this.paused = false
        const waiters = this.pauseWaiters.splice(0)
        for (const waiter of waiters) {
            waiter()
        }
        this.close()
    }

    setStatus (status: string): void {
        this.status = status
    }

    setTotalSize (size: number): void {
        this.totalSize = size
    }

    setCompleted (completed: boolean): void {
        this.completed = completed
    }

    reportProgress (bytes: number): void {
        this.increaseProgress(bytes)
    }

    setInfo (info: { host?: string, direction?: string, remotePath?: string }): void {
        if (info.host !== undefined) {
            this.host = info.host
        }
        if (info.direction !== undefined) {
            this.direction = info.direction
        }
        if (info.remotePath !== undefined) {
            this.remotePath = info.remotePath
        }
    }

    getElapsed (): number {
        return Date.now() - this.startedAt
    }

    getHost (): string {
        return this.host
    }

    protected increaseProgress (bytes: number): void {
        if (!bytes) {
            return
        }
        this.completedBytes += bytes
        this.lastChunkSpeed = bytes * 1000 / (Date.now() - this.lastChunkStartTime)
        this.lastChunkStartTime = Date.now()
    }

    private completedBytes = 0
    private totalSize = 0
    private lastChunkStartTime = Date.now()
    private lastChunkSpeed = 0
    private cancelled = false
    private completed = false
    private paused = false
    private pauseWaiters: Array<() => void> = []
    private status = ''
}

export abstract class FileDownload extends FileTransfer {
    abstract write (buffer: Uint8Array): Promise<void>
}

export abstract class DirectoryDownload extends FileTransfer {
    abstract createDirectory (relativePath: string): Promise<void>
    abstract createFile (relativePath: string, mode: number, size: number): Promise<FileDownload>
}

export abstract class FileUpload extends FileTransfer {
    abstract getMode (): number

    abstract read (): Promise<Uint8Array>

    async readAll (): Promise<Uint8Array> {
        const result = new Uint8Array(this.getSize())
        let pos = 0
        while (true) {
            const buf = await this.read()
            if (!buf.length) {
                break
            }
            result.set(buf, pos)
            pos += buf.length
        }
        return result
    }
}

export interface FileUploadOptions {
    multiple: boolean
}

export class DirectoryUpload {
    private childrens: (FileUpload|DirectoryUpload)[] = []

    constructor (private name = '') {
        // Just set name for now.
    }

    getName (): string {
        return this.name
    }

    getChildrens (): (FileUpload|DirectoryUpload)[] {
        return this.childrens
    }

    getFiles (): FileUpload[] {
        const files: FileUpload[] = []
        for (const child of this.childrens) {
            if (child instanceof DirectoryUpload) {
                files.push(...child.getFiles())
            } else {
                files.push(child)
            }
        }
        return files
    }

    pushChildren (item: FileUpload|DirectoryUpload): void {
        this.childrens.push(item)
    }
}

export class BatchFileTransfer extends FileTransfer {
    constructor (
        private children: FileTransfer[],
        private customName?: string,
    ) {
        super()
        this.pausable = true
        this.setTotalSize(this.getSize())
    }

    getName (): string {
        return this.customName || `${this.children.length} files`
    }

    getCustomName (): string | undefined {
        return this.customName
    }

    getFileCount (): number {
        return this.children.length
    }

    getHost (): string {
        return this.host || this.children.find(child => child.host)?.host || ''
    }

    getSize (): number {
        return this.children.reduce((sum, child) => sum + (child.getSize() || child.getTotalSize()), 0)
    }

    getCompletedBytes (): number {
        return this.children.reduce((sum, child) => {
            if (child.isComplete()) {
                return sum + (child.getSize() || child.getTotalSize() || child.getCompletedBytes())
            }
            return sum + child.getCompletedBytes()
        }, 0)
    }

    getSpeed (): number {
        return this.children.reduce((sum, child) => sum + (child.isPaused() ? 0 : child.getSpeed()), 0)
    }

    getStatus (): string {
        const current = this.children.find(child => !child.isComplete() && !child.isCancelled())
        return current?.getName() ?? ''
    }

    isComplete (): boolean {
        if (this.isCancelled()) {
            return false
        }
        return this.children.length > 0 && this.children.every(child => child.isComplete() || child.isCancelled())
    }

    isCancelled (): boolean {
        return super.isCancelled() || (this.children.length > 0 && this.children.every(child => child.isCancelled()))
    }

    pause (): void {
        super.pause()
        for (const child of this.children) {
            if (!child.isComplete() && !child.isCancelled()) {
                child.pause()
            }
        }
    }

    resume (): void {
        super.resume()
        for (const child of this.children) {
            if (child.isPaused()) {
                child.resume()
            }
        }
    }

    cancel (): void {
        for (const child of this.children) {
            if (!child.isComplete() && !child.isCancelled()) {
                child.cancel()
            }
        }
        super.cancel()
    }

    close (): void { }
}

export type PlatformTheme = 'light'|'dark'

export abstract class PlatformService {
    supportsWindowControls = false

    get fileTransferStarted$ (): Observable<FileTransfer> { return this.fileTransferStarted }
    get displayMetricsChanged$ (): Observable<void> { return this.displayMetricsChanged }
    get themeChanged$ (): Observable<PlatformTheme> { return this.themeChanged }

    protected fileTransferStarted = new Subject<FileTransfer>()
    protected displayMetricsChanged = new Subject<void>()
    protected themeChanged = new Subject<PlatformTheme>()

    abstract readClipboard (): string
    abstract setClipboard (content: ClipboardContent): void
    abstract loadConfig (): Promise<string>
    abstract saveConfig (content: string): Promise<void>

    abstract startDownload (name: string, mode: number, size: number, filePath?: string): Promise<FileDownload|null>
    abstract startDownloadDirectory (name: string, estimatedSize?: number): Promise<DirectoryDownload|null>
    abstract startUpload (options?: FileUploadOptions): Promise<FileUpload[]>
    abstract startUploadDirectory (paths?: string[]): Promise<DirectoryUpload>

    registerTransfer (transfer: FileTransfer): void {
        this.fileTransferStarted.next(transfer)
    }

    protected registerUploadTransfers (transfers: FileTransfer[], name?: string): void {
        if (!transfers.length) {
            return
        }
        if (transfers.length === 1 && !name) {
            this.fileTransferStarted.next(transfers[0])
            return
        }
        this.fileTransferStarted.next(new BatchFileTransfer(transfers, name))
    }

    async startUploadFromDragEvent (event: DragEvent, multiple = false): Promise<DirectoryUpload> {
        const result = new DirectoryUpload()

        if (!event.dataTransfer) {
            return Promise.resolve(result)
        }

        const traverseFileTree = (item: any, root: DirectoryUpload = result): Promise<void> => {
            return new Promise((resolve) => {
                if (item.isFile) {
                    item.file((file: File) => {
                        const transfer = new HTMLFileUpload(file)
                        root.pushChildren(transfer)
                        resolve()
                    })
                } else if (item.isDirectory) {
                    const dirReader = item.createReader()
                    const childrenFolder = new DirectoryUpload(item.name)
                    dirReader.readEntries(async (entries: any[]) => {
                        for (const entry of entries) {
                            await traverseFileTree(entry, childrenFolder)
                        }
                        resolve()
                    })
                    root.pushChildren(childrenFolder)
                } else {
                    resolve()
                }
            })
        }

        const promises: Promise<void>[] = []

        const items = event.dataTransfer.items
        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < items.length; i++) {
            const item = items[i].webkitGetAsEntry()
            if (item) {
                promises.push(traverseFileTree(item))
                if (!multiple) {
                    break
                }
            }
        }
        return Promise.all(promises).then(() => {
            const files = result.getFiles()
            const roots = result.getChildrens()
            const name = roots.length === 1 && roots[0] instanceof DirectoryUpload
                ? roots[0].getName()
                : undefined
            this.registerUploadTransfers(files, name)
            return result
        })
    }

    getConfigPath (): string|null {
        return null
    }

    showItemInFolder (path: string): void {
        throw new Error('Not implemented')
    }

    async isProcessRunning (name: string): Promise<boolean> {
        return false
    }

    async installPlugin (name: string, version: string): Promise<void> {
        throw new Error('Not implemented')
    }

    async uninstallPlugin (name: string): Promise<void> {
        throw new Error('Not implemented')
    }

    getWinSCPPath (): string|null {
        throw new Error('Not implemented')
    }

    async exec (app: string, argv: string[]): Promise<void> {
        throw new Error('Not implemented')
    }

    isShellIntegrationSupported (): boolean {
        return false
    }

    async isShellIntegrationInstalled (): Promise<boolean> {
        return false
    }

    async installShellIntegration (): Promise<void> {
        throw new Error('Not implemented')
    }

    async uninstallShellIntegration (): Promise<void> {
        throw new Error('Not implemented')
    }

    openPath (path: string): void {
        throw new Error('Not implemented')
    }

    async getTempPath (_name: string): Promise<string|null> {
        return null
    }

    startNativeDrag (_filePath: string): void { }

    getTheme (): PlatformTheme {
        return 'dark'
    }

    abstract getOSRelease (): string
    abstract getAppVersion (): string
    abstract openExternal (url: string): Promise<void>
    abstract listFonts (): Promise<string[]>
    abstract setErrorHandler (handler: (_: any) => void): void
    abstract popupContextMenu (menu: MenuItemOptions[], event?: MouseEvent): void
    abstract showMessageBox (options: MessageBoxOptions): Promise<MessageBoxResult>
    abstract pickDirectory (): Promise<string | null>
    abstract quit (): void
}

export class HTMLFileUpload extends FileUpload {
    private stream: ReadableStream
    private reader: ReadableStreamDefaultReader

    constructor (private file: File) {
        super()
        this.stream = this.file.stream()
        this.reader = this.stream.getReader()
    }

    getName (): string {
        return this.file.name
    }

    getMode (): number {
        return 0o644
    }

    getSize (): number {
        return this.file.size
    }

    async read (): Promise<Uint8Array> {
        const result: any = await this.reader.read()
        if (result.done || !result.value) {
            return new Uint8Array(0)
        }
        const chunk = new Uint8Array(result.value)
        this.increaseProgress(chunk.length)
        return chunk
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    bringToFront (): void { }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    close (): void { }
}
