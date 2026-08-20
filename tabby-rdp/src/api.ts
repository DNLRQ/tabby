import { ConnectableProfile } from 'tabby-core'

export interface RDPProfile extends ConnectableProfile {
    options: RDPProfileOptions
}

export interface RDPProfileOptions {
    host: string
    port: number
    user: string
    domain: string
    password: string | null
    nla: boolean
    clipboard: boolean
    adaptiveResolution: boolean
    width: number
    height: number
    warnOnClose: boolean | null
}

export type RDPScaleMode = 'fit' | 'actual'
