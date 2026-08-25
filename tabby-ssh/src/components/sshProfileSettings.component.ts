/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, ViewChild } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { firstBy } from 'thenby'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { FileProvidersService, Platform, HostAppService, PromptModalComponent, PartialProfile, ProfilesService, ProfileSettingsComponent, FullyDefined, ProxifiedConfig, NotificationsService, TranslateService, VaultService } from 'tabby-core'
import { LoginScriptsSettingsComponent } from 'tabby-terminal'
import { PasswordStorageService } from '../services/passwordStorage.service'
import { ForwardedPortConfig, SSHAlgorithmType, SSHProfile } from '../api'
import { supportedAlgorithms } from '../algorithms'
import { SSHProfilesService } from '../profiles'

/** @hidden */
@Component({
    templateUrl: './sshProfileSettings.component.pug',
})
export class SSHProfileSettingsComponent implements ProfileSettingsComponent<SSHProfile, SSHProfilesService> {
    Platform = Platform
    profile: ProxifiedConfig<FullyDefined<SSHProfile>>
    hasSavedPassword: boolean

    connectionMode: 'direct'|'proxyCommand'|'jumpHost'|'socksProxy'|'httpProxy' = 'direct'

    supportedAlgorithms = supportedAlgorithms
    algorithms: Record<string, Record<string, boolean>> = {}
    jumpHosts: PartialProfile<SSHProfile>[]
    keyLabels: Record<string, string> = {}
    missingKeys = new Set<string>()
    @ViewChild('loginScriptsSettings') loginScriptsSettings: LoginScriptsSettingsComponent|null

    constructor (
        public hostApp: HostAppService,
        private profilesService: ProfilesService,
        private passwordStorage: PasswordStorageService,
        private ngbModal: NgbModal,
        private fileProviders: FileProvidersService,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private vault: VaultService,
    ) { }

    async ngOnInit () {
        this.jumpHosts = (await this.profilesService.getProfiles({ includeBuiltin: false })).filter(x => x.type === 'ssh' && x !== this.profile)
        this.jumpHosts.sort(firstBy(x => this.getJumpHostLabel(x)))

        for (const k of Object.values(SSHAlgorithmType)) {
            this.algorithms[k] = {}
            for (const alg of this.profile.options.algorithms[k]) {
                this.algorithms[k][alg] = true
            }
        }

        if (this.profile.options.proxyCommand) {
            this.connectionMode = 'proxyCommand'
        } else if (this.profile.options.jumpHost) {
            this.connectionMode = 'jumpHost'
        } else if (this.profile.options.socksProxyHost) {
            this.connectionMode = 'socksProxy'
        } else if (this.profile.options.httpProxyHost) {
            this.connectionMode = 'httpProxy'
        }

        if (this.profile.options.user) {
            try {
                this.hasSavedPassword = !!await this.passwordStorage.loadPassword(this.profile)
            } catch (e) {
                console.error('Could not check for saved password', e)
            }
        }

        await this.migrateFileKeysToVault()
        await this.refreshKeyLabels()
    }

    getJumpHostLabel (p: PartialProfile<SSHProfile>) {
        return p.group ? `${this.profilesService.resolveProfileGroupName(p.group)} / ${p.name}` : p.name
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

    async addPrivateKey () {
        if (!this.vault.isEnabled()) {
            this.notifications.error(this.translate.instant('Enable the vault to store private keys encrypted inside Tabby'))
            return
        }
        const sshDir = path.join(os.homedir(), '.ssh')
        const defaultPath = fs.existsSync(sshDir) ? sshDir : os.homedir()
        const ref = await this.fileProviders.storeInVault(`private key for ${this.profile.name}`, {
            multiple: false,
            showHiddenFiles: true,
            defaultPath,
        }).catch(() => null)
        if (ref) {
            this.profile.options.privateKeys = [
                ...this.profile.options.privateKeys,
                ref,
            ]
            await this.refreshKeyLabels()
            this.notifications.info(this.translate.instant('Private key stored encrypted in the vault. You can delete the original file from disk.'))
        }
    }

    removePrivateKey (path: string) {
        this.profile.options.privateKeys = this.profile.options.privateKeys.filter(x => x !== path)
        this.missingKeys.delete(path)
        delete this.keyLabels[path]
    }

    isVaultKey (path: string): boolean {
        return this.fileProviders.isVaultKey(path)
    }

    isMissingKey (path: string): boolean {
        return this.missingKeys.has(path)
    }

    keyLabel (path: string): string {
        return this.keyLabels[path] || this.fileProviders.fileNameFromKey(path)
    }

    private async migrateFileKeysToVault (): Promise<void> {
        if (!this.vault.isEnabled()) {
            return
        }
        const keys = [...(this.profile.options.privateKeys ?? [])]
        let changed = false
        for (const key of keys) {
            if (this.fileProviders.isVaultKey(key)) {
                continue
            }
            try {
                const vaultRef = await this.fileProviders.importIntoVault(key, `private key for ${this.profile.name}`)
                this.profile.options.privateKeys = this.profile.options.privateKeys.map(item => item === key ? vaultRef : item)
                changed = true
            } catch {
                try {
                    await this.fileProviders.retrieveFile(key)
                } catch {
                    this.missingKeys.add(key)
                }
            }
        }
        if (changed) {
            this.notifications.info(this.translate.instant('Private key stored encrypted in the vault. You can delete the original file from disk.'))
        }
    }

    private async refreshKeyLabels (): Promise<void> {
        const labels: Record<string, string> = {}
        for (const key of this.profile.options.privateKeys ?? []) {
            labels[key] = await this.fileProviders.getStoredFileLabel(key)
        }
        this.keyLabels = labels
    }

    save () {
        for (const k of Object.values(SSHAlgorithmType)) {
            this.profile.options.algorithms[k] = Object.entries(this.algorithms[k])
                .filter(([_, v]) => !!v)
                .map(([key, _]) => key)
            if(k !== SSHAlgorithmType.COMPRESSION) { this.profile.options.algorithms[k].sort() }
        }

        if (this.connectionMode !== 'jumpHost') {
            this.profile.options.jumpHost = null
        }
        if (this.connectionMode !== 'proxyCommand') {
            this.profile.options.proxyCommand = null
        }
        if (this.connectionMode !== 'socksProxy') {
            this.profile.options.socksProxyHost = null
            this.profile.options.socksProxyPort = null
        }
        if (this.connectionMode !== 'httpProxy') {
            this.profile.options.httpProxyHost = null
            this.profile.options.httpProxyPort = null
        }

        this.loginScriptsSettings?.save()
    }

    onForwardAdded (fw: ForwardedPortConfig) {
        this.profile.options.forwardedPorts.push(fw)
    }

    onForwardRemoved (fw: ForwardedPortConfig) {
        this.profile.options.forwardedPorts = this.profile.options.forwardedPorts.filter(x => x !== fw)
    }

    getConnectionDropdownTitle () {
        return {
            direct: 'Direct',
            proxyCommand: 'Proxy command',
            jumpHost: 'Jump host',
            socksProxy: 'SOCKS proxy',
            httpProxy: 'HTTP proxy',
        }[this.connectionMode]
    }
}
