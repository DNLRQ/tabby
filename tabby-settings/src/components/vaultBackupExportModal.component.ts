import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, PartialProfile, Profile, ProfilesService } from 'tabby-core'

interface BackupProfileRow {
    profile: PartialProfile<Profile>
    selected: boolean
    groupName: string
    host: string
}

/** @hidden */
@Component({
    templateUrl: './vaultBackupExportModal.component.pug',
    styleUrls: ['./vaultBackupExportModal.component.scss'],
})
export class VaultBackupExportModalComponent extends BaseComponent {
    mode: 'all' | 'selected' = 'all'
    query = ''
    rows: BackupProfileRow[] = []

    constructor (
        private modalInstance: NgbActiveModal,
        private profiles: ProfilesService,
    ) {
        super()
    }

    async ngOnInit (): Promise<void> {
        const groups = await this.profiles.getProfileGroups({ includeNonUserGroup: true, includeProfiles: true })
        const rows: BackupProfileRow[] = []
        for (const group of groups) {
            for (const profile of group.profiles ?? []) {
                if (profile.isBuiltin || profile.isTemplate) {
                    continue
                }
                rows.push({
                    profile,
                    selected: false,
                    groupName: group.name,
                    host: this.hostLabel(profile),
                })
            }
        }
        this.rows = rows
    }

    get visibleRows (): BackupProfileRow[] {
        const query = this.query.trim().toLowerCase()
        if (!query) {
            return this.rows
        }
        return this.rows.filter(row =>
            [row.profile.name, row.groupName, row.host, row.profile.type]
                .join(' ')
                .toLowerCase()
                .includes(query),
        )
    }

    get selectedCount (): number {
        return this.rows.filter(row => row.selected).length
    }

    toggleVisible (selected: boolean): void {
        for (const row of this.visibleRows) {
            row.selected = selected
        }
    }

    confirm (): void {
        if (this.mode === 'selected' && !this.selectedCount) {
            return
        }
        this.modalInstance.close({
            profileIds: this.mode === 'all' ? null : this.rows.filter(row => row.selected).map(row => row.profile.id),
        })
    }

    cancel (): void {
        this.modalInstance.dismiss()
    }

    private hostLabel (profile: PartialProfile<Profile>): string {
        const host = profile.options?.host
        if (!host) {
            return this.profiles.getDescription(profile) ?? ''
        }
        const user = profile.options?.user
        const port = profile.options?.port
        const target = port ? `${host}:${port}` : host
        return user ? `${user}@${target}` : target
    }
}
