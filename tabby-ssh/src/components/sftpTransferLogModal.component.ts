import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, PlatformService } from 'tabby-core'
import { SFTPTransferLogEntry, SFTPTransfersService } from '../services/sftpTransfers.service'

/** @hidden */
@Component({
    templateUrl: './sftpTransferLogModal.component.pug',
})
export class SFTPTransferLogModalComponent extends BaseComponent {
    filter = ''
    status = ''

    constructor (
        private modalInstance: NgbActiveModal,
        private transfers: SFTPTransfersService,
        private platform: PlatformService,
    ) {
        super()
    }

    get entries (): SFTPTransferLogEntry[] {
        const query = this.filter.trim().toLowerCase()
        return this.transfers.getLog().filter(entry => {
            if (this.status && entry.status !== this.status) {
                return false
            }
            if (!query) {
                return true
            }
            return `${entry.name} ${entry.remotePath} ${entry.host}`.toLowerCase().includes(query)
        })
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

    clear (): void {
        this.transfers.clear()
    }

    close (): void {
        this.modalInstance.close()
    }
}
