/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { FullyDefined, ProfileSettingsComponent, PromptModalComponent, ProxifiedConfig } from 'tabby-core'
import { RDPProfile } from '../api'
import { RDPProfilesService } from '../profiles'
import { PasswordStorageService } from '../services/passwordStorage.service'

/** @hidden */
@Component({
    templateUrl: './rdpProfileSettings.component.pug',
})
export class RDPProfileSettingsComponent implements ProfileSettingsComponent<RDPProfile, RDPProfilesService> {
    profile: ProxifiedConfig<FullyDefined<RDPProfile>>
    hasSavedPassword: boolean

    constructor (
        private passwordStorage: PasswordStorageService,
        private ngbModal: NgbModal,
    ) { }

    async ngOnInit () {
        if (this.profile.options.user) {
            try {
                this.hasSavedPassword = !!await this.passwordStorage.loadPassword(this.profile)
            } catch (e) {
                console.error('Could not check for saved password', e)
            }
        }
    }

    async setPassword () {
        const modal = this.ngbModal.open(PromptModalComponent)
        modal.componentInstance.prompt = `Password for ${this.profile.options.user}@${this.profile.options.host}`
        modal.componentInstance.password = true
        try {
            const result = await modal.result.catch(() => null)
            if (result?.value) {
                this.passwordStorage.savePassword(this.profile, result.value)
                this.hasSavedPassword = true
            }
        } catch { }
    }

    clearSavedPassword () {
        this.hasSavedPassword = false
        this.passwordStorage.deletePassword(this.profile)
    }
}
