import { createServer, Server as HttpServer } from 'http'
import { connect as tlsConnect, PeerCertificate, TLSSocket, ConnectionOptions } from 'tls'
import { createConnection, Socket, AddressInfo, isIP } from 'net'
import { WebSocketServer, WebSocket } from 'ws'
import { Logger } from 'tabby-core'

const VERSION_1 = 3390
const TAG_SEQUENCE = 0x30
const TAG_INTEGER = 0x02
const TAG_OCTET_STRING = 0x04
const TAG_UTF8STRING = 0x0c
const TAG_CTX = (n: number) => 0xa0 + n

function derEncodeLength (length: number): Buffer {
    if (length < 0x80) {
        return Buffer.from([length])
    }
    const bytes: number[] = []
    let temp = length
    while (temp > 0) {
        bytes.unshift(temp & 0xff)
        temp >>= 8
    }
    return Buffer.from([0x80 | bytes.length, ...bytes])
}

function derWrap (tag: number, content: Buffer): Buffer {
    const len = derEncodeLength(content.length)
    return Buffer.concat([Buffer.from([tag]), len, content])
}

function derEncodeInteger (value: number): Buffer {
    if (value === 0) {
        return derWrap(TAG_INTEGER, Buffer.from([0]))
    }
    const bytes: number[] = []
    let temp = value
    while (temp > 0) {
        bytes.unshift(temp & 0xff)
        temp >>= 8
    }
    if (bytes[0] & 0x80) {
        bytes.unshift(0)
    }
    return derWrap(TAG_INTEGER, Buffer.from(bytes))
}

function derEncodeUtf8String (str: string): Buffer {
    return derWrap(TAG_UTF8STRING, Buffer.from(str, 'utf-8'))
}

function derEncodeOctetString (buf: Buffer): Buffer {
    return derWrap(TAG_OCTET_STRING, buf)
}

function derWrapContext (tagNum: number, content: Buffer): Buffer {
    return derWrap(TAG_CTX(tagNum), content)
}

function derDecodeLength (buf: Buffer, offset: number): { length: number, bytesRead: number } {
    const first = buf[offset]
    if (first < 0x80) {
        return { length: first, bytesRead: 1 }
    }
    const numBytes = first & 0x7f
    let length = 0
    for (let i = 0; i < numBytes; i++) {
        length = length << 8 | buf[offset + 1 + i]
    }
    return { length, bytesRead: 1 + numBytes }
}

function derDecodeTLV (buf: Buffer, offset: number): { tag: number, value: Buffer, totalLength: number } {
    const tag = buf[offset]
    const { length, bytesRead } = derDecodeLength(buf, offset + 1)
    const headerLen = 1 + bytesRead
    const value = buf.subarray(offset + headerLen, offset + headerLen + length)
    return { tag, value, totalLength: headerLen + length }
}

function derDecodeInteger (buf: Buffer): number {
    let val = 0
    for (const byte of buf) {
        val = val << 8 | byte
    }
    return val
}

function derDecodeChildren (buf: Buffer): { tag: number, value: Buffer, totalLength: number }[] {
    const children: { tag: number, value: Buffer, totalLength: number }[] = []
    let offset = 0
    while (offset < buf.length) {
        const tlv = derDecodeTLV(buf, offset)
        children.push(tlv)
        offset += tlv.totalLength
    }
    return children
}

function parseRDCleanPathRequest (data: Buffer): { destination: string, x224ConnectionRequest: Buffer } {
    const outer = derDecodeTLV(data, 0)
    if (outer.tag !== TAG_SEQUENCE) {
        throw new Error(`Expected SEQUENCE (0x30), got 0x${outer.tag.toString(16)}`)
    }

    let version: number | null = null
    let destination: string | null = null
    let x224ConnectionRequest: Buffer | null = null

    for (const child of derDecodeChildren(outer.value)) {
        const ctxTag = child.tag & 0x1f
        switch (ctxTag) {
            case 0: {
                const intTlv = derDecodeTLV(child.value, 0)
                version = derDecodeInteger(intTlv.value)
                break
            }
            case 2: {
                const strTlv = derDecodeTLV(child.value, 0)
                destination = strTlv.value.toString('utf-8')
                break
            }
            case 6: {
                const octTlv = derDecodeTLV(child.value, 0)
                x224ConnectionRequest = octTlv.value
                break
            }
        }
    }

    if (version !== VERSION_1) {
        throw new Error(`Unsupported RDCleanPath version: ${version}`)
    }
    if (!destination) {
        throw new Error('Missing destination in RDCleanPath request')
    }
    if (!x224ConnectionRequest) {
        throw new Error('Missing x224_connection_pdu in RDCleanPath request')
    }

    return { destination, x224ConnectionRequest }
}

function buildRDCleanPathResponse (serverAddr: string, x224Response: Buffer, certChain: Buffer[]): Buffer {
    const parts: Buffer[] = []
    parts.push(derWrapContext(0, derEncodeInteger(VERSION_1)))
    parts.push(derWrapContext(6, derEncodeOctetString(x224Response)))
    const certOctets = certChain.map(cert => derEncodeOctetString(cert))
    const certSeq = derWrap(TAG_SEQUENCE, Buffer.concat(certOctets))
    parts.push(derWrapContext(7, certSeq))
    parts.push(derWrapContext(9, derEncodeUtf8String(serverAddr)))
    return derWrap(TAG_SEQUENCE, Buffer.concat(parts))
}

function buildRDCleanPathError (errorCode: number, httpStatusCode?: number): Buffer {
    const errParts: Buffer[] = [derWrapContext(0, derEncodeInteger(errorCode))]
    if (httpStatusCode != null) {
        errParts.push(derWrapContext(1, derEncodeInteger(httpStatusCode)))
    }
    const parts = [
        derWrapContext(0, derEncodeInteger(VERSION_1)),
        derWrapContext(1, derWrap(TAG_SEQUENCE, Buffer.concat(errParts))),
    ]
    return derWrap(TAG_SEQUENCE, Buffer.concat(parts))
}

function parseDestination (destination: string): { host: string, port: number } {
    if (destination.startsWith('[')) {
        const bracketEnd = destination.indexOf(']')
        if (bracketEnd === -1) {
            throw new Error(`Invalid IPv6 destination: ${destination}`)
        }
        const host = destination.slice(1, bracketEnd)
        const rest = destination.slice(bracketEnd + 1)
        const port = rest.startsWith(':') ? parseInt(rest.slice(1), 10) : 3389
        return { host, port }
    }

    const lastColon = destination.lastIndexOf(':')
    if (lastColon === -1) {
        return { host: destination, port: 3389 }
    }
    const host = destination.slice(0, lastColon)
    const port = parseInt(destination.slice(lastColon + 1), 10)
    if (isNaN(port)) {
        return { host: destination, port: 3389 }
    }
    return { host, port }
}

function extractCertChain (peerCert: PeerCertificate): Buffer[] {
    const certs: Buffer[] = []
    const seen = new Set<string>()
    let current: PeerCertificate | undefined = peerCert
    while (current?.raw) {
        const fingerprint = current.fingerprint256 || current.raw.toString('hex')
        if (seen.has(fingerprint)) {
            break
        }
        seen.add(fingerprint)
        certs.push(Buffer.from(current.raw))
        const issuer = (current as PeerCertificate & { issuerCertificate?: PeerCertificate }).issuerCertificate
        if (issuer && issuer !== current) {
            current = issuer
        } else {
            break
        }
    }
    return certs
}

function describeX224 (buf: Buffer): string {
    if (buf.length < 4 || buf[0] !== 0x03) {
        return `non-TPKT (${buf.length} bytes) ${buf.subarray(0, 16).toString('hex')}`
    }
    const length = buf.readUInt16BE(2)
    return `TPKT len=${length} hex=${buf.subarray(0, Math.min(buf.length, 32)).toString('hex')}`
}

function readTpkt (socket: Socket, timeoutMs: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        let buf = Buffer.alloc(0)
        const onData = (chunk: Buffer) => {
            buf = Buffer.concat([buf, chunk])
            if (buf.length < 4) {
                return
            }
            if (buf[0] !== 0x03) {
                cleanup()
                resolve(buf)
                return
            }
            const length = buf.readUInt16BE(2)
            if (buf.length >= length) {
                cleanup()
                const packet = buf.subarray(0, length)
                const rest = buf.subarray(length)
                if (rest.length) {
                    socket.unshift(rest)
                }
                resolve(packet)
            }
        }
        const onError = (err: Error) => {
            cleanup()
            reject(err)
        }
        const onTimeout = () => {
            cleanup()
            socket.destroy()
            reject(new Error('Timed out waiting for X.224 Connection Confirm'))
        }
        const cleanup = () => {
            socket.off('data', onData)
            socket.off('error', onError)
            socket.off('timeout', onTimeout)
            socket.setTimeout(0)
        }
        socket.setTimeout(timeoutMs)
        socket.on('data', onData)
        socket.once('error', onError)
        socket.once('timeout', onTimeout)
    })
}

type HandshakeResult = {
    x224Response: Buffer
    certChain: Buffer[]
    tlsSocket: TLSSocket
}

type TlsAttempt = {
    name: string
    options: Pick<ConnectionOptions, 'minVersion' | 'maxVersion' | 'ciphers'>
}

// Windows RDP self-signed certs often set Key Encipherment but not Digital
// Signature. Electron's BoringSSL then rejects the default ECDHE ciphers with
// KEY_USAGE_BIT_INCORRECT. RSA key-exchange + TLS 1.2 matches those certs.
const TLS_ATTEMPTS: TlsAttempt[] = [
    {
        name: 'rsa-tls1.2',
        options: {
            minVersion: 'TLSv1',
            maxVersion: 'TLSv1.2',
            // AES-GCM first: much faster for RDP bitmaps than CBC (AES*-SHA).
            ciphers: 'AES256-GCM-SHA384:AES128-GCM-SHA256:AES256-SHA:AES128-SHA',
        },
    },
    {
        name: 'default',
        options: {
            minVersion: 'TLSv1',
        },
    },
]

function handshakeOnce (
    host: string,
    port: number,
    x224Request: Buffer,
    logger: Logger,
    attempt: TlsAttempt,
): Promise<HandshakeResult> {
    return new Promise((resolve, reject) => {
        let settled = false
        const fail = (err: Error) => {
            if (settled) {
                return
            }
            settled = true
            try {
                tcpSocket.destroy()
            } catch { }
            reject(err)
        }

        logger.info(`[tabby-rdp] TCP connect ${host}:${port} (${attempt.name})`)
        console.log('[tabby-rdp] TCP connect', host, port, attempt.name, describeX224(x224Request))

        const tcpSocket: Socket = createConnection({ host, port, noDelay: true }, () => {
            tcpSocket.setNoDelay(true)
            tcpSocket.setKeepAlive(true, 30000)
            console.log('[tabby-rdp] TCP connected, sending X.224')
            tcpSocket.write(x224Request)
        })

        tcpSocket.once('error', err => {
            fail(new Error(`TCP connection failed (${host}:${port}): ${err.message}`))
        })

        readTpkt(tcpSocket, 15000).then(x224Response => {
            tcpSocket.removeAllListeners('error')
            console.log('[tabby-rdp] X.224 confirm', describeX224(x224Response))
            if (!x224Response.length) {
                fail(new Error('RDP server closed connection without X.224 response'))
                return
            }

            const tlsOptions: ConnectionOptions = {
                socket: tcpSocket,
                rejectUnauthorized: false,
                checkServerIdentity: () => undefined,
                ...attempt.options,
            }
            if (!isIP(host)) {
                tlsOptions.servername = host
            }

            console.log('[tabby-rdp] starting TLS', {
                attempt: attempt.name,
                servername: tlsOptions.servername ?? null,
                minVersion: tlsOptions.minVersion,
                maxVersion: tlsOptions.maxVersion,
                ciphers: tlsOptions.ciphers ?? 'default',
            })
            const tlsSocket = tlsConnect(tlsOptions, () => {
                if (settled) {
                    return
                }
                settled = true
                tlsSocket.setNoDelay(true)
                const peerCert = tlsSocket.getPeerCertificate(true)
                const certChain = extractCertChain(peerCert)
                logger.info(`TLS handshake completed with ${certChain.length} certificate(s) protocol=${tlsSocket.getProtocol()} cipher=${tlsSocket.getCipher()?.name}`)
                console.log('[tabby-rdp] TLS ok', {
                    attempt: attempt.name,
                    protocol: tlsSocket.getProtocol(),
                    certs: certChain.length,
                    cipher: tlsSocket.getCipher(),
                })
                resolve({ x224Response: Buffer.from(x224Response), certChain, tlsSocket })
            })

            tlsSocket.once('error', err => {
                console.error('[tabby-rdp] TLS handshake failed:', attempt.name, err)
                fail(new Error(`TLS handshake failed (${host}:${port}): ${err.message}`))
            })
        }).catch(err => {
            fail(err instanceof Error ? err : new Error(String(err)))
        })
    })
}

async function performRDPHandshake (
    host: string,
    port: number,
    x224Request: Buffer,
    logger: Logger,
): Promise<HandshakeResult> {
    let lastError: Error | null = null
    for (const attempt of TLS_ATTEMPTS) {
        try {
            return await handshakeOnce(host, port, x224Request, logger, attempt)
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err))
            const retryable = /KEY_USAGE_BIT_INCORRECT|handshake failure|no ciphers|sslv3 alert/i.test(lastError.message)
            if (!retryable || attempt === TLS_ATTEMPTS[TLS_ATTEMPTS.length - 1]) {
                throw lastError
            }
            logger.warn(`[tabby-rdp] TLS ${attempt.name} failed, retrying: ${lastError.message}`)
            console.warn('[tabby-rdp] TLS attempt failed, retrying', attempt.name, lastError.message)
        }
    }
    throw lastError ?? new Error('TLS handshake failed')
}

function setupRelay (ws: WebSocket, tlsSocket: TLSSocket, logger: Logger): void {
    const HIGH_WATER = 1024 * 1024
    const LOW_WATER = 256 * 1024

    const maybeResume = (): void => {
        if (!tlsSocket.destroyed && tlsSocket.isPaused() && ws.bufferedAmount < LOW_WATER) {
            tlsSocket.resume()
        }
    }

    tlsSocket.on('data', data => {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data, { binary: true }, maybeResume)
                if (ws.bufferedAmount > HIGH_WATER) {
                    tlsSocket.pause()
                }
            }
        } catch (err: any) {
            logger.warn('TLS→WS write error:', err.message)
        }
    })

    ws.on('message', data => {
        try {
            if (!tlsSocket.destroyed) {
                tlsSocket.write(data as Buffer)
            }
        } catch (err: any) {
            logger.warn('WS→TLS write error:', err.message)
        }
    })

    const cleanup = (): void => {
        if (!tlsSocket.destroyed) {
            tlsSocket.destroy()
        }
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.close()
            } catch { }
        }
    }

    tlsSocket.on('end', cleanup)
    tlsSocket.on('error', err => {
        logger.warn('TLS error:', err.message)
        cleanup()
    })
    ws.on('close', cleanup)
    ws.on('error', err => {
        logger.warn('WebSocket error:', err.message)
        cleanup()
    })
}

export class RDCleanPathProxy {
    private httpServer: HttpServer | null = null
    private wss: WebSocketServer | null = null
    url: string | null = null
    lastError: string | null = null

    constructor (private logger: Logger) { }

    async start (): Promise<string> {
        this.httpServer = createServer()
        this.wss = new WebSocketServer({
            server: this.httpServer,
            perMessageDeflate: false,
            maxPayload: 64 * 1024 * 1024,
        })
        this.wss.on('connection', ws => this.handleConnection(ws))

        await new Promise<void>((resolve, reject) => {
            this.httpServer!.once('error', reject)
            this.httpServer!.listen(0, '127.0.0.1', () => resolve())
        })

        const address = this.httpServer.address() as AddressInfo
        this.url = `ws://127.0.0.1:${address.port}`
        this.logger.info(`RDCleanPath proxy listening on ${this.url}`)
        return this.url
    }

    stop (): void {
        try {
            this.wss?.clients.forEach(client => {
                try {
                    client.close()
                } catch { }
            })
            this.wss?.close()
        } catch { }
        try {
            this.httpServer?.close()
        } catch { }
        this.wss = null
        this.httpServer = null
        this.url = null
    }

    private handleConnection (ws: WebSocket): void {
        ws.once('message', async data => {
            try {
                this.lastError = null
                const requestData = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
                const request = parseRDCleanPathRequest(requestData)
                const { host, port } = parseDestination(request.destination)
                this.logger.info(`Connecting to RDP server ${host}:${port}`)

                const { x224Response, certChain, tlsSocket } = await performRDPHandshake(
                    host,
                    port,
                    request.x224ConnectionRequest,
                    this.logger,
                )

                const responsePdu = buildRDCleanPathResponse(`${host}:${port}`, x224Response, certChain)
                ws.send(responsePdu)
                setupRelay(ws, tlsSocket, this.logger)
            } catch (err: any) {
                this.lastError = err?.message || String(err)
                this.logger.error('RDCleanPath handshake error:', this.lastError)
                console.error('[tabby-rdp] handshake error:', this.lastError, err)
                try {
                    ws.send(buildRDCleanPathError(1, 502))
                } catch { }
                try {
                    ws.close()
                } catch { }
            }
        })
    }
}
