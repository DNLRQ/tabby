/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Injectable } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'

import { HostAppService, Platform } from './api/hostApp'
import { ProfilesService } from './services/profiles.service'
import { AppService } from './services/app.service'
import { CommandProvider, Command, CommandLocation } from './api/commands'

/** @hidden */
@Injectable({ providedIn: 'root' })
export class CoreCommandProvider extends CommandProvider {
    constructor (
        private hostApp: HostAppService,
        private profilesService: ProfilesService,
        private app: AppService,
        private translate: TranslateService,
    ) {
        super()
    }

    async activate () {
        const profile = await this.profilesService.showProfileSelector().catch(() => null)
        if (profile) {
            this.profilesService.launchProfile(profile)
        }
    }

    async provide (): Promise<Command[]> {
        return [
            {
                id: 'core:home',
                locations: [CommandLocation.LeftToolbar],
                label: this.translate.instant('Home'),
                icon: require('./icons/home.svg'),
                weight: 1,
                run: async () => {
                    this.app.selectTab(null)
                },
            },
            {
                id: 'core:profile-selector',
                locations: [CommandLocation.LeftToolbar, CommandLocation.StartPage],
                label: this.translate.instant('Profiles & connections'),
                icon: this.hostApp.platform === Platform.Web
                    ? require('./icons/plus.svg')
                    : require('./icons/profiles.svg'),
                weight: 2,
                run: async () => this.activate(),
            },
        ]
    }
}
