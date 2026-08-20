import * as C from 'constants'
import { posix as path } from 'path'
import { Component, Input, Output, EventEmitter, Inject, Optional, HostListener, HostBinding, OnDestroy } from '@angular/core'
import { Subscription } from 'rxjs'
import { FileUpload, DirectoryUpload, DirectoryDownload, MenuItemOptions, NotificationsService, PlatformService, TranslateService, ConfigService } from 'tabby-core'
import { SFTPSession, SFTPFile } from '../session/sftp'
import { SSHSession } from '../session/ssh'
import { SFTPContextMenuItemProvider } from '../api'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { SFTPCreateDirectoryModalComponent } from './sftpCreateDirectoryModal.component'
import { SFTPDeleteModalComponent } from './sftpDeleteModal.component'

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
    private dragDepth = 0
    private selected = new Set<string>()
    private anchorPath: string | null = null
    private configSub: Subscription | null = null

    constructor (
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private config: ConfigService,
        public platform: PlatformService,
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
        this.configSub?.unsubscribe()
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
        try {
            await this.navigate(this.path)
        } catch (error) {
            console.warn('Could not navigate to', this.path, ':', error)
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

    get selectedItems (): SFTPFile[] {
        return this.filteredFileList.filter(item => this.selected.has(item.fullPath))
    }

    clearSelection (): void {
        this.selected = new Set()
    }

    async downloadSelected (): Promise<void> {
        for (const item of this.selectedItems) {
            await this.downloadItem(item)
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
        if (!this.sftpConfig.dragAndDrop || !this.hasFiles(event)) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        this.dragDepth++
        this.isDragging = true
    }

    onDragOver (event: DragEvent): void {
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
        if (!this.sftpConfig.dragAndDrop) {
            return
        }
        const transfer = await this.platform.startUploadFromDragEvent(event, true)
        if (!transfer.getChildrens().length) {
            return
        }
        await this.uploadOneFolder(transfer)
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

        if (event.key === 'Escape' && this.selected.size) {
            this.clearSelection()
            event.preventDefault()
            return
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && this.sftpConfig.multiSelect && this.filteredFileList.length) {
            event.preventDefault()
            this.selected = new Set(this.filteredFileList.map(item => item.fullPath))
            this.anchorPath = this.filteredFileList[0]?.fullPath ?? null
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
                await this.download(item.fullPath, stat.mode, stat.size)
            }
        } else {
            await this.download(item.fullPath, item.mode, item.size)
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
        const transfers = await this.platform.startUpload({ multiple: true })
        await Promise.all(transfers.map(t => this.uploadOne(t)))
    }

    async uploadFolder (): Promise<void> {
        const transfer = await this.platform.startUploadDirectory()
        await this.uploadOneFolder(transfer)
    }

    async uploadOneFolder (transfer: DirectoryUpload, accumPath = ''): Promise<void> {
        const savedPath = this.path
        for(const t of transfer.getChildrens()) {
            if (t instanceof DirectoryUpload) {
                try {
                    await this.sftp.mkdir(path.posix.join(this.path, accumPath, t.getName()))
                } catch {
                    // Intentionally ignoring errors from making duplicate dirs.
                }
                await this.uploadOneFolder(t, path.posix.join(accumPath, t.getName()))
            } else {
                await this.sftp.upload(path.posix.join(this.path, accumPath, t.getName()), t)
            }
        }
        if (this.path === savedPath) {
            await this.navigate(this.path)
        }
    }

    async uploadOne (transfer: FileUpload): Promise<void> {
        const savedPath = this.path
        await this.sftp.upload(path.join(this.path, transfer.getName()), transfer)
        if (this.path === savedPath) {
            await this.navigate(this.path)
        }
    }

    async download (itemPath: string, mode: number, size: number): Promise<void> {
        const transfer = await this.platform.startDownload(path.basename(itemPath), mode, size)
        if (!transfer) {
            return
        }
        this.sftp.download(itemPath, transfer)
    }

    async downloadFolder (folder: SFTPFile): Promise<void> {
        try {
            const transfer = await this.platform.startDownloadDirectory(folder.name, 0)
            if (!transfer) {
                return
            }

            // Start background size calculation and download simultaneously
            const sizeCalculationPromise = this.calculateFolderSizeAndUpdate(folder, transfer)
            const downloadPromise = this.downloadFolderRecursive(folder, transfer, '')

            try {
                await Promise.all([sizeCalculationPromise, downloadPromise])
                transfer.setStatus('')
                transfer.setCompleted(true)
            } catch (error) {
                transfer.cancel()
                throw error
            } finally {
                transfer.close()
            }
        } catch (error) {
            this.notifications.error(`Failed to download folder: ${error.message}`)
            throw error
        }
    }

    private async calculateFolderSizeAndUpdate (folder: SFTPFile, transfer: DirectoryDownload) {
        let totalSize = 0
        const items = await this.sftp.readdir(folder.fullPath)
        for (const item of items) {
            if (item.isDirectory) {
                totalSize += await this.calculateFolderSizeAndUpdate(item, transfer)
            } else {
                totalSize += item.size
            }
            transfer.setTotalSize(totalSize)
        }
        return totalSize
    }

    private async downloadFolderRecursive (folder: SFTPFile, transfer: DirectoryDownload, relativePath: string): Promise<void> {
        const items = await this.sftp.readdir(folder.fullPath)

        for (const item of items) {
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
                await this.sftp.download(item.fullPath, fileDownload)
            }
        }
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
