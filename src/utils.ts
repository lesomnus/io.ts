import { Buff, type Span, make } from './Buff'
import type { Reader, Writer } from './types'

export function iota(l: number, init = 0): number[] {
	return Array(l)
		.fill(0)
		.map(_ => init++)
}

class LimitedReader implements Reader {
	constructor(
		private r: Reader,
		private n: number,
	) {}

	async read(p: Span): Promise<number | null> {
		if (this.n <= 0) {
			return null
		}
		if (p.length > this.n) {
			p = p.subarray(0, this.n)
		}

		const n = await this.r.read(p)
		if (n !== null) {
			this.n -= n
		}

		return n
	}
}

export function limit(r: Reader, n: number): Reader {
	return new LimitedReader(r, n)
}

class TeeReader implements Reader {
	constructor(
		private r: Reader,
		private w: Writer,
	) {}

	async read(p: Span): Promise<number | null> {
		const n = await this.r.read(p)
		if (n === null) {
			return null
		}

		await this.w.write(p.subbuff(0, n))
		return n
	}
}

export function tee(r: Reader, w: Writer): Reader {
	return new TeeReader(r, w)
}

export async function readAtLeast(r: Reader, p: Span, min: number): Promise<number> {
	if (p.length < min) {
		throw new Error('short buffer')
	}

	let pos = 0
	while (pos < min) {
		const n = await r.read(p.subarray(pos))
		if (n === null) {
			return pos
		}
		pos += n
	}

	return pos
}

export async function readFull(r: Reader, p: Span): Promise<number> {
	return readAtLeast(r, p, p.length)
}

export async function readAll(r: Reader): Promise<Span> {
	let b = make(0, 512)
	while (true) {
		const n = await r.read(b.subbuff(b.length, b.capacity))
		if (n === null) return b

		b = b.subbuff(0, b.length + n)
		if (b.length === b.capacity) {
			const next = make(b.length, b.length * 2)
			next.data.set(b.data)
			b = next
		}
	}
}

export function gulp(r: Reader, p: Span): AsyncIterable<number> {
	return {
		async *[Symbol.asyncIterator]() {
			while (true) {
				const n = await r.read(p)
				if (n === null) {
					return
				}
				yield n
			}
		},
	}
}

export async function copy(dst: Writer, src: Reader, buf?: Span): Promise<number> {
	if (buf === undefined) {
		buf = Buff.make(32 * 1024)
	}

	// How to pass n on throw?
	let n = 0
	for await (const nr of gulp(src, buf)) {
		const b = buf.subbuff(0, nr)
		const nw = await dst.write(b)
		if (nw === null || nw < 0) {
			throw new Error('invalid write')
		}

		n += nw
		if (nw < nr) {
			throw new Error('short write')
		}
	}

	return n
}

export const discard: Writer = {
	write(p) {
		return Promise.resolve(p.length)
	},
}
