import { Span } from './Buff'
import { fromReadableStream } from './stream'
import { Closer, Reader, Slicer } from './types'

class ClosedReader implements Reader, Closer {
	read(): Promise<number | null> {
		return Promise.resolve(null)
	}

	close(): Promise<void> {
		return Promise.resolve()
	}
}

export function parseByteRanges(s: string) {
	const unit = 'bytes='
	if (!s.startsWith(unit)) {
		throw new SyntaxError('only the unit "bytes" is supported')
	}

	const rst: [number | undefined, number | undefined][] = []
	const vs = s.slice(unit.length).split(',')
	for (const v of vs) {
		const p = v.indexOf('-')
		if (p < 0) {
			throw new SyntaxError('no "-" is found')
		}

		const r = [v.slice(0, p), v.slice(p + 1)]
			.map(n => (n === '' ? undefined : n))
			.map(n => (n === undefined ? n : parseInt(n)))
		if (r.some(n => n !== undefined && Number.isNaN(n))) {
			throw new SyntaxError('invalid number representation')
		}
		if (r.every(n => n === undefined)) {
			throw new SyntaxError(
				'at least one position must be specified on either side.',
			)
		}

		rst.push(r as [number | undefined, number | undefined])
	}

	return rst
}

export class HttpReader implements Reader, Slicer, Closer {
	#req: Request
	#res: Response
	#r: Reader & Closer

	constructor(req: Request, res: Response) {
		this.#req = req
		this.#res = res
		this.#r =
			res.body === null
				? new ClosedReader()
				: fromReadableStream(res.body)
	}

	get headers() {
		return this.#res.headers
	}

	get ok() {
		return this.#res.ok
	}

	get redirected() {
		return this.#res.redirected
	}

	get status() {
		return this.#res.status
	}

	get statusText() {
		return this.#res.statusText
	}

	get type() {
		return this.#res.type
	}

	get url() {
		return this.#res.url
	}

	read(p: Span): Promise<number | null> {
		return this.#r.read(p)
	}

	slice(start = 0, end?: number): Promise<HttpReader> {
		// TODO: handle slice(0,0)?
		// TODO: handle negative values?

		const req = new Request(this.#req)

		// Intersect the range if this reader is already sliced one.
		const s = req.headers.get('Range')
		if (s !== null) {
			const rs = parseByteRanges(s)
			if (rs.length > 1) {
				throw new Error('not implemented: multiple ranges')
			}
			if (rs.length === 0) {
				throw new Error('assert: empty range')
			}

			// Note that `a` and `b` are absolute positions for the resource,
			// but `start` and `end` are relative positions.
			const [a, b] = rs[0]
			if (a === undefined) {
				throw new Error('not implemented: suffix range')
			}

			// Make `start` and `end` are absolute positions.
			// Still, `b` is inclusive and `end` is exclusive position.
			start = a + start
			if (end !== undefined) {
				end = a + end
			}

			if (b !== undefined) {
				end = end === undefined ? b + 1 : Math.min(end, b + 1)
			}
		}

		req.headers.set(
			'Range',
			`bytes=${start}-${end === undefined ? '' : end - 1}`,
		)
		return fetch_(req)
	}

	close(): Promise<void> {
		return this.#r.close()
	}
}

async function fetch_(
	input: URL | RequestInfo,
	init?: RequestInit,
): Promise<HttpReader> {
	const req = new Request(input, init)
	const res = await fetch(req)
	return new HttpReader(req, res)
}

export { fetch_ as fetch }
