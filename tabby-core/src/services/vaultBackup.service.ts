import * as crypto from 'crypto'
import { promisify } from 'util'
import { Injectable, NgZone } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { v4 as uuidv4 } from 'uuid'
import slugify from 'slugify'
import deepClone from 'clone-deep'
import { wrapPromise } from '../utils'
import { PartialProfile, PartialProfileGroup, Profile, ProfileGroup } from '../api/profileProvider'
import { PlatformService } from '../api/platform'
import { ConfigService } from './config.service'
import { ProfilesService } from './profiles.service'
import {
    decryptWithPassphrase,
    encryptWithPassphrase,
    StoredVault,
    VaultSecret,
    VaultService,
    VAULT_SECRET_TYPE_FILE,
} from './vault.service'

export const VAULT_BACKUP_KIND = 'tabby-vault-backup'
export const VAULT_BACKUP_VERSION = 1

export type VaultBackupConflictChoice = 'duplicate' | 'replace' | 'skip'

export interface VaultBackupConflict {
    incoming: PartialProfile<Profile>
    existing: PartialProfile<Profile>
}

export interface VaultBackupConflictDecision {
    choice: VaultBackupConflictChoice
    applyToAll?: boolean
}

export type VaultBackupConflictResolver = (
    conflict: VaultBackupConflict,
) => Promise<VaultBackupConflictDecision | null>

const PASSWORD_LENGTH = 32
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const PASSWORD_LOWER = 'abcdefghijkmnopqrstuvwxyz'
const PASSWORD_DIGIT = '23456789'
const PASSWORD_SYMBOL = '!@#$%^&*-_=+'
const PASSWORD_ALL = PASSWORD_UPPER + PASSWORD_LOWER + PASSWORD_DIGIT + PASSWORD_SYMBOL

export interface VaultBackupPayload {
    profiles: PartialProfile<Profile>[]
    groups: PartialProfileGroup<ProfileGroup>[]
    secrets: VaultSecret[]
}

export interface VaultBackupFile extends StoredVault {
    kind: typeof VAULT_BACKUP_KIND
    createdAt: string
    profileCount: number
}

function pickChar (alphabet: string, byte: number): string {
    return alphabet[byte % alphabet.length]
}

function secretMatchesProfile (secret: VaultSecret, profile: PartialProfile<Profile>): boolean {
    const options = profile.options ?? {}
    const key = (secret.key ?? {}) as Record<string, any>

    if (secret.type === 'ssh:password' || secret.type === 'rdp:password') {
        if (!options.host || key.host !== options.host) {
            return false
        }
        if (key.user && options.user && key.user !== options.user) {
            return false
        }
        const secretPort = key.port == null ? null : Number(key.port)
        const profilePort = options.port == null ? null : Number(options.port)
        if (secretPort != null && profilePort != null && secretPort !== profilePort) {
            return false
        }
        return true
    }

    if (secret.type === 'ssh:key-passphrase') {
        const keys: string[] = options.privateKeys ?? []
        const hash = String(key.hash ?? '')
        return !!hash && keys.some(path => typeof path === 'string' && path.includes(hash))
    }

    if (secret.type === VAULT_SECRET_TYPE_FILE) {
        const id = String(key.id ?? '')
        return !!id && JSON.stringify(profile).includes(`vault://${id}`)
    }

    return false
}

function profileFingerprint (profile: PartialProfile<Profile>): string {
    const options = profile.options ?? {}
    return [
        profile.type ?? '',
        profile.name ?? '',
        options.host ?? '',
        options.user ?? '',
        options.port ?? '',
    ].join('\0')
}

@Injectable({ providedIn: 'root' })
export class VaultBackupService {
    constructor (
        private vault: VaultService,
        private profiles: ProfilesService,
        private config: ConfigService,
        private platform: PlatformService,
        private translate: TranslateService,
        private zone: NgZone,
    ) { }

    async generatePassphrase (): Promise<string> {
        const bytes = await wrapPromise(this.zone, promisify(crypto.randomBytes)(PASSWORD_LENGTH + 4))
        const chars = [
            pickChar(PASSWORD_UPPER, bytes[0]),
            pickChar(PASSWORD_LOWER, bytes[1]),
            pickChar(PASSWORD_DIGIT, bytes[2]),
            pickChar(PASSWORD_SYMBOL, bytes[3]),
        ]
        for (let i = 0; i < PASSWORD_LENGTH - 4; i++) {
            chars.push(pickChar(PASSWORD_ALL, bytes[i + 4]))
        }
        for (let i = chars.length - 1; i > 0; i--) {
            const j = bytes[i % bytes.length] % (i + 1)
            const tmp = chars[i]
            chars[i] = chars[j]
            chars[j] = tmp
        }
        return chars.join('')
    }

    async buildPayload (profileIds: string[] | null): Promise<VaultBackupPayload> {
        const vault = await this.vault.load()
        if (!vault) {
            throw new Error(this.translate.instant('Vault is locked'))
        }

        const allProfiles = (await this.profiles.getProfiles({ includeBuiltin: false, clone: true }))
            .filter(profile => !profile.isBuiltin && !profile.isTemplate)
        const selected = profileIds
            ? this.expandRelatedProfiles(allProfiles, profileIds)
            : allProfiles

        const secrets = (vault.secrets ?? []).filter(secret =>
            !profileIds || selected.some(profile => secretMatchesProfile(secret, profile)),
        )

        const groupIds = new Set(selected.map(profile => profile.group).filter(Boolean) as string[])
        const allGroups = this.profiles.getSyncProfileGroups()
        let grew = true
        while (grew) {
            grew = false
            for (const group of allGroups) {
                if (group.id && groupIds.has(group.id) && group.parentGroupId && !groupIds.has(group.parentGroupId)) {
                    groupIds.add(group.parentGroupId)
                    grew = true
                }
            }
        }

        const groups = allGroups
            .filter(group => groupIds.has(group.id))
            .map(group => {
                const copy = deepClone(group)
                delete copy.profiles
                delete copy.editable
                return copy
            })

        return {
            profiles: selected,
            groups,
            secrets: deepClone(secrets),
        }
    }

    async exportPayload (payload: VaultBackupPayload, passphrase: string): Promise<void> {
        const encrypted = await wrapPromise(this.zone, encryptWithPassphrase(JSON.stringify(payload), passphrase))
        const file: VaultBackupFile = {
            kind: VAULT_BACKUP_KIND,
            createdAt: new Date().toISOString(),
            profileCount: payload.profiles.length,
            ...encrypted,
        }
        const bytes = Buffer.from(JSON.stringify(file, null, 2), 'utf-8')
        const stamp = new Date().toISOString().slice(0, 10)
        const download = await this.platform.startDownload(`tabby-vault-backup-${stamp}.tabbyvault`, 0o600, bytes.length)
        if (!download) {
            throw new Error('cancelled')
        }
        await download.write(bytes)
        download.close()
    }

    async importFromFile (
        fileBytes: Uint8Array,
        backupPassphrase: string,
        resolveConflict?: VaultBackupConflictResolver,
    ): Promise<{ profiles: number, secrets: number, replaced: number, skipped: number }> {
        const payload = await this.decryptBackup(fileBytes, backupPassphrase)
        return this.importPayload(payload, resolveConflict)
    }

    async decryptBackup (fileBytes: Uint8Array, backupPassphrase: string): Promise<VaultBackupPayload> {
        let parsed: VaultBackupFile
        try {
            parsed = JSON.parse(Buffer.from(fileBytes).toString('utf-8'))
        } catch {
            throw new Error(this.translate.instant('The backup file is not valid'))
        }
        if (parsed?.kind !== VAULT_BACKUP_KIND || parsed.version !== VAULT_BACKUP_VERSION) {
            throw new Error(this.translate.instant('The backup file is not valid'))
        }

        try {
            return JSON.parse(await wrapPromise(this.zone, decryptWithPassphrase(parsed, backupPassphrase)))
        } catch {
            throw new Error(this.translate.instant('Incorrect backup password'))
        }
    }

    async importPayload (
        payload: VaultBackupPayload,
        resolveConflict?: VaultBackupConflictResolver,
    ): Promise<{ profiles: number, secrets: number, replaced: number, skipped: number }> {
        if (!this.vault.isEnabled()) {
            throw new Error(this.translate.instant('Enable the vault before restoring a backup'))
        }

        const vault = await this.vault.load()
        if (!vault) {
            throw new Error(this.translate.instant('Vault is locked'))
        }

        const existingProfiles = (this.config.store.profiles ?? []) as PartialProfile<Profile>[]
        const plans: { profile: PartialProfile<Profile>, choice: VaultBackupConflictChoice, existing?: PartialProfile<Profile> }[] = []
        let applyAll: VaultBackupConflictChoice | null = null

        for (const profile of payload.profiles ?? []) {
            if (!profile?.id || !profile.type || profile.isBuiltin) {
                continue
            }
            const existing = this.findExistingProfile(profile, existingProfiles)
            let choice: VaultBackupConflictChoice = 'duplicate'
            if (existing) {
                if (applyAll) {
                    choice = applyAll
                } else if (resolveConflict) {
                    const decision = await resolveConflict({ incoming: profile, existing })
                    if (!decision) {
                        throw new Error('cancelled')
                    }
                    choice = decision.choice
                    if (decision.applyToAll) {
                        applyAll = choice
                    }
                } else {
                    choice = 'skip'
                }
            }
            plans.push({ profile, choice, existing })
        }

        const idMap = new Map<string, string>()
        const replacedIds = new Set<string>()
        const touchedIds = new Set<string>()
        const skippedSecretFingerprints = new Set<string>()
        let importedProfiles = 0
        let replaced = 0
        let skipped = 0

        const existingGroupIds = new Set((this.config.store.groups ?? []).map(group => group.id))
        for (const group of payload.groups ?? []) {
            if (!group?.id || existingGroupIds.has(group.id)) {
                continue
            }
            const copy = deepClone(group)
            delete copy.profiles
            delete copy.editable
            this.config.store.groups.push(copy)
            existingGroupIds.add(copy.id)
        }

        for (const plan of plans) {
            const profile = plan.profile
            const existing = plan.existing
            const existingId = existing?.id

            if (existing && existingId && plan.choice === 'skip') {
                idMap.set(profile.id!, existingId)
                skippedSecretFingerprints.add(profileFingerprint(profile))
                skipped++
                continue
            }

            const copy = deepClone(profile)
            copy.isBuiltin = false
            copy.isTemplate = false
            if (copy.group && !existingGroupIds.has(copy.group)) {
                delete copy.group
            }

            if (existing && existingId && plan.choice === 'replace') {
                copy.id = existingId
                const current = existingProfiles.find(item => item.id === existingId)
                if (current) {
                    for (const key of Object.keys(current)) {
                        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                        delete current[key]
                    }
                    Object.assign(current, copy)
                }
                idMap.set(profile.id!, existingId)
                replacedIds.add(existingId)
                touchedIds.add(existingId)
                replaced++
                importedProfiles++
                continue
            }

            const newId = existing
                ? `${copy.type}:custom:${slugify(copy.name ?? 'profile')}:${uuidv4()}`
                : profile.id!
            copy.id = newId
            if (existing) {
                copy.name = this.uniqueCopyName(copy.name, existingProfiles)
            }
            this.config.store.profiles.push(copy)
            existingProfiles.push(copy)
            idMap.set(profile.id!, newId)
            touchedIds.add(newId)
            importedProfiles++
        }

        for (const profile of this.config.store.profiles ?? []) {
            if (!profile.id || !touchedIds.has(profile.id)) {
                continue
            }
            const jumpHost = profile.options?.jumpHost as string | undefined
            if (!jumpHost) {
                continue
            }
            const mappedJumpHost = idMap.get(jumpHost)
            if (mappedJumpHost && mappedJumpHost !== jumpHost) {
                profile.options.jumpHost = mappedJumpHost
            }
        }

        let importedSecrets = 0
        for (const secret of payload.secrets ?? []) {
            const relatedSkipped = skippedSecretFingerprints.size > 0
                && (payload.profiles ?? []).some(profile =>
                    skippedSecretFingerprints.has(profileFingerprint(profile))
                    && secretMatchesProfile(secret, profile),
                )
            const existingSecret = vault.secrets.find(item =>
                item.type === secret.type && this.secretKeysMatch(item.key as any, secret.key as any),
            )
            if (existingSecret) {
                const shouldReplace = (payload.profiles ?? []).some(profile =>
                    profile.id && replacedIds.has(idMap.get(profile.id) ?? '') && secretMatchesProfile(secret, profile),
                )
                if (shouldReplace) {
                    existingSecret.value = secret.value
                    importedSecrets++
                }
                continue
            }
            const matchesKeptProfile = (payload.profiles ?? []).some(profile =>
                !skippedSecretFingerprints.has(profileFingerprint(profile))
                && secretMatchesProfile(secret, profile),
            )
            if (relatedSkipped && !matchesKeptProfile) {
                continue
            }
            vault.secrets.push(deepClone(secret))
            importedSecrets++
        }

        await this.vault.save(vault)
        await this.config.save()
        this.profiles.quickAccessChanged$.next()
        return { profiles: importedProfiles, secrets: importedSecrets, replaced, skipped }
    }

    private findExistingProfile (
        incoming: PartialProfile<Profile>,
        existingProfiles: PartialProfile<Profile>[],
    ): PartialProfile<Profile> | undefined {
        if (incoming.id) {
            const byId = existingProfiles.find(profile => profile.id === incoming.id)
            if (byId) {
                return byId
            }
        }
        const incomingPrint = profileFingerprint(incoming)
        return existingProfiles.find(profile => profileFingerprint(profile) === incomingPrint)
    }

    private uniqueCopyName (name: string, existingProfiles: PartialProfile<Profile>[]): string {
        const base = this.translate.instant('{name} (copy)', { name })
        if (!existingProfiles.some(profile => profile.name === base)) {
            return base
        }
        let index = 2
        while (existingProfiles.some(profile => profile.name === `${base} ${index}`)) {
            index++
        }
        return `${base} ${index}`
    }

    private expandRelatedProfiles (
        allProfiles: PartialProfile<Profile>[],
        profileIds: string[],
    ): PartialProfile<Profile>[] {
        const byId = new Map(
            allProfiles
                .filter((profile): profile is PartialProfile<Profile> & { id: string } => !!profile.id)
                .map(profile => [profile.id, profile]),
        )
        const selected = new Map<string, PartialProfile<Profile>>()
        const queue = [...profileIds]

        while (queue.length) {
            const id = queue.pop()!
            if (selected.has(id)) {
                continue
            }
            const profile = byId.get(id)
            if (!profile) {
                continue
            }
            selected.set(id, profile)
            const jumpHost = profile.options?.jumpHost
            if (jumpHost && !selected.has(jumpHost)) {
                queue.push(jumpHost)
            }
        }

        return [...selected.values()]
    }

    private secretKeysMatch (a: Record<string, any>, b: Record<string, any>): boolean {
        const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
        return [...keys].every(key => a?.[key] === b?.[key])
    }
}
