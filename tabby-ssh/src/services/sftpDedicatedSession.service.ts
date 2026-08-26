import { Injectable, Injector } from '@angular/core'
import { ProfilesService } from 'tabby-core'
import * as russh from 'russh'
import { SSHAlgorithmType, SSHProfile } from '../api'
import { defaultAlgorithms } from '../algorithms'
import { SSHSession } from '../session/ssh'

@Injectable({ providedIn: 'root' })
export class SFTPDedicatedSessionService {
    private sessions = new WeakMap<SSHSession, Promise<SSHSession>>()

    constructor (
        private injector: Injector,
        private profiles: ProfilesService,
    ) { }

    async open (shellSession: SSHSession): Promise<SSHSession> {
        const cached = this.sessions.get(shellSession)
        if (cached) {
            const session = await cached
            if (session.open) {
                return session
            }
        }

        const pending = this.create(shellSession)
        this.sessions.set(shellSession, pending)
        try {
            return await pending
        } catch (error) {
            this.sessions.delete(shellSession)
            throw error
        }
    }

    private async create (shellSession: SSHSession): Promise<SSHSession> {
        const session = await this.openSession(this.profileForSftp(shellSession.profile), shellSession)
        session.ref()
        shellSession.willDestroy$.subscribe(() => {
            if (session.open) {
                session.unref()
            }
        })
        session.willDestroy$.subscribe(() => {
            this.sessions.delete(shellSession)
        })
        return session
    }

    private async openSession (profile: SSHProfile, parent?: SSHSession): Promise<SSHSession> {
        const session = new SSHSession(this.injector, profile)
        if (parent) {
            session.savedPassword = parent.savedPassword
            session.serviceMessage$.subscribe(msg => parent.emitServiceMessage(msg))
            session.keyboardInteractivePrompt$.subscribe(prompt => parent.emitKeyboardInteractivePrompt(prompt))
        }

        try {
            if (profile.options.jumpHost) {
                const jumpConnection = (await this.profiles.getProfiles()).find(item => item.id === profile.options.jumpHost)
                if (!jumpConnection) {
                    throw new Error(`${profile.options.host}: jump host "${profile.options.jumpHost}" not found in your config`)
                }
                const jumpProfile = this.profileForSftp(
                    this.profiles.getConfigProxyForProfile<SSHProfile>(jumpConnection),
                )
                const jumpSession = await this.openSession(jumpProfile, parent)
                jumpSession.ref()
                session.willDestroy$.subscribe(() => jumpSession.unref())
                jumpSession.willDestroy$.subscribe(() => {
                    if (session.open) {
                        session.destroy()
                    }
                })
                if (!(jumpSession.ssh instanceof russh.AuthenticatedSSHClient)) {
                    throw new Error('Jump session is not authenticated')
                }
                session.jumpChannel = await jumpSession.ssh.openTCPForwardChannel({
                    addressToConnectTo: profile.options.host,
                    portToConnectTo: profile.options.port ?? 22,
                    originatorAddress: '127.0.0.1',
                    originatorPort: 0,
                })
            }

            await session.start()
            return session
        } catch (error) {
            try {
                await session.destroy()
            } catch { }
            throw error
        }
    }

    private profileForSftp (profile: SSHProfile): SSHProfile {
        const options = { ...profile.options }
        const existing = options.algorithms ?? {}
        const algorithms = { ...defaultAlgorithms }
        for (const key of Object.values(SSHAlgorithmType)) {
            const list = existing[key]
            algorithms[key] = Array.isArray(list) && list.length ? [...list] : [...defaultAlgorithms[key]]
        }
        algorithms[SSHAlgorithmType.COMPRESSION] = ['none']

        return {
            ...profile,
            options: {
                ...options,
                algorithms,
                reuseSession: false,
                forwardedPorts: [],
                x11: false,
                agentForward: false,
                privateKeys: [...(options.privateKeys ?? [])],
            },
        }
    }
}
