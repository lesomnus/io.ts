import { describe, expect, it, test } from 'vitest'

import io from '.'

test('iota', () => {
	expect(io.iota(0)).toEqual([])
	expect(io.iota(2)).toEqual([0, 1])
	expect(io.iota(1, 2)).toEqual([2])
	expect(io.iota(2, -1)).toEqual([-1, 0])
})

describe('LimitedReader', () => {
	it('limits amount of data to read from the given reader', async () => {
		const d = io.iota(42, 1)
		const b = io.Buff.from(d)
		const r = io.limit(b, d.length - 2)

		const p = await io.readAll(r)
		expect([...p]).to.eql([...d.slice(0, -2)])
	})

	it('does not keep its own read position', async () => {
		const d = io.iota(42, 1)
		const b = io.Buff.from(d)
		const l = io.limit(b, d.length - 2)
		const p = io.Buff.make(2)

		await expect(l.read(p)).resolves.toBe(2)
		expect([...p]).toEqual([...d.slice(0, 2)])

		await expect(b.read(p)).resolves.toBe(2)
		await expect(l.read(p)).resolves.toBe(2)
		expect([...p]).toEqual([...d.slice(4, 6)])
	})
})

describe('readAtLeast', () => {
	it('reads at least `min` byte from the reader', async () => {
		const d = io.iota(42, 1)
		const b = io.Buff.from(d)
		const s = io.Buff.make(4, 8)

		await expect(io.readAtLeast(b, s, 2)).resolves.toBe(s.length)
	})

	it('throws Error if given Span has shorter length than `min`', async () => {
		const d = io.iota(42, 1)
		const b = io.Buff.from(d)
		const s = io.Buff.make(4, 8)

		await expect(() => io.readAtLeast(b, s, 6)).rejects.toThrow()
	})

	it('stops read if given reader is closed and returns number of bytes read', async () => {
		const d = io.iota(42, 1)
		const b = io.Buff.from(d)
		const s = io.Buff.make(50)

		await expect(io.readAtLeast(b, s, s.length)).resolves.toEqual(42)
	})
})

describe('gulp', () => {
	it('reads until the end', async () => {
		const d = io.iota(42, 1)
		const b = io.Buff.from(d)
		const s = io.Buff.make(4, 8)

		let body: number[] = []
		for await (const n of io.gulp(b, s)) {
			body = [...body, ...s.subarray(0, n)]
		}
		expect(body).toEqual(d)
	})
})

describe('copy', () => {
	it('copies data from reader to writer', async () => {
		const d = io.iota(42, 1)
		const r = io.Buff.from(d)
		const w = io.Buff.make(0)

		const n = await io.copy(w, r)
		expect(n).toBe(d.length)
		expect([...w]).toEqual(d)
	})
})
