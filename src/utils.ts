import { Buff, Span } from './Buff'
import { Reader } from './types'

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

export async function readAtLeast(
	r: Reader,
	p: Span,
	min: number,
): Promise<number | null> {
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

export async function readFull(r: Reader, p: Span): Promise<number | null> {
	return readAtLeast(r, p, p.length)
}

export function gulp(
	r: Reader,
	p: Span = Buff.make(512),
): AsyncIterable<number> {
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
