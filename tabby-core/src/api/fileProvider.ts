import { Injectable } from '@angular/core'

@Injectable({ providedIn: 'root' })
export abstract class FileProvider {
    name: string

    async isAvailable (): Promise<boolean> {
        return true
    }

    abstract selectAndStoreFile (description: string): Promise<string>
    abstract retrieveFile (key: string): Promise<Buffer>

    async storeFile (_description: string, _fileName: string, _contents: Uint8Array): Promise<string> {
        throw new Error('Not supported')
    }
}
