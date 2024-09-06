import { describe, expect, test } from 'vitest'

import io from '.'

const D = new TextEncoder().encode('Royale with Cheese\nLe big Mac\n')

describe.each<[string, (d: Uint8Array) => Promise<io.Reader>]>([
	['Buff', d => Promise.resolve(io.Buff.from(d))],
	[
		'limit',
		async d => {
			const b = io.Buff.from(d)
			await b.write(io.from([0x42, 0x36]))
			return io.limit(b, d.length)
		},
	],
])('read %s', (_, make) => {
	test('read all at once', async () => {
		const r = await make(D)
		const b = io.Buff.make(D.length + 1)

		await expect(r.read(b)).resolves.toBe(D.length)
		expect([...b.subarray(0, D.length)]).toEqual([...D])

		await expect(r.read(b)).resolves.toBeNull()
	})
	test('read partially', async () => {
		const d = [...D]
		const r = await make(D)
		const b = io.Buff.make(12)

		// Read data three times. The first two reads fill the buffer,
		// but the last read does not fill the buffer.
		//
		// Royale•with•Cheese↵Le•big•Mac↵
		// ^           ^           ^     ^
		// 0           12          24    30

		await expect(r.read(b)).resolves.toBe(12)
		expect([...b]).to.eql(d.slice(0, 12))

		await expect(r.read(b)).resolves.toBe(12)
		expect([...b]).to.eql(d.slice(12, 24))

		await expect(r.read(b)).resolves.toBe(6)
		expect([...b.subbuff(0, 6)]).to.eql(d.slice(24, 30))

		await expect(r.read(b)).resolves.toBeNull()
	})
})
