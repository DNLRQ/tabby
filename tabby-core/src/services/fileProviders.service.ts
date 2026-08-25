import { Inject, Injectable } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { FileProvider, NotificationsService, SelectorService, FileUploadOptions } from '../api'
import { VaultFileSecret, VaultService, VaultFileProvider, VAULT_SECRET_TYPE_FILE } from './vault.service'

@Injectable({ providedIn: 'root' })
export class FileProvidersService {
    /** @hidden */
    private constructor (
        private selector: SelectorService,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private vault: VaultService,
        @Inject(FileProvider) private fileProviders: FileProvider[],
    ) { }

    async selectAndStoreFile (description: string): Promise<string> {
        return this.selectProvider().then(p => {
            return p.selectAndStoreFile(description)
        })
    }

    async storeInVault (description: string, uploadOptions?: FileUploadOptions): Promise<string> {
        const vaultProvider = await this.requireVaultProvider()
        if (vaultProvider instanceof VaultFileProvider) {
            return vaultProvider.selectAndStoreFile(description, uploadOptions)
        }
        return vaultProvider.selectAndStoreFile(description)
    }

    async importIntoVault (key: string, description: string): Promise<string> {
        if (key.startsWith('vault://')) {
            return key
        }
        const vaultProvider = await this.requireVaultProvider()
        const contents = await this.retrieveFile(key)
        const fileName = this.fileNameFromKey(key)
        return vaultProvider.storeFile(description, fileName, contents)
    }

    isVaultKey (key: string): boolean {
        return key.startsWith('vault://')
    }

    fileNameFromKey (key: string): string {
        const stripped = key.replace(/^file:\/\//, '')
        const parts = stripped.split(/[/\\]/)
        return parts[parts.length - 1] || 'private-key'
    }

    async getStoredFileLabel (key: string): Promise<string> {
        if (this.isVaultKey(key)) {
            try {
                const secret = await this.vault.getSecret(VAULT_SECRET_TYPE_FILE, { id: key.substring('vault://'.length) }) as VaultFileSecret | null
                if (secret?.key?.description) {
                    return secret.key.description
                }
            } catch {
                // Vault locked or missing
            }
            return this.translate.instant('Encrypted in vault')
        }
        return this.fileNameFromKey(key)
    }

    async retrieveFile (key: string): Promise<Buffer> {
        for (const p of this.fileProviders) {
            try {
                return await p.retrieveFile(key)
            } catch {
                continue
            }
        }
        throw new Error('Not found')
    }

    async selectProvider (): Promise<FileProvider> {
        const providers: FileProvider[] = []
        await Promise.all(this.fileProviders.map(async p => {
            if (await p.isAvailable()) {
                providers.push(p)
            }
        }))
        if (!providers.length) {
            this.notifications.error(this.translate.instant('Vault master passphrase needs to be set to allow storing secrets'))
            throw new Error('No available file providers')
        }
        if (providers.length === 1) {
            return providers[0]
        }
        return this.selector.show(
            this.translate.instant('Select file storage'),
            providers.map(p => ({
                name: p.name,
                result: p,
            })),
        )
    }

    private async requireVaultProvider (): Promise<FileProvider> {
        const vaultProvider = this.fileProviders.find(provider => provider.name === 'Vault')
        if (!vaultProvider || !(await vaultProvider.isAvailable())) {
            this.notifications.error(this.translate.instant('Enable the vault to store private keys encrypted inside Tabby'))
            throw new Error('Vault is not configured')
        }
        return vaultProvider
    }
}
