const GL_OPTIONS: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    desynchronized: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: true,
}

const VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
    v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() {
    gl_FragColor = texture2D(u_tex, v_uv);
}
`

function compile (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type)
    if (!shader) {
        return null
    }
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader)
        return null
    }
    return shader
}

function createGl (canvas: HTMLCanvasElement): WebGL2RenderingContext | WebGLRenderingContext | null {
    try {
        return canvas.getContext('webgl2', GL_OPTIONS) as WebGL2RenderingContext | null
            ?? canvas.getContext('webgl', GL_OPTIONS)
    } catch {
        return null
    }
}

/**
 * IronRDP paints with putImageData (CPU). This intercepts those tiles,
 * uploads them to a GPU texture, and presents once per animation frame.
 */
export function attachGpuPresenter (source: HTMLCanvasElement, target: HTMLCanvasElement): (() => void) | null {
    const gl = createGl(target)
    if (!gl) {
        console.warn('[tabby-rdp] WebGL unavailable, using canvas 2D')
        return null
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VS)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS)
    if (!vs || !fs) {
        return null
    }
    const program = gl.createProgram()
    if (!program) {
        return null
    }
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'a_pos')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        return null
    }
    gl.useProgram(program)
    gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)

    const sourceCtx = source.getContext('2d', { alpha: false, desynchronized: true })
    if (!sourceCtx) {
        return null
    }

    const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? gl : null
    let texW = 0
    let texH = 0
    let dirty = false
    let raf = 0
    let stopped = false

    const ensureTexture = (): boolean => {
        const width = source.width
        const height = source.height
        if (!width || !height) {
            return false
        }
        if (width === texW && height === texH) {
            return true
        }
        texW = width
        texH = height
        if (target.width !== width) {
            target.width = width
        }
        if (target.height !== height) {
            target.height = height
        }
        gl.viewport(0, 0, width, height)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.clearColor(0, 0, 0, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        return true
    }

    const upload = (imageData: ImageData, dx: number, dy: number, dirtyX = 0, dirtyY = 0, dirtyW = imageData.width, dirtyH = imageData.height): void => {
        if (!ensureTexture()) {
            return
        }
        const x = Math.round(dx + dirtyX)
        const y = Math.round(dy + dirtyY)
        const width = Math.round(dirtyW)
        const height = Math.round(dirtyH)
        if (width <= 0 || height <= 0) {
            return
        }
        gl.bindTexture(gl.TEXTURE_2D, texture)
        if (gl2 && (dirtyX !== 0 || dirtyY !== 0 || width !== imageData.width || height !== imageData.height)) {
            gl2.pixelStorei(gl2.UNPACK_ROW_LENGTH, imageData.width)
            gl2.pixelStorei(gl2.UNPACK_SKIP_PIXELS, Math.round(dirtyX))
            gl2.pixelStorei(gl2.UNPACK_SKIP_ROWS, Math.round(dirtyY))
            gl2.texSubImage2D(gl2.TEXTURE_2D, 0, x, y, width, height, gl2.RGBA, gl2.UNSIGNED_BYTE, imageData.data)
            gl2.pixelStorei(gl2.UNPACK_ROW_LENGTH, 0)
            gl2.pixelStorei(gl2.UNPACK_SKIP_PIXELS, 0)
            gl2.pixelStorei(gl2.UNPACK_SKIP_ROWS, 0)
        } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, Math.round(dx), Math.round(dy), imageData.width, imageData.height, gl.RGBA, gl.UNSIGNED_BYTE, imageData.data)
        }
        dirty = true
    }

    const originalPut = sourceCtx.putImageData.bind(sourceCtx)
    sourceCtx.putImageData = ((imageData: ImageData, dx: number, dy: number, dirtyX?: number, dirtyY?: number, dirtyWidth?: number, dirtyHeight?: number) => {
        upload(imageData, dx, dy, dirtyX ?? 0, dirtyY ?? 0, dirtyWidth ?? imageData.width, dirtyHeight ?? imageData.height)
    }) as CanvasRenderingContext2D['putImageData']

    const frame = (): void => {
        if (stopped) {
            return
        }
        raf = requestAnimationFrame(frame)
        if (!dirty) {
            return
        }
        dirty = false
        ensureTexture()
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    raf = requestAnimationFrame(frame)
    console.log('[tabby-rdp] GPU presenter', gl2 ? 'webgl2' : 'webgl')

    return () => {
        stopped = true
        cancelAnimationFrame(raf)
        sourceCtx.putImageData = originalPut
        gl.deleteBuffer(buffer)
        gl.deleteTexture(texture)
        gl.deleteProgram(program)
        gl.deleteShader(vs)
        gl.deleteShader(fs)
    }
}
