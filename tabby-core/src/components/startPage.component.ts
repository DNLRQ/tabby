import { Component, ElementRef, HostListener } from '@angular/core'
import { DomSanitizer } from '@angular/platform-browser'
import { HomeBaseService } from '../services/homeBase.service'
import { CommandService } from '../services/commands.service'
import { Command, CommandLocation } from '../api/commands'
import { ConfigService } from '../services/config.service'
import { ProfilesService } from '../services/profiles.service'
import { AppService } from '../services/app.service'
import { PartialProfile, Profile } from '../api/profileProvider'
import { BaseComponent } from './base.component'
import { SplitTabComponent } from './splitTab.component'
import { TranslateService } from '@ngx-translate/core'

interface HomeConnectionGroup {
    id: string
    name: string
    icon?: string
    color?: string
    profiles: PartialProfile<Profile>[]
}

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
    connectionGroups: HomeConnectionGroup[] = []
    newConnectionCommand: Command | null = null
    private openProfileIds = new Set<string>()

    constructor (
        private element: ElementRef<HTMLElement>,
        private domSanitizer: DomSanitizer,
        public homeBase: HomeBaseService,
        public config: ConfigService,
        private profilesService: ProfilesService,
        private commandService: CommandService,
        private app: AppService,
        private translate: TranslateService,
    ) {
        super()
        this.refreshHome()
        this.subscribeUntilDestroyed(this.config.changed$, () => this.refreshHome())
        this.subscribeUntilDestroyed(this.profilesService.quickAccessChanged$, () => this.refreshHome())
        this.subscribeUntilDestroyed(this.translate.onLangChange, () => this.refreshHome())
        this.subscribeUntilDestroyed(this.app.tabsChanged$, () => this.refreshOpenProfiles())
    }

    private refreshHome (): void {
        this.recentProfiles = this.profilesService.getQuickAccessProfiles()
        this.refreshOpenProfiles()
        void this.refreshConnectionGroups()
        this.commandService.getCommands({}).then(c => {
            this.newConnectionCommand = c.find(x => x.id === 'settings:new-connection') ?? null
            this.commands = c.filter(x => {
                if (!x.locations?.includes(CommandLocation.StartPage)) {
                    return false
                }
                if (x.id === 'settings:new-connection') {
                    return false
                }
                if (x.id?.startsWith('core:recent-profile-')) {
                    return false
                }
                return true
            })
        })
    }

    private async refreshConnectionGroups (): Promise<void> {
        if (!this.config.store.showGroupedConnections) {
            this.connectionGroups = []
            return
        }
        const groups = await this.profilesService.getProfileGroups({ includeNonUserGroup: true, includeProfiles: true })
        const blacklist = new Set(this.config.store.profileBlacklist ?? [])
        const result: HomeConnectionGroup[] = []
        for (const group of groups) {
            if (group.id === 'built-in') {
                continue
            }
            const profiles = (group.profiles ?? []).filter(profile =>
                !profile.isBuiltin
                && !profile.isTemplate
                && !!profile.id
                && !blacklist.has(profile.id),
            ).sort((a, b) => a.name.localeCompare(b.name))
            if (!profiles.length) {
                continue
            }
            const path = group.id === 'ungrouped'
                ? [this.translate.instant('Ungrouped')]
                : this.profilesService.resolveProfileGroupPath(group.id)
            result.push({
                id: group.id ?? group.name,
                name: path.length ? path.join(' / ') : group.name,
                icon: group.icon,
                color: group.color,
                profiles,
            })
        }
        result.sort((a, b) => {
            if (a.id === 'ungrouped') {
                return 1
            }
            if (b.id === 'ungrouped') {
                return -1
            }
            return a.name.localeCompare(b.name)
        })
        this.connectionGroups = result
    }

    private refreshOpenProfiles (): void {
        const ids = new Set<string>()
        for (const tab of this.app.tabs) {
            const leaves = tab instanceof SplitTabComponent ? tab.getAllTabs() : [tab]
            for (const leaf of leaves) {
                const id = (leaf as { profile?: PartialProfile<Profile> }).profile?.id
                if (id) {
                    ids.add(id)
                }
            }
        }
        this.openProfileIds = ids
    }

    sanitizeIcon (icon?: string): any {
        return this.domSanitizer.bypassSecurityTrustHtml(icon ?? '')
    }

    getDescription (profile: PartialProfile<Profile>): string|null {
        return this.profilesService.getDescription(profile)
    }

    getTypeLabel (profile: PartialProfile<Profile>): string {
        const id = this.profilesService.providerForProfile(profile)?.id ?? profile.type
        const labels: Record<string, string> = {
            ssh: 'SSH',
            serial: 'Serial',
            telnet: 'Telnet',
            rdp: 'RDP',
            local: 'Local terminal',
            'split-layout': 'Saved layout',
        }
        return this.translate.instant(labels[id] ?? this.profilesService.providerForProfile(profile)?.name ?? profile.type)
    }

    getTypeColorClass (profile: PartialProfile<Profile>): string {
        return {
            ssh: 'secondary',
            serial: 'success',
            telnet: 'info',
            rdp: 'primary',
            'split-layout': 'primary',
        }[this.profilesService.providerForProfile(profile)?.id ?? profile.type] ?? 'warning'
    }

    getTypeBadgeClass (profile: PartialProfile<Profile>): string {
        return `badge home-card-type text-bg-${this.getTypeColorClass(profile)}`
    }

    getHostLabel (profile: PartialProfile<Profile>): string {
        const host = profile.options?.host
        const user = profile.options?.user
        if (host) {
            const port = profile.options?.port
            const address = port && ![22, 23, 3389].includes(Number(port)) ? `${host}:${port}` : host
            return user ? `${user}@${address}` : address
        }
        return this.getDescription(profile) ?? ''
    }

    getProfileIcon (profile: PartialProfile<Profile>): string {
        if (profile.icon) {
            return profile.icon
        }
        return {
            ssh: 'fas fa-terminal',
            serial: 'fas fa-tty',
            telnet: 'fas fa-network-wired',
            rdp: 'fas fa-desktop',
            local: 'far fa-window-maximize',
        }[this.profilesService.providerForProfile(profile)?.id ?? profile.type] ?? 'fas fa-plug'
    }

    isProfileOpen (profile: PartialProfile<Profile>): boolean {
        return !!profile.id && this.openProfileIds.has(profile.id)
    }

    getLastUsedLabel (profile: PartialProfile<Profile>): string {
        const ts = this.profilesService.getProfileLastUsed(profile)
        if (!ts) {
            return this.translate.instant('Never')
        }
        const diff = Date.now() - ts
        const minute = 60 * 1000
        const hour = 60 * minute
        const day = 24 * hour
        if (diff < minute) {
            return this.translate.instant('Just now')
        }
        if (diff < hour) {
            return this.translate.instant('{count} min ago', { count: Math.floor(diff / minute) })
        }
        if (diff < day) {
            return this.translate.instant('{count} h ago', { count: Math.floor(diff / hour) })
        }
        if (diff < 2 * day) {
            return this.translate.instant('Yesterday')
        }
        return this.translate.instant('{count} d ago', { count: Math.floor(diff / day) })
    }

    @HostListener('wheel', ['$event'])
    onHostWheel (event: WheelEvent): void {
        const target = event.target as HTMLElement | null
        const scroller = target?.closest('.connection-group-scroller') as HTMLElement | null
        const card = target?.closest('.home-card') as HTMLElement | null
        if (!scroller && !card) {
            return
        }
        const mainlyHorizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
        if (scroller && mainlyHorizontal && scroller.scrollWidth > scroller.clientWidth + 1) {
            scroller.scrollLeft += event.shiftKey ? event.deltaY + event.deltaX : event.deltaX
            event.preventDefault()
            return
        }
        this.element.nativeElement.scrollTop += event.deltaY
        event.preventDefault()
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

    groupsTrackBy (_, group: HomeConnectionGroup): string {
        return group.id
    }
}
