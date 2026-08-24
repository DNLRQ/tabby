import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent } from 'tabby-core'
import { SFTPConnectionRef } from '../services/sftpConnections.service'

/** @hidden */
@Component({
    templateUrl: './sftpSendToModal.component.pug',
    styleUrls: ['./sftpSendToModal.component.scss'],
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

    hostFor (target: SFTPConnectionRef): string {
        if (!target.host || target.host === target.label) {
            return ''
        }
        return target.host
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
