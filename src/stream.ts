import { Buff, type Span } from './Buff'
import type { Closer, Reader } from './types'

class ByobReader implements Reader, Closer {
	constructor(private r: ReadableStreamBYOBReader) {}

	async read(p: Span): Promise<number | null> {
		const { value, done } = await this.r.read(p.data)
		if (value) {
			const n = value.length
			p.attach(value.buffer)
			return done ? null : n
		}

		return null
	}

	close(): Promise<void> {
		this.r.releaseLock()
		return Promise.resolve()
	}
}

export function fromByobReader(r: ReadableStreamBYOBReader): Reader & Closer {
	return new ByobReader(r)
}

class DefaultReader implements Reader, Closer {
	#s = Buff.make(0)

	constructor(private r: ReadableStreamDefaultReader<Uint8Array>) {}

	async read(p: Span): Promise<number | null> {
		const n = await this.#s.read(p)
		if (n !== null) {
			return n
		}

		const { value, done } = await this.r.read()
		if (done) {
			return null
		}

		this.#s = new Buff(value)
		return this.#s.read(p)
	}

	close(): Promise<void> {
		this.r.releaseLock()
		return Promise.resolve()
	}
}

export function fromDefaultReader(r: ReadableStreamDefaultReader<Uint8Array>): Reader & Closer {
	return new DefaultReader(r)
}

export function fromReadableStream(s: ReadableStream<Uint8Array>) {
	try {
		const r = s.getReader({ mode: 'byob' })
		return fromByobReader(r)
	} catch (e) {
		if (!(e instanceof Error && 'code' in e && e.code === 'ERR_INVALID_ARG_VALUE')) {
			throw e
		}

		const r = s.getReader()
		return fromDefaultReader(r)
	}
}
