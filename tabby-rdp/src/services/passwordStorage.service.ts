import * as keytar from 'keytar'
import { Injectable } from '@angular/core'
import { VaultService } from 'tabby-core'
import { RDPProfile } from '../api'

export const VAULT_SECRET_TYPE_PASSWORD = 'rdp:password'

@Injectable({ providedIn: 'root' })
export class PasswordStorageService {
    constructor (private vault: VaultService) { }

    async savePassword (profile: RDPProfile, password: string, username?: string): Promise<void> {
        const account = username ?? profile.options.user
        if (this.vault.isEnabled()) {
            const key = this.getVaultKeyForConnection(profile, account)
            this.vault.addSecret({ type: VAULT_SECRET_TYPE_PASSWORD, key, value: password })
        } else {
            if (!account) {
                return
            }
            const key = this.getKeytarKeyForConnection(profile)
            return keytar.setPassword(key, account, password)
        }
    }

    async deletePassword (profile: RDPProfile, username?: string): Promise<void> {
        const account = username ?? profile.options.user
        if (this.vault.isEnabled()) {
            const key = this.getVaultKeyForConnection(profile, account)
            this.vault.removeSecret(VAULT_SECRET_TYPE_PASSWORD, key)
        } else {
            if (!account) {
                return
            }
            const key = this.getKeytarKeyForConnection(profile)
            await keytar.deletePassword(key, account)
        }
    }

    async loadPassword (profile: RDPProfile, username?: string): Promise<string|null> {
        const account = username ?? profile.options.user
        if (this.vault.isEnabled()) {
            const key = this.getVaultKeyForConnection(profile, account)
            return (await this.vault.getSecret(VAULT_SECRET_TYPE_PASSWORD, key))?.value ?? null
        } else {
            if (!account) {
                return null
            }
            const key = this.getKeytarKeyForConnection(profile)
            try {
                return await keytar.getPassword(key, account)
            } catch (e) {
                console.warn(`Failed to load stored password for ${account}@${profile.options.host}:${profile.options.port}`, e)
                return null
            }
        }
    }

    private getKeytarKeyForConnection (profile: RDPProfile): string {
        let key = `rdp@${profile.options.host}`
        if (profile.options.port) {
            key = `rdp@${profile.options.host}:${profile.options.port}`
        }
        return key
    }

    private getVaultKeyForConnection (profile: RDPProfile, username?: string) {
        return {
            user: username ?? profile.options.user,
            host: profile.options.host,
            port: profile.options.port,
        }
    }
}
