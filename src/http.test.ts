import http from 'node:http'
import net from 'node:net'
import path from 'node:path'

import express from 'express'
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest'

import io from '.'
import { HttpReader, parseByteRanges } from './http'

import * as suite from './io.suite.test'
import { BURGER } from './testdata'

describe('parseByteRanges', () => {
	test.each(
		// biome-ignore format:
		[
			['1-2', [[        1,         2]]],
			['1-' , [[        1, undefined]]],
			[ '-2', [[undefined,         2]]],

			['1-2,1-',  [[1, 2], [        1, undefined]]],
			['1-2,-2',  [[1, 2], [undefined,         2]]],
			['1-2,1-2', [[1, 2], [        1,         2]]],

			['1-,-2,1-2', [
				[        1, undefined],
				[undefined,         2],
				[        1,         2],
			]],
		],
	)('bytes=%s', (given, want) => {
		expect(parseByteRanges(`bytes=${given}`)).toEqual(want)
	})

	it.each(
		// biome-ignore format:
		[
			[
				'empty string is given',
				[''],
			],
			[
				'there is no range',
				['bytes='],
			],
			[
				'there is no pos in range',
				['bytes=-'],
			],
			[
				'there is no dash in range',
				['bytes=1'],
			],
			[
				'the unit is not "bytes"',
				['words='],
			],
			[
				'the number representation is invalid',
				[
					'bytes=x-y',
					'bytes=x-',
					'bytes=-y',
					'bytes=1-2,x-y',
				]
			]
		],
	)('throws if %s', (_, testCases) => {
		for (const given of testCases) {
			expect(() => parseByteRanges(given)).toThrowError(SyntaxError)
		}
	})
})

describe('HttpReader', () => {
	let serverUrl: URL
	{
		let app: express.Express
		let server: http.Server
		beforeAll(async () => {
			app = express()
			app.use(
				express.static(path.join(import.meta.dirname, './testdata')),
			)
			server = await new Promise<http.Server>(resolve => {
				const server = app.listen(() => resolve(server))
			})
			serverUrl = new URL(
				`http://localhost:${
					(server.address() as net.AddressInfo).port
				}`,
			)
		})
		afterAll(async () => {
			await new Promise<void>(resolve => {
				server.close(() => resolve())
			})
		})
	}

	const getSbj = async () => {
		const r = await io.fetch(new URL('/burger', serverUrl))
		return [BURGER, r] as const
	}

	suite.testReader(getSbj)
	suite.testSlicer(getSbj)

	it('reads nothing if response does not contains a body', async () => {
		const r = await io.fetch(new URL('/empty', serverUrl))
		const b = io.Buff.make(1)
		await expect(r.read(b)).resolves.toBeNull()
	})

	it('does not throw even if response not ok', async () => {
		const req = io.fetch(new URL('/not-exist', serverUrl))
		await expect(req).resolves.toBeInstanceOf(HttpReader)

		const r = await req
		expect(r.status).toBe(404)
		expect(r.ok).toBeFalsy()

		// It has a body even if its status is 404.
		const b = io.Buff.make(1)
		await expect(r.read(b)).resolves.toBe(1)
	})
})
