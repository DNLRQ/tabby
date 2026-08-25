/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, HostBinding } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, VaultService, VaultSecret, Vault, PlatformService, ConfigService, VAULT_SECRET_TYPE_FILE, PromptModalComponent, VaultFileSecret, TranslateService, VaultBackupService, NotificationsService, VaultBackupConflictDecision } from 'tabby-core'
import { SetVaultPassphraseModalComponent } from './setVaultPassphraseModal.component'
import { ShowSecretModalComponent } from './showSecretModal.component'
import { VaultBackupExportModalComponent } from './vaultBackupExportModal.component'
import { VaultBackupPassphraseModalComponent } from './vaultBackupPassphraseModal.component'
import { VaultBackupConflictModalComponent } from './vaultBackupConflictModal.component'


/** @hidden */
@Component({
    selector: 'vault-settings-tab',
    templateUrl: './vaultSettingsTab.component.pug',
})
export class VaultSettingsTabComponent extends BaseComponent {
    vaultContents: Vault|null = null
    VAULT_SECRET_TYPE_FILE = VAULT_SECRET_TYPE_FILE

    @HostBinding('class.content-box') true

    constructor (
        public vault: VaultService,
        public config: ConfigService,
        private platform: PlatformService,
        private ngbModal: NgbModal,
        private translate: TranslateService,
        private vaultBackup: VaultBackupService,
        private notifications: NotificationsService,
    ) {
        super()
        if (vault.isOpen()) {
            this.loadVault()
        }
    }

    async loadVault (): Promise<void> {
        this.vaultContents = await this.vault.load()
    }

    async enableVault () {
        const modal = this.ngbModal.open(SetVaultPassphraseModalComponent)
        const newPassphrase = await modal.result.catch(() => null)
        if (newPassphrase) {
            await this.vault.setEnabled(true, newPassphrase)
            this.vaultContents = await this.vault.load(newPassphrase)
        }
    }

    async disableVault () {
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete vault contents?'),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response === 0) {
            await this.vault.setEnabled(false)
        }
    }

    async changePassphrase () {
        if (!this.vaultContents) {
            this.vaultContents = await this.vault.load()
        }
        if (!this.vaultContents) {
            return
        }
        const modal = this.ngbModal.open(SetVaultPassphraseModalComponent)
        const newPassphrase = await modal.result.catch(() => null)
        if (newPassphrase) {
            this.vault.save(this.vaultContents, newPassphrase)
        }
    }

    async createBackup (): Promise<void> {
        const picker = this.ngbModal.open(VaultBackupExportModalComponent, { size: 'lg' })
        const choice = await picker.result.catch(() => null) as { profileIds: string[] | null } | null
        if (!choice) {
            return
        }

        let passphrase = ''
        try {
            const payload = await this.vaultBackup.buildPayload(choice.profileIds)
            passphrase = await this.vaultBackup.generatePassphrase()
            await this.vaultBackup.exportPayload(payload, passphrase)
            const shown = this.ngbModal.open(VaultBackupPassphraseModalComponent, {
                backdrop: 'static',
                keyboard: false,
            })
            shown.componentInstance.passphrase = passphrase
            shown.componentInstance.profileCount = payload.profiles.length
            await shown.result.catch(() => null)
        } catch (e) {
            if (String(e?.message ?? e) === 'cancelled' || String(e?.message ?? e).includes('Vault unlock cancelled')) {
                return
            }
            this.notifications.error(this.translate.instant('Could not create the backup'), e?.message ?? String(e))
        } finally {
            passphrase = ''
        }
    }

    async restoreBackup (): Promise<void> {
        if (!this.vault.isEnabled()) {
            await this.enableVault()
            if (!this.vault.isEnabled()) {
                return
            }
        }

        const transfers = await this.platform.startUpload({ multiple: false })
        if (!transfers.length) {
            return
        }

        const prompt = this.ngbModal.open(PromptModalComponent)
        prompt.componentInstance.password = true
        prompt.componentInstance.prompt = this.translate.instant('Backup password')
        const result = await prompt.result.catch(() => null)
        let backupPassphrase = result?.value as string | undefined
        if (!backupPassphrase) {
            return
        }

        try {
            const bytes = await transfers[0].readAll()
            const imported = await this.vaultBackup.importFromFile(bytes, backupPassphrase, async conflict => {
                const modal = this.ngbModal.open(VaultBackupConflictModalComponent, { backdrop: 'static' })
                modal.componentInstance.incoming = conflict.incoming
                modal.componentInstance.existing = conflict.existing
                return await modal.result.catch(() => null) as VaultBackupConflictDecision | null
            })
            this.notifications.info(this.translate.instant(
                'Restored {profiles} connections ({replaced} replaced, {skipped} skipped) and {secrets} secrets',
                {
                    profiles: imported.profiles,
                    replaced: imported.replaced,
                    skipped: imported.skipped,
                    secrets: imported.secrets,
                },
            ))
            await this.loadVault()
        } catch (e) {
            if (String(e?.message ?? e) === 'cancelled') {
                return
            }
            this.notifications.error(this.translate.instant('Could not restore the backup'), e?.message ?? String(e))
        } finally {
            backupPassphrase = ''
        }
    }

    async toggleConfigEncrypted () {
        this.config.store.encrypted = !this.config.store.encrypted
        try {
            await this.config.save()
        } catch (e) {
            this.config.store.encrypted = !this.config.store.encrypted
            throw e
        }
    }

    getSecretLabel (secret: VaultSecret) {
        if (secret.type === 'ssh:password') {
            return this.translate.instant('SSH password for {user}@{host}:{port}', (secret as any).key)
        }
        if (secret.type === 'rdp:password') {
            return this.translate.instant('RDP password for {user}@{host}:{port}', (secret as any).key)
        }
        if (secret.type === 'ssh:key-passphrase') {
            return this.translate.instant('Passphrase for a private key with hash {hash}...', { hash: (secret as any).key.hash.substring(0, 8) })
        }
        if (secret.type === VAULT_SECRET_TYPE_FILE) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            return this.translate.instant('File: {description}', (secret as VaultFileSecret).key)
        }
        return this.translate.instant('Unknown secret of type {type} for {key}', { type: secret.type, key: JSON.stringify(secret.key) })
    }

    showSecret (secret: VaultSecret) {
        if (!this.vaultContents) {
            return
        }
        const modal = this.ngbModal.open(ShowSecretModalComponent)
        modal.componentInstance.title = this.getSecretLabel(secret)
        modal.componentInstance.secret = secret

    }

    removeSecret (secret: VaultSecret) {
        if (!this.vaultContents) {
            return
        }
        this.vaultContents.secrets = this.vaultContents.secrets.filter(x => x !== secret)
        this.vault.removeSecret(secret.type, secret.key)
    }

    async replaceFileContent (secret: VaultFileSecret) {
        const transfers = await this.platform.startUpload()
        if (!transfers.length) {
            return
        }
        await this.vault.updateSecret(secret, {
            ...secret,
            value: Buffer.from(await transfers[0].readAll()).toString('base64'),
        })
        this.loadVault()
    }

    async renameFile (secret: VaultFileSecret) {
        const modal = this.ngbModal.open(PromptModalComponent)
        modal.componentInstance.prompt = this.translate.instant('New name')
        modal.componentInstance.value = secret.key.description

        const description = (await modal.result.catch(() => null))?.value
        if (!description) {
            return
        }

        await this.vault.updateSecret(secret, {
            ...secret,
            key: {
                ...secret.key,
                description,
            },
        })

        this.loadVault()
    }

    async exportFile (secret: VaultFileSecret) {
        this.vault.forgetPassphrase()

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        secret = (await this.vault.getSecret(secret.type, secret.key)) as VaultFileSecret

        const content = Buffer.from(secret.value, 'base64')
        const download = await this.platform.startDownload(secret.key.description, 0o600, content.length)

        if (download) {
            await download.write(content)
            download.close()
        }
    }

    castAny = (x: any) => x
}
