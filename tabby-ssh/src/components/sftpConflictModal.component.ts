import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent } from 'tabby-core'

export type SFTPConflictChoice = 'overwrite' | 'skip' | 'rename'

export interface SFTPConflictResult {
    choice: SFTPConflictChoice
    applyToAll: boolean
    newName?: string
}

/** @hidden */
@Component({
    templateUrl: './sftpConflictModal.component.pug',
})
export class SFTPConflictModalComponent extends BaseComponent {
    @Input() path = ''
    @Input() name = ''
    applyToAll = false
    newName = ''

    constructor (
        private modalInstance: NgbActiveModal,
    ) {
        super()
    }

    ngOnInit (): void {
        this.newName = this.suggestName(this.name)
    }

    choose (choice: SFTPConflictChoice): void {
        this.modalInstance.close({
            choice,
            applyToAll: this.applyToAll,
            newName: choice === 'rename' ? this.newName.trim() || this.suggestName(this.name) : undefined,
        } as SFTPConflictResult)
    }

    cancel (): void {
        this.modalInstance.close(null)
    }

    private suggestName (name: string): string {
        const dot = name.lastIndexOf('.')
        if (dot > 0) {
            return `${name.slice(0, dot)} (1)${name.slice(dot)}`
        }
        return `${name} (1)`
    }
}
