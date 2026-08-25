import { Injectable } from '@angular/core'
import { NewTabParameters, PartialProfile, TranslateService, QuickConnectProfileProvider, VaultService } from 'tabby-core'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { RDPProfileSettingsComponent } from './components/rdpProfileSettings.component'
import { RDPTabComponent } from './components/rdpTab.component'
import { PasswordStorageService } from './services/passwordStorage.service'
import { RDPProfile } from './api'

@Injectable({ providedIn: 'root' })
export class RDPProfilesService extends QuickConnectProfileProvider<RDPProfile> {
    id = 'rdp'
    name = _('RDP')
    settingsComponent = RDPProfileSettingsComponent
    configDefaults = {
        options: {
            host: '',
            port: 3389,
            user: '',
            domain: '',
            password: null,
            nla: true,
            clipboard: true,
            adaptiveResolution: true,
            width: 1280,
            height: 720,
            warnOnClose: null,
        },
        clearServiceMessagesOnConnect: true,
    }

    constructor (
        private passwordStorage: PasswordStorageService,
        private translate: TranslateService,
        private vault: VaultService,
    ) {
        super()
    }

    async getBuiltinProfiles (): Promise<PartialProfile<RDPProfile>[]> {
        return [
            {
                id: 'rdp:template',
                type: 'rdp',
                name: this.translate.instant('RDP connection'),
                icon: 'fas fa-tv',
                options: {
                    host: '',
                    port: 3389,
                    user: '',
                },
                isBuiltin: true,
                isTemplate: true,
                weight: -1,
            },
        ]
    }

    async getNewTabParameters (profile: RDPProfile): Promise<NewTabParameters<RDPTabComponent>> {
        return {
            type: RDPTabComponent,
            inputs: { profile },
        }
    }

    getSuggestedName (profile: RDPProfile): string {
        const user = profile.options.user
        const host = profile.options.host
        const port = profile.options.port || 3389
        if (user && host) {
            return port === 3389 ? `${user}@${host}` : `${user}@${host}:${port}`
        }
        return host || this.translate.instant('RDP connection')
    }

    getDescription (profile: PartialProfile<RDPProfile>): string {
        return profile.options?.host ?? ''
    }

    async deleteProfile (profile: RDPProfile): Promise<void> {
        try {
            if (this.vault.isEnabled() && !this.vault.isOpen()) {
                return
            }
            await this.passwordStorage.deletePassword(profile)
        } catch (e) {
            console.warn('Could not delete stored password for profile', profile.name, e)
        }
    }

    quickConnect (query: string): PartialProfile<RDPProfile> {
        let q = query.trim()
        if (q.toLowerCase().startsWith('rdp://')) {
            q = q.slice(6)
        }

        let user: string | undefined = undefined
        let host = q
        let port = 3389
        if (host.includes('@')) {
            const parts = host.split(/@/g)
            host = parts[parts.length - 1]
            user = parts.slice(0, parts.length - 1).join('@')
        }
        if (host.includes('[')) {
            const portPart = host.split(']')[1]
            port = portPart ? parseInt(portPart.substring(1), 10) || 3389 : 3389
            host = host.split(']')[0].substring(1)
        } else if (host.includes(':')) {
            const [h, p] = host.split(/:/g)
            host = h
            port = parseInt(p, 10) || 3389
        }

        return {
            name: query,
            type: 'rdp',
            options: {
                host,
                user,
                port,
            },
        }
    }

    intoQuickConnectString (profile: RDPProfile): string | null {
        let s = profile.options.host
        if (profile.options.user) {
            s = `${profile.options.user}@${s}`
        }
        if (profile.options.port && profile.options.port !== 3389) {
            s = `${s}:${profile.options.port}`
        }
        return s
    }
}
