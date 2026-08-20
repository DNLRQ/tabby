import { Component, Input, Output, EventEmitter, HostBinding, OnDestroy, OnInit } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { ConfigService } from '../services/config.service'
import { FileDownload, FileTransfer, PlatformService } from '../api/platform'

/** @hidden */
@Component({
    selector: 'transfers-menu',
    templateUrl: './transfersMenu.component.pug',
    styleUrls: ['./transfersMenu.component.scss'],
})
export class TransfersMenuComponent implements OnInit, OnDestroy {
    @Input() transfers: FileTransfer[]
    @Output() transfersChange = new EventEmitter<FileTransfer[]>()
    progressTick = 0
    @HostBinding('class.vibrant') get isVibrant (): boolean {
        return this.config.store.appearance.vibrancy
    }
    private progressTimer: ReturnType<typeof setInterval> | null = null

    constructor (
        private config: ConfigService,
        private platform: PlatformService,
        private translate: TranslateService,
    ) { }

    ngOnInit (): void {
        this.progressTimer = setInterval(() => {
            this.progressTick++
        }, 200)
    }

    ngOnDestroy (): void {
        if (this.progressTimer) {
            clearInterval(this.progressTimer)
            this.progressTimer = null
        }
    }

    isDownload (transfer: FileTransfer): boolean {
        return transfer instanceof FileDownload
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

    pauseTransfer (transfer: FileTransfer): void {
        transfer.pause()
    }

    resumeTransfer (transfer: FileTransfer): void {
        transfer.resume()
    }

    showTransfer (transfer: FileTransfer): void {
        const fp = transfer['filePath']
        if (fp) {
            this.platform.showItemInFolder(fp)
        }
    }

    removeTransfer (transfer: FileTransfer): void {
        if (!transfer.isComplete()) {
            transfer.cancel()
        }
        this.transfers = this.transfers.filter(x => x !== transfer)
        this.transfersChange.emit(this.transfers)
    }

    async removeAll (): Promise<void> {
        if (this.transfers.some(x => !x.isComplete())) {
            if ((await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('There are active file transfers'),
                buttons: [
                    this.translate.instant('Abort all'),
                    this.translate.instant('Do not abort'),
                ],
                defaultId: 1,
                cancelId: 1,
            })).response === 1) {
                return
            }
        }
        for (const t of this.transfers) {
            this.removeTransfer(t)
        }
    }
}
