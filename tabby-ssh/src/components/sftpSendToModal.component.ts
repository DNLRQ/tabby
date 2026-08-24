import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent } from 'tabby-core'
import { SFTPConnectionRef } from '../services/sftpConnections.service'

/** @hidden */
@Component({
    templateUrl: './sftpSendToModal.component.pug',
})
export class SFTPSendToModalComponent extends BaseComponent {
    @Input() targets: SFTPConnectionRef[] = []
    selected: SFTPConnectionRef | null = null

    constructor (
        private modalInstance: NgbActiveModal,
    ) {
        super()
    }

    ngOnInit (): void {
        this.selected = this.targets[0] ?? null
    }

    confirm (): void {
        if (!this.selected) {
            return
        }
        this.modalInstance.close(this.selected)
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }
}
