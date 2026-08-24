import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, PlatformService, TranslateService } from 'tabby-core'
import { SFTPTransferDirection, SFTPTransferLogEntry, SFTPTransferStatus, SFTPTransfersService } from '../services/sftpTransfers.service'

/** @hidden */
@Component({
    templateUrl: './sftpTransferLogModal.component.pug',
    styleUrls: ['./sftpTransferLogModal.component.scss'],
})
export class SFTPTransferLogModalComponent extends BaseComponent {
    @Input() host = ''
    filter = ''
    status = ''
    expanded = new Set<string>()

    constructor (
        private modalInstance: NgbActiveModal,
        private transfers: SFTPTransfersService,
        private platform: PlatformService,
        private translate: TranslateService,
    ) {
        super()
    }

    get entries (): SFTPTransferLogEntry[] {
        const query = this.filter.trim().toLowerCase()
        return this.transfers.getLog(this.host).filter(entry => {
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
                ...(entry.children ?? []).flatMap(child => [child.name, child.remotePath]),
            ].join(' ').toLowerCase()
            return haystack.includes(query)
        })
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

    directionLabel (direction: SFTPTransferDirection): string {
        const labels: Record<SFTPTransferDirection, string> = {
            upload: this.translate.instant('Upload'),
            download: this.translate.instant('Download'),
            copy: this.translate.instant('Between connections'),
            'edit-load': this.translate.instant('Edit'),
            'edit-save': this.translate.instant('Save'),
        }
        return labels[direction] ?? direction
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

    statusLabel (status: SFTPTransferStatus): string {
        const labels: Record<SFTPTransferStatus, string> = {
            success: this.translate.instant('Success'),
            error: this.translate.instant('Error'),
            cancelled: this.translate.instant('Cancelled'),
        }
        return labels[status] ?? status
    }

    async export (): Promise<void> {
        const data = new TextEncoder().encode(this.transfers.exportJSON(this.host || undefined))
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
        this.transfers.clear(this.host || undefined)
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

    close (): void {
        this.modalInstance.close()
    }
}
