import { describe, expect, it, test } from 'vitest'

import io from '.'

import { testReader } from './io.suite.test'
import { BURGER as D } from './testdata'

test('iota', () => {
	expect(io.iota(0)).toEqual([])
	expect(io.iota(2)).toEqual([0, 1])
	expect(io.iota(1, 2)).toEqual([2])
	expect(io.iota(2, -1)).toEqual([-1, 0])
})

describe('LimitedReader', () => {
	it('limits amount of data to read from the given reader', async () => {
		const b = io.Buff.from(D)
		const l = new io.LimitedReader(b, D.length - 2)
		const p = io.Buff.make(D.length)

		await expect(l.read(p)).resolves.toBe(D.length - 2)
		expect([...p].slice(0, -2)).toEqual([...D.slice(0, -2)])
	})

	it('does not keep its own read position', async () => {
		const b = io.Buff.from(D)
		const l = new io.LimitedReader(b, D.length - 2)
		const p = io.Buff.make(2)

		await expect(l.read(p)).resolves.toBe(2)
		expect([...p]).toEqual([...D.slice(0, 2)])

		await expect(b.read(p)).resolves.toBe(2)
		await expect(l.read(p)).resolves.toBe(2)
		expect([...p]).toEqual([...D.slice(4, 6)])
	})

	testReader(async () => {
		const b = new io.Buff(D)
		const l = new io.LimitedReader(b, D.length - 2)
		return [D.slice(0, -2), l]
	})
})

describe('readAtLeast', () => {
	it('reads at least `min` byte from the reader', async () => {
		const b = new io.Buff(D)
		const s = io.Buff.make(4, 8)

		await expect(io.readAtLeast(b, s, 2)).resolves.toBe(s.length)
	})

	it('stops read if the given reader returns null', async () => {
		const b = new io.Buff(D.slice(0, 2))
		const s = io.Buff.make(4, 8)

		await expect(io.readAtLeast(b, s, 4)).resolves.toBe(2)
	})

	it('throws Error if given Span has shorter length than `min`', async () => {
		const b = new io.Buff(D)
		const s = io.Buff.make(4, 8)

		await expect(() => io.readAtLeast(b, s, 6)).rejects.toThrow()
	})
})

describe('gulp', () => {
	it('reads until the end', async () => {
		const b = new io.Buff(D)
		const s = io.Buff.make(4, 8)

		let body: number[] = []
		for await (const n of io.gulp(b, s)) {
			body = [...body, ...s.subarray(0, n)]
		}
		expect(body).toEqual([...D])
	})
})
