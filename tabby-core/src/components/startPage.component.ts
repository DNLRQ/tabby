import { Component } from '@angular/core'
import { DomSanitizer } from '@angular/platform-browser'
import { HomeBaseService } from '../services/homeBase.service'
import { CommandService } from '../services/commands.service'
import { Command, CommandLocation } from '../api/commands'
import { ConfigService } from '../services/config.service'
import { ProfilesService } from '../services/profiles.service'
import { PartialProfile, Profile } from '../api/profileProvider'
import { BaseComponent } from './base.component'
import { TranslateService } from '@ngx-translate/core'

/** @hidden */
@Component({
    selector: 'start-page',
    templateUrl: './startPage.component.pug',
    styleUrls: ['./startPage.component.scss'],
})
export class StartPageComponent extends BaseComponent {
    version: string
    commands: Command[] = []
    recentProfiles: PartialProfile<Profile>[] = []
    newConnectionCommand: Command | null = null

    constructor (
        private domSanitizer: DomSanitizer,
        public homeBase: HomeBaseService,
        public config: ConfigService,
        private profilesService: ProfilesService,
        private commandService: CommandService,
        private translate: TranslateService,
    ) {
        super()
        this.refreshHome()
        this.subscribeUntilDestroyed(this.config.changed$, () => this.refreshHome())
    }

    private refreshHome (): void {
        this.recentProfiles = this.profilesService.getQuickAccessProfiles()
        this.commandService.getCommands({}).then(c => {
            this.newConnectionCommand = c.find(x => x.id === 'settings:new-connection') ?? null
            this.commands = c.filter(x => {
                if (!x.locations?.includes(CommandLocation.StartPage)) {
                    return false
                }
                if (x.id === 'settings:new-connection') {
                    return false
                }
                if (this.config.store.showQuickAccess && x.id?.startsWith('core:recent-profile-')) {
                    return false
                }
                return true
            })
        })
    }

    sanitizeIcon (icon?: string): any {
        return this.domSanitizer.bypassSecurityTrustHtml(icon ?? '')
    }

    getDescription (profile: PartialProfile<Profile>): string|null {
        return this.profilesService.getDescription(profile)
    }

    getTypeLabel (profile: PartialProfile<Profile>): string {
        const name = this.profilesService.providerForProfile(profile)?.name
        return name ? this.translate.instant(name) : profile.type
    }

    async createNewConnection (): Promise<void> {
        await this.newConnectionCommand?.run()
    }

    async launchProfile (profile: PartialProfile<Profile>): Promise<void> {
        const resolved = (await this.profilesService.getProfiles()).find(x => x.id === profile.id) ?? profile
        await this.profilesService.launchProfile(resolved)
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    buttonsTrackBy (_, btn: Command): any {
        return btn.label + btn.icon
    }

    profilesTrackBy (_, profile: PartialProfile<Profile>): any {
        return profile.id ?? profile.name
    }
}
