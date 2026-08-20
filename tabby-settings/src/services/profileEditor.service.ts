import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import deepClone from 'clone-deep'
import { ConfigService, PartialProfile, Profile, ProfilesService, SelectorService, TranslateService } from 'tabby-core'
import { EditProfileModalComponent } from '../components/editProfileModal.component'

@Injectable({ providedIn: 'root' })
export class ProfileEditorService {
    constructor (
        private profilesService: ProfilesService,
        private selector: SelectorService,
        private ngbModal: NgbModal,
        private translate: TranslateService,
        private config: ConfigService,
    ) { }

    async newProfile (base?: PartialProfile<Profile>, options?: { launch?: boolean }): Promise<PartialProfile<Profile>|null> {
        if (!base) {
            let profiles = await this.profilesService.getProfiles()
            profiles = profiles.filter(x => !this.isProfileBlacklisted(x))
            base = await this.selector.show(
                this.translate.instant('Select a base profile to use as a template'),
                profiles.map(p => ({
                    icon: p.icon ?? undefined,
                    description: this.profilesService.getDescription(p) ?? undefined,
                    name: p.group ? `${this.profilesService.resolveProfileGroupName(p.group)} / ${p.name}` : p.name,
                    group: p.isTemplate ? this.translate.instant('Template') : this.translate.instant('Duplicate an existing profile'),
                    result: p,
                    weight: p.isTemplate ? 0 : 1,
                })),
            ).catch(() => undefined)
            if (!base) {
                return null
            }
        }
        const baseProfile: PartialProfile<Profile> = deepClone(base)
        delete baseProfile.id
        if (base.isTemplate) {
            baseProfile.name = ''
        } else if (!base.isBuiltin) {
            baseProfile.name = this.translate.instant('{name} copy', base)
        }
        baseProfile.isBuiltin = false
        baseProfile.isTemplate = false
        const result = await this.showProfileEditModal(baseProfile)
        if (!result) {
            return null
        }
        if (!result.name) {
            const cfgProxy = this.profilesService.getConfigProxyForProfile(result)
            result.name = this.profilesService.providerForProfile(result)?.getSuggestedName(cfgProxy) ?? this.translate.instant('{name} copy', base)
        }
        await this.profilesService.newProfile(result)
        await this.config.save()
        if (options?.launch) {
            await this.profilesService.launchProfile(result)
        }
        return result
    }

    async showProfileEditModal (profile: PartialProfile<Profile>): Promise<PartialProfile<Profile>|null> {
        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )
        const provider = this.profilesService.providerForProfile(profile)
        if (!provider) {
            throw new Error('Cannot edit a profile without a provider')
        }
        modal.componentInstance.partialProfile = deepClone(profile)
        modal.componentInstance.profileProvider = provider

        const result = await modal.result.catch(() => null)
        if (!result) {
            return null
        }

        result.type = provider.id
        return result
    }

    isProfileBlacklisted (profile: PartialProfile<Profile>): boolean {
        return !!(profile.id && this.config.store.profileBlacklist.includes(profile.id))
    }
}
