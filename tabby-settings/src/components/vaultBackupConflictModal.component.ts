import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, PartialProfile, Profile, VaultBackupConflictChoice, VaultBackupConflictDecision } from 'tabby-core'

/** @hidden */
@Component({
    templateUrl: './vaultBackupConflictModal.component.pug',
    styleUrls: ['./vaultBackupConflictModal.component.scss'],
})
export class VaultBackupConflictModalComponent extends BaseComponent {
    @Input() incoming: PartialProfile<Profile>
    @Input() existing: PartialProfile<Profile>
    applyToAll = false

    constructor (
        private modalInstance: NgbActiveModal,
    ) {
        super()
    }

    hostLabel (profile: PartialProfile<Profile>): string {
        const host = profile.options?.host
        if (!host) {
            return profile.type ?? ''
        }
        const user = profile.options?.user
        const port = profile.options?.port
        const target = port ? `${host}:${port}` : host
        return user ? `${user}@${target}` : target
    }

    choose (choice: VaultBackupConflictChoice): void {
        this.modalInstance.close({
            choice,
            applyToAll: this.applyToAll,
        } as VaultBackupConflictDecision)
    }

    cancel (): void {
        this.modalInstance.close(null)
    }
}
