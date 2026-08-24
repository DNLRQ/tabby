import { Component, HostListener, OnDestroy, OnInit } from '@angular/core'
import { Subscription } from 'rxjs'
import { BaseComponent, BatchFileTransfer, FileDownload, FileTransfer, PlatformService, TransfersUIService, TranslateService } from 'tabby-core'
import { SFTPTransferDirection, SFTPTransferLogEntry, SFTPTransferStatus, SFTPTransfersService } from '../services/sftpTransfers.service'

/** @hidden */
@Component({
    selector: 'sftp-transfers-page',
    templateUrl: './sftpTransfersWindow.component.pug',
    styleUrls: ['./sftpTransfersWindow.component.scss'],
})
export class SFTPTransfersWindowComponent extends BaseComponent implements OnInit, OnDestroy {
    filter = ''
    status = ''
    tab: 'active' | 'history' = 'active'
    progressTick = 0
    expanded = new Set<string>()
    private progressTimer: ReturnType<typeof setInterval> | null = null
    private subs = new Subscription()

    constructor (
        public transfersUI: TransfersUIService,
        private transfers: SFTPTransfersService,
        private platform: PlatformService,
        private translate: TranslateService,
    ) {
        super()
    }

    ngOnInit (): void {
        this.tab = this.transfersUI.activeCount ? 'active' : 'history'
        this.progressTimer = setInterval(() => {
            this.progressTick++
        }, 200)
        this.subs.add(this.transfersUI.changed$.subscribe(() => {
            this.progressTick++
        }))
        this.subs.add(this.transfers.changed$.subscribe(() => {
            this.progressTick++
        }))
    }

    ngOnDestroy (): void {
        if (this.progressTimer) {
            clearInterval(this.progressTimer)
        }
        this.subs.unsubscribe()
    }

    @HostListener('document:keydown.escape')
    onEscape (): void {
        this.close()
    }

    close (): void {
        this.transfersUI.closeFullScreen()
    }

    get activeTransfers (): FileTransfer[] {
        void this.progressTick
        return this.transfersUI.transfers
    }

    get entries (): SFTPTransferLogEntry[] {
        void this.progressTick
        const query = this.filter.trim().toLowerCase()
        return this.transfers.getLog().filter(entry => {
            if (this.status && entry.status !== this.status && !entry.children?.some(child => child.status === this.status)) {
                return false
            }
            if (!query) {
                return true
            }
            const haystack = [
                entry.name,
                entry.remotePath,
                entry.host,
                entry.sourceHost ?? '',
                entry.destHost ?? '',
                ...(entry.children ?? []).flatMap(child => [child.name, child.remotePath]),
            ].join(' ').toLowerCase()
            return haystack.includes(query)
        })
    }

    isDownload (transfer: FileTransfer): boolean {
        return transfer instanceof FileDownload || transfer.direction === 'download'
    }

    getDisplayName (transfer: FileTransfer): string {
        void this.progressTick
        if (transfer instanceof BatchFileTransfer && !transfer.getCustomName()) {
            return this.translate.instant('{count} files', { count: transfer.getFileCount() })
        }
        return transfer.getName()
    }

    getTotal (transfer: FileTransfer): number {
        void this.progressTick
        return transfer.getSize() || transfer.getTotalSize()
    }

    getCompleted (transfer: FileTransfer): number {
        void this.progressTick
        return transfer.getCompletedBytes()
    }

    getRemaining (transfer: FileTransfer): number {
        return Math.max(0, this.getTotal(transfer) - this.getCompleted(transfer))
    }

    getProgress (transfer: FileTransfer): number {
        const size = this.getTotal(transfer)
        if (!size) {
            return 0
        }
        return Math.min(100, Math.round(100 * this.getCompleted(transfer) / size))
    }

    formatDuration (ms: number): string {
        const total = Math.max(0, Math.floor(ms / 1000))
        const hours = Math.floor(total / 3600)
        const minutes = Math.floor((total % 3600) / 60)
        const seconds = total % 60
        if (hours) {
            return `${hours}h ${minutes}m ${seconds}s`
        }
        if (minutes) {
            return `${minutes}m ${seconds}s`
        }
        return `${seconds}s`
    }

    toggle (entry: SFTPTransferLogEntry): void {
        if (!entry.children?.length) {
            return
        }
        if (this.expanded.has(entry.id)) {
            this.expanded.delete(entry.id)
            return
        }
        this.expanded.add(entry.id)
    }

    isExpanded (entry: SFTPTransferLogEntry): boolean {
        return this.expanded.has(entry.id)
    }

    isBatch (entry: SFTPTransferLogEntry): boolean {
        return !!entry.children?.length
    }

    directionLabel (direction: SFTPTransferDirection | string): string {
        const labels: Record<string, string> = {
            upload: this.translate.instant('Upload'),
            download: this.translate.instant('Download'),
            copy: this.translate.instant('Between connections'),
            'edit-load': this.translate.instant('Edit'),
            'edit-save': this.translate.instant('Save'),
        }
        return labels[direction] ?? direction
    }

    statusLabel (status: SFTPTransferStatus): string {
        const labels: Record<SFTPTransferStatus, string> = {
            success: this.translate.instant('Success'),
            error: this.translate.instant('Error'),
            cancelled: this.translate.instant('Cancelled'),
        }
        return labels[status] ?? status
    }

    pauseTransfer (transfer: FileTransfer): void {
        transfer.pause()
    }

    resumeTransfer (transfer: FileTransfer): void {
        transfer.resume()
    }

    removeTransfer (transfer: FileTransfer): void {
        if (!transfer.isComplete()) {
            transfer.cancel()
        }
        this.transfersUI.set(this.transfersUI.transfers.filter(item => item !== transfer))
    }

    async export (): Promise<void> {
        const data = new TextEncoder().encode(this.transfers.exportJSON())
        const transfer = await this.platform.startDownload('sftp-transfers.json', 0o644, data.length)
        if (!transfer) {
            return
        }
        await transfer.write(data)
        transfer.close()
    }

    async clear (): Promise<void> {
        if (!(await this.confirmClear())) {
            return
        }
        this.transfers.clear()
        this.expanded.clear()
    }

    private async confirmClear (): Promise<boolean> {
        return (await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Clear transfer history?'),
            detail: this.translate.instant('This cannot be undone.'),
            buttons: [
                this.translate.instant('Clear'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })).response === 0
    }
}
