/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Injectable } from '@angular/core'
import { Command, CommandLocation, CommandProvider, TranslateService } from 'tabby-core'
import { ProfileEditorService } from './services/profileEditor.service'

/** @hidden */
@Injectable()
export class SettingsCommandProvider extends CommandProvider {
    constructor (
        private profileEditor: ProfileEditorService,
        private translate: TranslateService,
    ) {
        super()
    }

    async provide (): Promise<Command[]> {
        return [
            {
                id: 'settings:new-connection',
                locations: [CommandLocation.StartPage],
                label: this.translate.instant('New connection'),
                icon: require('../../tabby-core/src/icons/plus.svg'),
                run: async () => {
                    await this.profileEditor.newProfile(undefined, { launch: true })
                },
            },
        ]
    }
}
