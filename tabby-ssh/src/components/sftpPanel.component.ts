import * as C from 'constants'
import { posix as path } from 'path'
import { Component, Input, Output, EventEmitter, Inject, Optional, HostListener, HostBinding, OnDestroy, ElementRef } from '@angular/core'
import { Subscription } from 'rxjs'
import { FileUpload, DirectoryUpload, DirectoryDownload, FileTransfer, MenuItemOptions, NotificationsService, PlatformService, TranslateService, ConfigService, HostAppService, Platform } from 'tabby-core'
import { SFTPSession, SFTPFile } from '../session/sftp'
import { SSHSession } from '../session/ssh'
import { SFTPContextMenuItemProvider } from '../api'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { SFTPCreateDirectoryModalComponent } from './sftpCreateDirectoryModal.component'
import { SFTPDeleteModalComponent } from './sftpDeleteModal.component'
import { SFTPNameModalComponent } from './sftpNameModal.component'
import { SFTPConflictModalComponent, SFTPConflictChoice, SFTPConflictResult } from './sftpConflictModal.component'
import { SFTPPermissionsModalComponent } from './sftpPermissionsModal.component'
import { SFTPEditorModalComponent } from './sftpEditorModal.component'
import { SFTPTransferLogModalComponent } from './sftpTransferLogModal.component'
import { SFTPSendToModalComponent } from './sftpSendToModal.component'
import { RemoteCopyTransfer, SFTPTransferDirection, SFTPTransferLogChild, SFTPTransferStatus, SFTPTransfersService } from '../services/sftpTransfers.service'
import { SFTPConnectionRef, SFTPConnectionRegistry } from '../services/sftpConnections.service'

interface PathSegment {
    name: string
    path: string
}

interface SFTPUserConfig {
    viewMode: 'grid' | 'list'
    showHidden: boolean
    openOn: 'doubleClick' | 'singleClick'
    multiSelect: boolean
    dragAndDrop: boolean
    showDownloadButton: boolean
    startDirectory: string
    editorPath: string
    editorMaxSizeMB: number
    transfersAutoShow: boolean
    transfersPopup: boolean
}

@Component({
    selector: 'sftp-panel',
    templateUrl: './sftpPanel.component.pug',
    styleUrls: ['./sftpPanel.component.scss'],
})
export class SFTPPanelComponent implements OnDestroy {
    @Input() session: SSHSession
    @Input() path = '/'
    @Input() cwdDetectionAvailable = false
    @Input() standalone = false
    @Output() closed = new EventEmitter<void>()
    @Output() pathChange = new EventEmitter<string>()
    @Output() newWindow = new EventEmitter<void>()
    sftp: SFTPSession
    fileList: SFTPFile[]|null = null
    filteredFileList: SFTPFile[] = []
    pathSegments: PathSegment[] = []
    editingPath: string|null = null
    filterText = ''
    viewMode: 'grid' | 'list' = 'grid'
    showHidden = false
    isDragging = false
    dropTargetPath: string | null = null
    progressTick = 0
    private dragDepth = 0
    private selected = new Set<string>()
    private anchorPath: string | null = null
    private configSub: Subscription | null = null
    private clipboard: { action: 'copy' | 'cut', items: SFTPFile[] } | null = null
    private conflictApplyAll: SFTPConflictChoice | null = null
    private dragCache = new Map<string, string>()
    private internalDragItems: SFTPFile[] | null = null
    private activeTransfers: FileTransfer[] = []
    private progressTimer: ReturnType<typeof setInterval> | null = null
    private progressHideAt = 0
    private transferBatch: {
        depth: number
        direction: SFTPTransferDirection
        name: string
        remotePath: string
        children: SFTPTransferLogChild[]
        startedAt: number
        sourceHost?: string
        destHost?: string
    } | null = null

    constructor (
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private config: ConfigService,
        public platform: PlatformService,
        private hostApp: HostAppService,
        private transferLog: SFTPTransfersService,
        private connections: SFTPConnectionRegistry,
        private element: ElementRef<HTMLElement>,
        @Optional() @Inject(SFTPContextMenuItemProvider) protected contextMenuProviders: SFTPContextMenuItemProvider[],
    ) {
        this.contextMenuProviders = this.contextMenuProviders ?? []
        this.contextMenuProviders.sort((a, b) => a.weight - b.weight)
        this.applySftpSettings()
    }

    get sftpConfig (): SFTPUserConfig {
        return this.config.store.ssh.sftp
    }

    @HostBinding('class.standalone')
    get standaloneClass (): boolean {
        return this.standalone
    }

    ngOnDestroy (): void {
        this.connections.unregister(this)
        this.configSub?.unsubscribe()
        this.stopProgressTimer()
    }

    private stopProgressTimer (): void {
        this.progressHideAt = 0
        if (this.progressTimer) {
            clearInterval(this.progressTimer)
            this.progressTimer = null
        }
    }

    private applySftpSettings (): void {
        const sftp = this.sftpConfig
        this.viewMode = sftp.viewMode === 'list' ? 'list' : 'grid'
        this.showHidden = !!sftp.showHidden
        this.updateFilteredList()
    }

    async ngOnInit (): Promise<void> {
        this.configSub = this.config.changed$.subscribe(() => this.applySftpSettings())
        this.sftp = await this.session.openSFTP()
        this.connections.register(this)
        let start = this.path
        if (!start || start === '/') {
            start = await this.resolveStartPath()
        }
        try {
            await this.navigate(start)
        } catch (error) {
            console.warn('Could not navigate to', start, ':', error)
            this.notifications.error(error.message)
            await this.navigate('/')
        }
    }

    async navigate (newPath: string, fallbackOnError = true): Promise<void> {
        const previousPath = this.path
        this.path = newPath
        this.pathChange.next(this.path)

        this.clearFilter()
        this.clearSelection()

        let p = newPath
        this.pathSegments = []
        while (p !== '/' && p !== '.') {
            this.pathSegments.unshift({
                name: path.basename(p),
                path: p,
            })
            const parent = path.dirname(p)
            if (parent === p) {
                break
            }
            p = parent
        }

        this.fileList = null
        this.filteredFileList = []
        try {
            this.fileList = await this.sftp.readdir(this.path)
        } catch (error) {
            this.notifications.error(error.message)
            if (previousPath && fallbackOnError) {
                this.navigate(previousPath, false)
            }
            return
        }

        const dirKey = a => a.isDirectory ? 1 : 0
        this.fileList.sort((a, b) =>
            dirKey(b) - dirKey(a) ||
            a.name.localeCompare(b.name))

        this.updateFilteredList()
    }

    getFileType (fileExtension: string): string {
        const codeExtensions = ['js', 'ts', 'py', 'java', 'cpp', 'h', 'cs', 'html', 'css', 'rb', 'php', 'swift', 'go', 'kt', 'sh', 'json', 'cc', 'c', 'xml', 'yml', 'yaml', 'md', 'rs', 'vue', 'tsx', 'jsx', 'sql']
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico']
        const pdfExtensions = ['pdf']
        const archiveExtensions = ['zip', 'rar', 'tar', 'gz', '7z', 'bz2', 'xz', 'tgz']
        const wordExtensions = ['doc', 'docx', 'odt']
        const videoExtensions = ['mp4', 'avi', 'mkv', 'mov', 'webm']
        const powerpointExtensions = ['ppt', 'pptx']
        const textExtensions = ['txt', 'log', 'ini', 'conf', 'cfg']
        const audioExtensions = ['mp3', 'wav', 'flac', 'ogg', 'm4a']
        const excelExtensions = ['xls', 'xlsx', 'csv']

        const lowerCaseExtension = fileExtension.toLowerCase()

        if (codeExtensions.includes(lowerCaseExtension)) {
            return 'code'
        } else if (imageExtensions.includes(lowerCaseExtension)) {
            return 'image'
        } else if (pdfExtensions.includes(lowerCaseExtension)) {
            return 'pdf'
        } else if (archiveExtensions.includes(lowerCaseExtension)) {
            return 'archive'
        } else if (wordExtensions.includes(lowerCaseExtension)) {
            return 'word'
        } else if (videoExtensions.includes(lowerCaseExtension)) {
            return 'video'
        } else if (powerpointExtensions.includes(lowerCaseExtension)) {
            return 'powerpoint'
        } else if (textExtensions.includes(lowerCaseExtension)) {
            return 'text'
        } else if (audioExtensions.includes(lowerCaseExtension)) {
            return 'audio'
        } else if (excelExtensions.includes(lowerCaseExtension)) {
            return 'excel'
        } else {
            return 'unknown'
        }
    }

    getKind (item: SFTPFile): string {
        if (item.isDirectory) {
            return 'folder'
        }
        if (item.isSymlink) {
            return 'link'
        }
        const fileMatch = /\.([^.]+)$/.exec(item.name)
        const extension = fileMatch ? fileMatch[1] : null
        if (!extension) {
            return 'file'
        }
        const fileType = this.getFileType(extension)
        return fileType === 'unknown' ? 'file' : fileType
    }

    kindClass (item: SFTPFile): string {
        return `kind-${this.getKind(item)}`
    }

    getIcon (item: SFTPFile): string {
        const kind = this.getKind(item)
        switch (kind) {
            case 'folder':
                return 'fas fa-folder'
            case 'link':
                return 'fas fa-link'
            case 'unknown':
            case 'file':
                return 'fas fa-file'
            case 'text':
                return 'fas fa-file-alt'
            case 'archive':
                return 'fas fa-file-archive'
            default:
                return `fas fa-file-${kind}`
        }
    }

    goUp (): void {
        this.navigate(path.dirname(this.path))
    }

    onItemClick (item: SFTPFile, event: MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()

        const multi = this.sftpConfig.multiSelect
        const ctrl = multi && (event.ctrlKey || event.metaKey)
        const shift = multi && event.shiftKey

        if (shift && this.anchorPath) {
            this.selectRange(this.anchorPath, item.fullPath)
            return
        }

        if (ctrl) {
            this.toggleSelected(item)
            this.anchorPath = item.fullPath
            return
        }

        this.selected = new Set([item.fullPath])
        this.anchorPath = item.fullPath

        if (this.sftpConfig.openOn === 'singleClick') {
            this.open(item)
        }
    }

    onItemDblClick (item: SFTPFile, event: MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()
        if (this.sftpConfig.openOn === 'doubleClick') {
            this.open(item)
        }
    }

    onBackgroundClick (event: MouseEvent): void {
        if (event.target === event.currentTarget) {
            this.clearSelection()
        }
    }

    isSelected (item: SFTPFile): boolean {
        return this.selected.has(item.fullPath)
    }

    get selectedCount (): number {
        return this.selected.size
    }

    get hasClipboard (): boolean {
        return !!this.clipboard?.items.length
    }

    get isInternalDrag (): boolean {
        return !!this.internalDragItems?.length
    }

    get hasActiveTransfers (): boolean {
        void this.progressTick
        return this.activeTransfers.some(transfer => !transfer.isCancelled())
    }

    get transferLabel (): string {
        void this.progressTick
        const active = this.liveTransfers.filter(transfer => !transfer.isComplete())
        if (active.length > 1) {
            return this.translate.instant('Downloading {count} items', { count: active.length })
        }
        return active[0]?.getName() ?? this.liveTransfers[0]?.getName() ?? ''
    }

    get transferStatus (): string {
        void this.progressTick
        return this.liveTransfers[0]?.getStatus() ?? ''
    }

    get transferCompleted (): number {
        void this.progressTick
        return this.liveTransfers.reduce((sum, transfer) => sum + transfer.getCompletedBytes(), 0)
    }

    get transferTotal (): number {
        void this.progressTick
        return this.liveTransfers.reduce((sum, transfer) => sum + (transfer.getSize() || transfer.getTotalSize()), 0)
    }

    get transferRemaining (): number {
        return Math.max(0, this.transferTotal - this.transferCompleted)
    }

    get transferPercent (): number {
        if (!this.transferTotal) {
            return 0
        }
        return Math.min(100, Math.round(100 * this.transferCompleted / this.transferTotal))
    }

    get transferSpeed (): number {
        void this.progressTick
        return this.liveTransfers.reduce((sum, transfer) => sum + (transfer.isPaused() ? 0 : transfer.getSpeed()), 0)
    }

    private get liveTransfers (): FileTransfer[] {
        return this.activeTransfers.filter(transfer => !transfer.isCancelled())
    }

    get selectedItems (): SFTPFile[] {
        return this.filteredFileList.filter(item => this.selected.has(item.fullPath))
    }

    clearSelection (): void {
        this.selected = new Set()
    }

    async downloadSelected (): Promise<void> {
        const items = this.selectedItems
        if (items.length > 1) {
            this.beginTransferBatch('download', this.translate.instant('{count} items', { count: items.length }), this.path)
        }
        try {
            for (const item of items) {
                await this.downloadItem(item)
            }
        } finally {
            this.endTransferBatch()
        }
    }

    async deleteSelected (): Promise<void> {
        const items = this.selectedItems
        if (!items.length) {
            return
        }

        const confirmed = (await this.platform.showMessageBox({
            type: 'warning',
            message: items.length === 1
                ? this.translate.instant('Delete {fullPath}?', items[0])
                : this.translate.instant('Delete {count} items?', { count: items.length }),
            defaultId: 0,
            cancelId: 1,
            buttons: [
                this.translate.instant('Delete'),
                this.translate.instant('Cancel'),
            ],
        })).response === 0

        if (!confirmed) {
            return
        }

        if (items.length === 1) {
            const modal = this.ngbModal.open(SFTPDeleteModalComponent)
            modal.componentInstance.item = items[0]
            modal.componentInstance.sftp = this.sftp
            await modal.result.catch(() => null)
        } else {
            for (const item of items) {
                await this.deleteRecursive(item)
            }
        }
        this.clearSelection()
        await this.navigate(this.path)
    }

    private async deleteRecursive (file: SFTPFile): Promise<void> {
        if (file.isDirectory) {
            for (const child of await this.sftp.readdir(file.fullPath)) {
                await this.deleteRecursive(child)
            }
            await this.sftp.rmdir(file.fullPath)
        } else {
            await this.sftp.unlink(file.fullPath)
        }
    }

    private toggleSelected (item: SFTPFile): void {
        const next = new Set(this.selected)
        if (next.has(item.fullPath)) {
            next.delete(item.fullPath)
        } else {
            next.add(item.fullPath)
        }
        this.selected = next
    }

    private selectRange (fromPath: string, toPath: string): void {
        const list = this.filteredFileList
        const start = list.findIndex(item => item.fullPath === fromPath)
        const end = list.findIndex(item => item.fullPath === toPath)
        if (start < 0 || end < 0) {
            this.selected = new Set([toPath])
            return
        }
        const [from, to] = start < end ? [start, end] : [end, start]
        this.selected = new Set(list.slice(from, to + 1).map(item => item.fullPath))
    }

    onDragEnter (event: DragEvent): void {
        if (this.isInternalDrag) {
            event.preventDefault()
            return
        }
        if (!this.sftpConfig.dragAndDrop || !this.hasFiles(event)) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        this.dragDepth++
        this.isDragging = true
    }

    onDragOver (event: DragEvent): void {
        if (this.isInternalDrag) {
            event.preventDefault()
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'none'
            }
            return
        }
        if (!this.sftpConfig.dragAndDrop || !this.hasFiles(event)) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy'
        }
    }

    onDragLeave (event: DragEvent): void {
        if (this.isInternalDrag) {
            return
        }
        if (!this.hasFiles(event) && this.dragDepth === 0) {
            return
        }
        event.preventDefault()
        this.dragDepth = Math.max(0, this.dragDepth - 1)
        if (this.dragDepth === 0) {
            this.isDragging = false
        }
    }

    async onDrop (event: DragEvent): Promise<void> {
        event.preventDefault()
        event.stopPropagation()
        this.dragDepth = 0
        this.isDragging = false
        if (this.isInternalDrag) {
            this.clearInternalDrag()
            return
        }
        if (!this.sftpConfig.dragAndDrop) {
            return
        }
        const destDir = this.path
        const transfer = await this.platform.startUploadFromDragEvent(event, true)
        if (!transfer.getChildrens().length) {
            return
        }
        await this.uploadOneFolder(transfer, '', destDir)
    }

    private hasFiles (event: DragEvent): boolean {
        return Array.from(event.dataTransfer?.types ?? []).includes('Files')
    }

    @HostListener('document:keydown', ['$event'])
    onKeydown (event: KeyboardEvent): void {
        const target = event.target as HTMLElement | null
        if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
            return
        }
        const root = this.element.nativeElement
        const active = document.activeElement
        if (!root.contains(target) && !(active instanceof Node && root.contains(active))) {
            return
        }

        if (event.key === 'Escape' && this.selected.size) {
            this.clearSelection()
            event.preventDefault()
            return
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && this.sftpConfig.multiSelect && this.filteredFileList.length) {
            event.preventDefault()
            this.selected = new Set(this.filteredFileList.map(item => item.fullPath))
            this.anchorPath = this.filteredFileList[0]?.fullPath ?? null
            return
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
            this.copySelected()
            event.preventDefault()
            return
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
            this.cutSelected()
            event.preventDefault()
            return
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
            this.pasteClipboard()
            event.preventDefault()
            return
        }
        if (event.key === 'F2') {
            this.renameSelected()
            event.preventDefault()
        }
    }

    async open (item: SFTPFile): Promise<void> {
        if (item.isDirectory) {
            await this.navigate(item.fullPath)
        } else if (item.isSymlink) {
            const target = path.resolve(this.path, await this.sftp.readlink(item.fullPath))
            const stat = await this.sftp.stat(target)
            if (stat.isDirectory) {
                await this.navigate(item.fullPath)
            } else {
                await this.editOrDownload(item)
            }
        } else {
            await this.editOrDownload(item)
        }
    }

    async downloadItem (item: SFTPFile): Promise<void> {
        if (item.isDirectory) {
            await this.downloadFolder(item)
            return
        }

        if (item.isSymlink) {
            const target = path.resolve(this.path, await this.sftp.readlink(item.fullPath))
            const stat = await this.sftp.stat(target)
            if (stat.isDirectory) {
                await this.downloadFolder(item)
                return
            }
            await this.download(item.fullPath, stat.mode, stat.size)
            return
        }

        await this.download(item.fullPath, item.mode, item.size)
    }

    async openCreateDirectoryModal (): Promise<void> {
        const modal = this.ngbModal.open(SFTPCreateDirectoryModalComponent)
        const directoryName = await modal.result.catch(() => null)
        if (directoryName?.trim()) {
            this.sftp.mkdir(path.join(this.path, directoryName)).then(() => {
                this.notifications.notice('The directory was created successfully')
                this.navigate(path.join(this.path, directoryName))
            }).catch(() => {
                this.notifications.error('The directory could not be created')
            })
        }
    }

    async upload (): Promise<void> {
        const destDir = this.path
        this.conflictApplyAll = null
        const transfers = await this.platform.startUpload({ multiple: true })
        if (transfers.length > 1) {
            this.beginTransferBatch('upload', this.translate.instant('{count} files', { count: transfers.length }), destDir)
        }
        for (const transfer of transfers) {
            transfer.setInfo({ host: this.hostLabel, direction: 'upload', remotePath: destDir })
        }
        try {
            for (const transfer of transfers) {
                if (transfer.isCancelled()) {
                    break
                }
                await this.uploadOne(transfer, undefined, destDir)
            }
        } catch (error) {
            this.cancelPendingUploads(transfers, destDir)
            throw error
        } finally {
            this.endTransferBatch()
        }
    }

    async uploadFolder (): Promise<void> {
        const destDir = this.path
        const transfer = await this.platform.startUploadDirectory()
        await this.uploadOneFolder(transfer, '', destDir)
    }

    async uploadOneFolder (transfer: DirectoryUpload, accumPath = '', destDir = this.path): Promise<void> {
        if (!accumPath) {
            this.conflictApplyAll = null
            this.beginFolderUploadBatch(transfer, destDir)
        }
        try {
            for (const t of transfer.getChildrens()) {
                if (t instanceof DirectoryUpload) {
                    try {
                        await this.sftp.mkdir(path.posix.join(destDir, accumPath, t.getName()))
                    } catch {
                        // Intentionally ignoring errors from making duplicate dirs.
                    }
                    await this.uploadOneFolder(t, path.posix.join(accumPath, t.getName()), destDir)
                } else {
                    if (t.isCancelled()) {
                        break
                    }
                    await this.uploadOne(t, path.posix.join(accumPath, t.getName()), destDir)
                }
            }
        } catch (error) {
            if (!accumPath) {
                this.cancelPendingUploads(transfer.getFiles(), destDir)
            }
            throw error
        } finally {
            if (!accumPath) {
                this.endTransferBatch()
            }
        }
        if (this.path === destDir) {
            await this.navigate(this.path)
        }
    }

    private beginFolderUploadBatch (transfer: DirectoryUpload, destDir: string): void {
        const files = transfer.getFiles()
        if (!files.length) {
            return
        }
        const roots = transfer.getChildrens()
        if (roots.length === 1 && roots[0] instanceof DirectoryUpload) {
            this.beginTransferBatch('upload', roots[0].getName(), path.posix.join(destDir, roots[0].getName()))
            return
        }
        if (files.length > 1) {
            this.beginTransferBatch('upload', this.translate.instant('{count} files', { count: files.length }), destDir)
        }
    }

    private cancelPendingUploads (transfers: FileUpload[], destDir: string): void {
        for (const transfer of transfers) {
            if (!transfer.isComplete() && !transfer.isCancelled()) {
                transfer.cancel()
                this.recordTransfer('upload', transfer.getName(), path.posix.join(destDir, transfer.getName()), 'cancelled', transfer.getCompletedBytes())
            }
        }
    }

    async uploadOne (transfer: FileUpload, relativeName?: string, destDir = this.path): Promise<void> {
        if (transfer.isCancelled()) {
            return
        }
        const dest = path.posix.join(destDir, relativeName ?? transfer.getName())
        const resolved = await this.resolveConflict(dest, transfer.getName())
        if (resolved === 'skip') {
            transfer.setCompleted(true)
            transfer.close()
            return
        }
        try {
            await this.sftp.upload(resolved, transfer)
            this.recordTransfer('upload', path.posix.basename(resolved), resolved, 'success', transfer.getSize())
        } catch (e) {
            this.recordTransfer('upload', path.posix.basename(resolved), resolved, transfer.isCancelled() ? 'cancelled' : 'error', transfer.getCompletedBytes(), e.message)
            throw e
        }
        if (this.path === destDir) {
            await this.navigate(this.path)
        }
    }

    async download (itemPath: string, mode: number, size: number): Promise<void> {
        const transfer = await this.platform.startDownload(path.basename(itemPath), mode, size)
        if (!transfer) {
            return
        }
        this.trackTransfer(transfer)
        transfer.setInfo({ host: this.hostLabel, direction: 'download', remotePath: itemPath })
        try {
            await this.sftp.download(itemPath, transfer)
            this.recordTransfer('download', path.basename(itemPath), itemPath, 'success', size)
        } catch (error) {
            this.recordTransfer('download', path.basename(itemPath), itemPath, transfer.isCancelled() ? 'cancelled' : 'error', transfer.getCompletedBytes(), error?.message)
        }
    }

    async downloadFolder (folder: SFTPFile): Promise<void> {
        try {
            const transfer = await this.platform.startDownloadDirectory(folder.name, 0)
            if (!transfer) {
                return
            }
            transfer.pausable = true
            this.trackTransfer(transfer)
            transfer.setInfo({ host: this.hostLabel, direction: 'download', remotePath: folder.fullPath })
            this.beginTransferBatch('download', folder.name, folder.fullPath)

            try {
                transfer.setStatus(this.translate.instant('Calculating size...'))
                const totalSize = await this.calculateFolderSize(folder, transfer)
                transfer.setTotalSize(totalSize)
                transfer.setStatus('')
                await this.downloadFolderRecursive(folder, transfer, '')
                transfer.setStatus('')
                transfer.setCompleted(true)
                this.endTransferBatch()
            } catch (error) {
                transfer.cancel()
                this.endTransferBatch({
                    status: transfer.isCancelled() ? 'cancelled' : 'error',
                    bytes: transfer.getCompletedBytes(),
                    error: error?.message,
                })
                throw error
            } finally {
                transfer.close()
            }
        } catch (error) {
            this.notifications.error(`Failed to download folder: ${error.message}`)
            throw error
        }
    }

    private async calculateFolderSize (folder: SFTPFile, transfer: DirectoryDownload): Promise<number> {
        if (transfer.isCancelled()) {
            throw new Error('Download cancelled')
        }
        let totalSize = 0
        const items = await this.sftp.readdir(folder.fullPath)
        for (const item of items) {
            if (item.isDirectory) {
                totalSize += await this.calculateFolderSize(item, transfer)
            } else {
                totalSize += item.size
            }
        }
        return totalSize
    }

    private async downloadFolderRecursive (folder: SFTPFile, transfer: DirectoryDownload, relativePath: string): Promise<void> {
        const items = await this.sftp.readdir(folder.fullPath)

        for (const item of items) {
            await transfer.waitIfPaused()
            if (transfer.isCancelled()) {
                throw new Error('Download cancelled')
            }

            const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name

            transfer.setStatus(itemRelativePath)
            if (item.isDirectory) {
                await transfer.createDirectory(itemRelativePath)
                await this.downloadFolderRecursive(item, transfer, itemRelativePath)
            } else {
                const fileDownload = await transfer.createFile(itemRelativePath, item.mode, item.size)
                try {
                    await this.sftp.download(item.fullPath, fileDownload, bytes => transfer.reportProgress(bytes))
                    this.recordTransfer('download', item.name, item.fullPath, 'success', item.size)
                } catch (error) {
                    this.recordTransfer('download', item.name, item.fullPath, fileDownload.isCancelled() || transfer.isCancelled() ? 'cancelled' : 'error', fileDownload.getCompletedBytes(), error?.message)
                    throw error
                }
            }
        }
    }

    private trackTransfer (transfer: FileTransfer): void {
        this.activeTransfers.push(transfer)
        if (this.progressTimer) {
            return
        }
        this.progressTimer = setInterval(() => {
            this.progressTick++
            this.activeTransfers = this.activeTransfers.filter(item => !item.isCancelled())
            if (this.activeTransfers.some(item => !item.isComplete())) {
                this.progressHideAt = 0
                return
            }
            if (!this.activeTransfers.length) {
                this.stopProgressTimer()
                return
            }
            if (!this.progressHideAt) {
                this.progressHideAt = Date.now() + 800
                return
            }
            if (Date.now() >= this.progressHideAt) {
                this.activeTransfers = []
                this.stopProgressTimer()
            }
        }, 200)
    }

    getModeString (item: SFTPFile): string {
        const s = 'SGdrwxrwxrwx'
        const e = '   ---------'
        const c = [
            0o4000, 0o2000, C.S_IFDIR,
            C.S_IRUSR, C.S_IWUSR, C.S_IXUSR,
            C.S_IRGRP, C.S_IWGRP, C.S_IXGRP,
            C.S_IROTH, C.S_IWOTH, C.S_IXOTH,
        ]
        let result = ''
        for (let i = 0; i < c.length; i++) {
            result += item.mode & c[i] ? s[i] : e[i]
        }
        return result
    }

    async buildContextMenu (item: SFTPFile): Promise<MenuItemOptions[]> {
        let items: MenuItemOptions[] = []
        for (const section of await Promise.all(this.contextMenuProviders.map(x => x.getItems(item, this)))) {
            items.push({ type: 'separator' })
            items = items.concat(section)
        }
        return items.slice(1)
    }

    async showContextMenu (item: SFTPFile, event: MouseEvent): Promise<void> {
        event.preventDefault()
        event.stopPropagation()
        if (!this.selected.has(item.fullPath)) {
            this.selected = new Set([item.fullPath])
            this.anchorPath = item.fullPath
        }
        this.platform.popupContextMenu(await this.buildContextMenu(item), event)
    }

    get shouldShowCWDTip (): boolean {
        return !window.localStorage.sshCWDTipDismissed
    }

    dismissCWDTip (): void {
        window.localStorage.sshCWDTipDismissed = 'true'
    }

    editPath (): void {
        this.editingPath = this.path
    }

    confirmPath (): void {
        if (this.editingPath === null) {
            return
        }
        this.navigate(this.editingPath)
        this.editingPath = null
    }

    close (): void {
        this.closed.emit()
    }

    openNewWindow (): void {
        this.newWindow.emit()
    }

    get hostLabel (): string {
        const options = this.session?.profile?.options
        if (!options?.host) {
            return ''
        }
        return options.user ? `${options.user}@${options.host}` : options.host
    }

    get folderCount (): number {
        return this.filteredFileList.filter(item => item.isDirectory).length
    }

    get fileCount (): number {
        return this.filteredFileList.filter(item => !item.isDirectory).length
    }

    setViewMode (mode: 'grid' | 'list'): void {
        this.viewMode = mode
        this.config.store.ssh.sftp.viewMode = mode
        this.config.save()
    }

    toggleHidden (): void {
        this.showHidden = !this.showHidden
        this.config.store.ssh.sftp.showHidden = this.showHidden
        this.config.save()
        this.updateFilteredList()
    }

    trackByPath (_: number, item: SFTPFile): string {
        return item.fullPath
    }

    clearFilter (): void {
        this.filterText = ''
        this.updateFilteredList()
    }

    onFilterChange (): void {
        this.updateFilteredList()
    }

    async openCreateFileModal (): Promise<void> {
        const name = await this.promptName(
            this.translate.instant('New file'),
            this.translate.instant('Name for the new file'),
            '',
            this.translate.instant('Create'),
        )
        if (!name) {
            return
        }
        try {
            await this.sftp.createFile(path.join(this.path, name))
            this.notifications.notice(this.translate.instant('The file was created successfully'))
            await this.navigate(this.path)
        } catch {
            this.notifications.error(this.translate.instant('The file could not be created'))
        }
    }

    async renameSelected (): Promise<void> {
        const item = this.selectedItems[0]
        if (!item) {
            return
        }
        const name = await this.promptName(
            this.translate.instant('Rename'),
            this.translate.instant('New name'),
            item.name,
            this.translate.instant('Rename'),
        )
        if (!name || name === item.name) {
            return
        }
        try {
            await this.sftp.rename(item.fullPath, path.join(this.path, name))
            await this.navigate(this.path)
        } catch (e) {
            this.notifications.error(e.message)
        }
    }

    copySelected (): void {
        const items = this.selectedItems
        if (!items.length) {
            return
        }
        this.clipboard = { action: 'copy', items }
        this.notifications.notice(this.translate.instant('Copied {count} items', { count: items.length }))
    }

    cutSelected (): void {
        const items = this.selectedItems
        if (!items.length) {
            return
        }
        this.clipboard = { action: 'cut', items }
        this.notifications.notice(this.translate.instant('Cut {count} items', { count: items.length }))
    }

    async pasteClipboard (): Promise<void> {
        if (!this.clipboard?.items.length) {
            return
        }
        const { action, items } = this.clipboard
        this.conflictApplyAll = null
        for (const item of items) {
            let dest = path.join(this.path, item.name)
            if (item.fullPath === dest && action === 'copy') {
                dest = path.join(this.path, this.copyName(item.name))
            }
            const resolved = await this.resolveConflict(dest, path.posix.basename(dest))
            if (resolved === 'skip') {
                continue
            }
            try {
                if (action === 'cut') {
                    await this.sftp.rename(item.fullPath, resolved)
                } else {
                    await this.sftp.copy(item.fullPath, resolved)
                }
            } catch (e) {
                this.notifications.error(e.message)
            }
        }
        if (action === 'cut') {
            this.clipboard = null
        }
        await this.navigate(this.path)
    }

    async openPermissions (item?: SFTPFile): Promise<void> {
        const target = item ?? this.selectedItems[0]
        if (!target) {
            return
        }
        const modal = this.ngbModal.open(SFTPPermissionsModalComponent)
        modal.componentInstance.item = target
        modal.componentInstance.sftp = this.sftp
        modal.componentInstance.canChown = this.session.authUsername === 'root' || this.session.profile.options.user === 'root'
        await modal.result.catch(() => null)
        await this.navigate(this.path)
    }

    async editInTabby (item: SFTPFile): Promise<void> {
        const maxBytes = Math.max(0, Number(this.sftpConfig.editorMaxSizeMB ?? 5)) * 1024 * 1024
        if (maxBytes && item.size > maxBytes) {
            const proceed = (await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('This file is larger than {size} MB. Open it anyway?', { size: this.sftpConfig.editorMaxSizeMB }),
                buttons: [
                    this.translate.instant('Open'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 1,
                cancelId: 1,
            })).response === 0
            if (!proceed) {
                return
            }
        }
        let openedAt = item.modified.getTime()
        let content: string
        try {
            content = await this.sftp.readTextFile(item.fullPath, maxBytes || item.size + 1)
            this.recordTransfer('edit-load', item.name, item.fullPath, 'success', item.size)
        } catch (e) {
            this.notifications.error(e.message)
            return
        }
        const modal = this.ngbModal.open(SFTPEditorModalComponent, { size: 'lg' })
        modal.componentInstance.path = item.fullPath
        modal.componentInstance.content = content
        const result = await modal.result.catch(() => null)
        if (typeof result !== 'string') {
            return
        }
        if (!await this.confirmRemoteUnchanged(item, openedAt)) {
            return
        }
        try {
            await this.sftp.writeTextFile(item.fullPath, result)
            this.recordTransfer('edit-save', item.name, item.fullPath, 'success', result.length)
            this.notifications.notice(this.translate.instant('Saved'))
            await this.navigate(this.path)
        } catch (e) {
            this.recordTransfer('edit-save', item.name, item.fullPath, 'error', result.length, e.message)
            this.notifications.error(e.message)
        }
    }

    async editOrDownload (item: SFTPFile): Promise<void> {
        if (this.isTextFile(item)) {
            await this.editInTabby(item)
            return
        }
        await this.download(item.fullPath, item.mode, item.size)
    }

    openTransferLog (): void {
        const modal = this.ngbModal.open(SFTPTransferLogModalComponent, { size: 'lg' })
        modal.componentInstance.host = this.hostLabel
    }

    onItemDragStart (item: SFTPFile, event: DragEvent): void {
        if (!this.selected.has(item.fullPath)) {
            this.selected = new Set([item.fullPath])
            this.anchorPath = item.fullPath
        }
        this.internalDragItems = this.selectedItems
        this.dropTargetPath = null
        event.dataTransfer?.setData('text/plain', item.fullPath)
        event.dataTransfer?.setData('application/x-tabby-sftp', item.fullPath)
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'copyMove'
        }
        const cached = this.dragCache.get(this.cacheKey(item))
        if (cached && this.hostApp.platform !== Platform.Web) {
            this.platform.startNativeDrag(cached)
            return
        }
        void this.prefetchForDrag(item)
    }

    onItemDragEnd (): void {
        setTimeout(() => this.clearInternalDrag(), 0)
    }

    onGoUpDragOver (event: DragEvent): void {
        if (!this.isInternalDrag || this.path === '/') {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move'
        }
        this.dropTargetPath = '..'
    }

    async onGoUpDrop (event: DragEvent): Promise<void> {
        if (!this.isInternalDrag || this.path === '/') {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        await this.moveDraggedItems(path.dirname(this.path))
    }

    onItemDragOver (item: SFTPFile, event: DragEvent): void {
        if (!this.isInternalDrag || !item.isDirectory || this.isDraggingItem(item)) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move'
        }
        this.dropTargetPath = item.fullPath
    }

    async onItemDrop (item: SFTPFile, event: DragEvent): Promise<void> {
        if (!this.isInternalDrag || !item.isDirectory || this.isDraggingItem(item)) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        await this.moveDraggedItems(item.fullPath)
    }

    onDropTargetLeave (event: DragEvent): void {
        const current = event.currentTarget as Node | null
        const related = event.relatedTarget as Node | null
        if (current && related && current.contains(related)) {
            return
        }
        this.dropTargetPath = null
    }

    private isDraggingItem (item: SFTPFile): boolean {
        return !!this.internalDragItems?.some(dragged => dragged.fullPath === item.fullPath)
    }

    private clearInternalDrag (): void {
        this.internalDragItems = null
        this.dropTargetPath = null
        this.isDragging = false
        this.dragDepth = 0
    }

    private async moveDraggedItems (destDir: string): Promise<void> {
        const items = this.internalDragItems ?? []
        this.clearInternalDrag()
        const destination = destDir === '/' ? '/' : destDir.replace(/\/+$/, '')
        for (const item of items) {
            const parent = path.dirname(item.fullPath)
            if (parent === destination || item.fullPath === destination) {
                continue
            }
            const target = path.posix.join(destination, item.name)
            if (target === item.fullPath) {
                continue
            }
            try {
                const resolved = await this.resolveConflict(target, item.name)
                if (resolved === 'skip') {
                    continue
                }
                await this.sftp.rename(item.fullPath, resolved)
            } catch (e) {
                this.notifications.error(e.message)
            }
        }
        await this.navigate(this.path)
    }

    private async prefetchForDrag (item: SFTPFile): Promise<void> {
        if (item.isDirectory) {
            this.notifications.notice(this.translate.instant('Folders cannot be dragged out. Download the folder instead.'))
            return
        }
        if (this.hostApp.platform === Platform.Web) {
            return
        }
        this.notifications.notice(this.translate.instant('Preparing file to drag. Drop it again in a moment.'))
        const temp = await this.platform.getTempPath(item.name)
        if (!temp) {
            return
        }
        const transfer = await this.platform.startDownload(item.name, item.mode, item.size, temp)
        if (!transfer) {
            return
        }
        try {
            await this.sftp.download(item.fullPath, transfer)
            this.dragCache.set(this.cacheKey(item), temp)
        } catch (e) {
            this.notifications.error(e.message)
        }
    }

    private cacheKey (item: SFTPFile): string {
        return `${item.fullPath}:${item.size}:${item.modified.getTime()}`
    }

    private async promptName (title: string, label: string, value: string, confirmLabel: string): Promise<string> {
        const modal = this.ngbModal.open(SFTPNameModalComponent)
        modal.componentInstance.title = title
        modal.componentInstance.label = label
        modal.componentInstance.value = value
        modal.componentInstance.confirmLabel = confirmLabel
        return (await modal.result.catch(() => '')) || ''
    }

    private async resolveStartPath (): Promise<string> {
        const configured = (this.sftpConfig.startDirectory || '~').trim() || '~'
        if (configured === '~') {
            return this.sftp.getHomePath()
        }
        if (configured.startsWith('~/')) {
            return path.posix.join(await this.sftp.getHomePath(), configured.slice(2))
        }
        return configured
    }

    private async resolveConflict (destPath: string, name: string, session = this.sftp): Promise<string | 'skip'> {
        if (!await session.exists(destPath)) {
            return destPath
        }
        const preset = this.conflictApplyAll
        if (preset === 'overwrite') {
            return destPath
        }
        if (preset === 'skip') {
            return 'skip'
        }
        const modal = this.ngbModal.open(SFTPConflictModalComponent)
        modal.componentInstance.path = destPath
        modal.componentInstance.name = name
        const result: SFTPConflictResult | null = await modal.result.catch(() => null)
        if (!result) {
            return 'skip'
        }
        if (result.applyToAll) {
            this.conflictApplyAll = result.choice
        }
        if (result.choice === 'skip') {
            return 'skip'
        }
        if (result.choice === 'rename') {
            return path.posix.join(path.posix.dirname(destPath), result.newName || this.copyName(name))
        }
        return destPath
    }

    private copyName (name: string): string {
        const dot = name.lastIndexOf('.')
        if (dot > 0) {
            return `${name.slice(0, dot)} (copy)${name.slice(dot)}`
        }
        return `${name} (copy)`
    }

    private async confirmRemoteUnchanged (item: SFTPFile, openedAt: number): Promise<boolean> {
        try {
            const current = await this.sftp.stat(item.fullPath)
            if (current.modified.getTime() <= openedAt) {
                return true
            }
        } catch {
            return true
        }
        return (await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('This file changed on the server while it was open. Overwrite the remote file?'),
            buttons: [
                this.translate.instant('Overwrite'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })).response === 0
    }

    private isTextFile (item: SFTPFile): boolean {
        if (item.isDirectory) {
            return false
        }
        const match = /\.([^.]+)$/.exec(item.name)
        const ext = match ? match[1].toLowerCase() : ''
        return ['txt', 'log', 'ini', 'conf', 'cfg', 'md', 'json', 'yml', 'yaml', 'xml', 'csv', 'html', 'css', 'js', 'ts', 'py', 'sh', 'rb', 'php', 'rs', 'go', 'c', 'h', 'cpp', 'java', 'sql', 'vue', 'tsx', 'jsx'].includes(ext)
    }

    async sendSelected (): Promise<void> {
        const items = this.selectedItems
        if (!items.length) {
            return
        }
        const targets = this.connections.list(this)
        if (!targets.length) {
            this.notifications.notice(this.translate.instant('Open another SFTP connection first'))
            return
        }
        const modal = this.ngbModal.open(SFTPSendToModalComponent)
        modal.componentInstance.targets = targets
        const target: SFTPConnectionRef | null = await modal.result.catch(() => null)
        if (!target?.panel.sftp) {
            return
        }
        await this.sendItemsTo(items, target)
    }

    async refreshIfHere (dir: string): Promise<void> {
        if (this.path === dir && this.sftp) {
            await this.navigate(this.path)
        }
    }

    private async sendItemsTo (items: SFTPFile[], target: SFTPConnectionRef): Promise<void> {
        const destDir = target.path
        const dest = target.panel.sftp
        let total = 0
        for (const item of items) {
            total += await this.itemTotalSize(item)
        }
        const name = items.length === 1
            ? items[0].name
            : this.translate.instant('{count} items', { count: items.length })
        const transfer = new RemoteCopyTransfer(name, total)
        transfer.setInfo({
            host: `${this.hostLabel} → ${target.label}`,
            direction: 'copy',
            remotePath: destDir,
        })
        this.platform.registerTransfer(transfer)
        this.trackTransfer(transfer)
        this.beginTransferBatch('copy', name, destDir, this.hostLabel, target.label)
        this.conflictApplyAll = null
        try {
            for (const item of items) {
                await transfer.waitIfPaused()
                if (transfer.isCancelled()) {
                    throw new Error('Transfer cancelled')
                }
                await this.copyItemTo(item, dest, destDir, transfer)
            }
            transfer.setCompleted(true)
            this.endTransferBatch()
        } catch (error) {
            if (!transfer.isCancelled()) {
                transfer.cancel()
            }
            this.endTransferBatch({
                status: transfer.isCancelled() ? 'cancelled' : 'error',
                bytes: transfer.getCompletedBytes(),
                error: error?.message,
            })
            this.notifications.error(error.message)
        }
        await target.panel.refreshIfHere(destDir)
    }

    private async copyItemTo (item: SFTPFile, dest: SFTPSession, destDir: string, transfer: FileTransfer): Promise<void> {
        const destPath = path.posix.join(destDir, item.name)
        if (item.isDirectory) {
            await dest.mkdir(destPath).catch(() => null)
            transfer.setStatus(item.name)
            for (const child of await this.sftp.readdir(item.fullPath)) {
                await transfer.waitIfPaused()
                if (transfer.isCancelled()) {
                    throw new Error('Transfer cancelled')
                }
                await this.copyItemTo(child, dest, destPath, transfer)
            }
            return
        }
        const resolved = await this.resolveConflict(destPath, item.name, dest)
        if (resolved === 'skip') {
            transfer.reportProgress(item.size)
            this.recordTransfer('copy', item.name, destPath, 'cancelled', 0)
            return
        }
        transfer.setStatus(item.name)
        try {
            await this.sftp.copyTo(dest, item.fullPath, resolved, transfer)
            this.recordTransfer('copy', item.name, resolved, 'success', item.size)
        } catch (error) {
            this.recordTransfer('copy', item.name, resolved, transfer.isCancelled() ? 'cancelled' : 'error', item.size, error?.message)
            throw error
        }
    }

    private async itemTotalSize (item: SFTPFile): Promise<number> {
        if (!item.isDirectory) {
            return item.size
        }
        let total = 0
        for (const child of await this.sftp.readdir(item.fullPath)) {
            total += await this.itemTotalSize(child)
        }
        return total
    }

    private beginTransferBatch (
        direction: SFTPTransferDirection,
        name: string,
        remotePath: string,
        sourceHost?: string,
        destHost?: string,
    ): void {
        if (this.transferBatch) {
            this.transferBatch.depth++
            return
        }
        this.transferBatch = {
            depth: 1,
            direction,
            name,
            remotePath,
            children: [],
            startedAt: Date.now(),
            sourceHost,
            destHost,
        }
    }

    private endTransferBatch (fallback?: { status: SFTPTransferStatus, bytes: number, error?: string }): void {
        if (!this.transferBatch) {
            return
        }
        if (this.transferBatch.depth > 1) {
            this.transferBatch.depth--
            return
        }
        const batch = this.transferBatch
        this.transferBatch = null
        const duration = Date.now() - batch.startedAt
        if (!batch.children.length) {
            if (fallback) {
                this.transferLog.record({
                    direction: batch.direction,
                    name: batch.name,
                    remotePath: batch.remotePath,
                    host: batch.destHost ? `${batch.sourceHost} → ${batch.destHost}` : this.hostLabel,
                    status: fallback.status,
                    bytes: fallback.bytes,
                    error: fallback.error,
                    startedAt: batch.startedAt,
                    duration,
                    sourceHost: batch.sourceHost,
                    destHost: batch.destHost,
                })
            }
            return
        }
        const status: SFTPTransferStatus = batch.children.some(child => child.status === 'error')
            ? 'error'
            : batch.children.some(child => child.status === 'cancelled')
                ? 'cancelled'
                : 'success'
        this.transferLog.record({
            direction: batch.direction,
            name: batch.name,
            remotePath: batch.remotePath,
            host: batch.destHost ? `${batch.sourceHost} → ${batch.destHost}` : this.hostLabel,
            status,
            bytes: batch.children.reduce((sum, child) => sum + child.bytes, 0),
            children: batch.children,
            error: batch.children.find(child => child.error)?.error,
            startedAt: batch.startedAt,
            duration,
            sourceHost: batch.sourceHost,
            destHost: batch.destHost,
        })
    }

    private recordTransfer (
        direction: SFTPTransferDirection,
        name: string,
        remotePath: string,
        status: SFTPTransferStatus,
        bytes: number,
        error?: string,
    ): void {
        if (this.transferBatch && (direction === 'upload' || direction === 'download' || direction === 'copy')) {
            this.transferBatch.children.push({ name, remotePath, status, bytes, error })
            return
        }
        this.transferLog.record({
            direction,
            name,
            remotePath,
            host: this.hostLabel,
            status,
            bytes,
            error,
        })
    }

    private updateFilteredList (): void {
        if (!this.fileList) {
            this.filteredFileList = []
            return
        }

        let files = this.fileList
        if (!this.showHidden) {
            files = files.filter(item => !item.name.startsWith('.'))
        }

        if (this.filterText.trim() === '') {
            this.filteredFileList = files
            return
        }

        const query = this.filterText.toLowerCase()
        this.filteredFileList = files.filter(item =>
            item.name.toLowerCase().includes(query),
        )
    }
}
