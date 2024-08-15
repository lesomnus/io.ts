import { Buff, type Span } from './Buff'
import type { Reader, Writer } from './types'

export function iota(l: number, init = 0): number[] {
	return Array(l)
		.fill(0)
		.map(_ => init++)
}

export class LimitedReader implements Reader {
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

export async function readAtLeast(r: Reader, p: Span, min: number): Promise<number | null> {
	if (p.length < min) {
		throw new Error('short buffer')
	}

	let pos = 0
	while (pos < min) {
		const n = await r.read(p.subarray(pos))
		if (n === null) {
			throw new Error('unexpected end of file')
		}
		pos += n
	}

	return pos
}

export async function readFull(r: Reader, p: Span): Promise<number | null> {
	return readAtLeast(r, p, p.length)
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
