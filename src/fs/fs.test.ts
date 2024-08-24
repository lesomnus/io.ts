import io from '~/.'

import type { FileMode } from './constants'
import * as errs from './errors'
import { MemFs } from './memfs'
import type { Fs } from './types'

describe.each<[string, () => Fs]>([
	//
	['memfs', () => new MemFs()],
])('%s', (_, make) => {
	test('create', async () => {
		const fs = make()

		const data = [0x12, 0x34]
		{
			await using f = await fs.create('foo')
			await f.write(io.from(data))
		}

		await using f = await fs.open('foo')
		const b = await io.readAll(f)
		expect([...b]).to.eql([...data])
	})
	test('mkdir', async () => {
		const fs = make()

		const data = [0x12, 0x34]
		{
			await fs.mkdir('foo', 0o750 as FileMode)
			await using f = await fs.create('foo/bar')
			await f.write(io.from(data))
		}

		await using f = await fs.open('foo/bar')
		const b = await io.readAll(f)
		expect([...b]).to.eql([...data])
	})
	test('mkdirAll', async () => {
		const fs = make()

		const mode = 0o750 as FileMode
		await fs.mkdir('foo', mode)
		await fs.mkdirAll('foo/bar/baz', mode)

		const info = await fs.stat('foo/bar/baz')
		expect(info.isDir).to.be.true
	})
	test('open a file and read from start', async () => {
		const fs = make()

		const data = [0x12, 0x34]
		{
			await using f = await fs.create('foo')
			await f.write(io.from(data))
		}

		{
			await using f = await fs.open('foo')
			const b = await io.readAll(f)
			expect([...b]).to.eql([...data])
		}
		{
			await using f = await fs.open('foo')
			const b = await io.readAll(f)
			expect([...b]).to.eql([...data])
		}
	})
	test('open files to read simultaneously', async () => {
		const fs = make()

		const data = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]
		{
			await using f = await fs.create('foo')
			await f.write(io.from(data))
		}

		await using f1 = await fs.open('foo')
		await using f2 = await fs.open('foo')

		const b1 = io.make(3)
		const b2 = io.make(2)

		await io.readFull(f1, b1)
		await io.readFull(f2, b2)
		expect([...b1]).to.eql([...data].slice(0, 3))
		expect([...b2]).to.eql([...data].slice(0, 2))

		await io.readFull(f1, b1)
		await io.readFull(f2, b2)
		expect([...b1]).to.eql([...data].slice(3, 6))
		expect([...b2]).to.eql([...data].slice(2, 4))
	})
	test('open a file that does not exist', async () => {
		const fs = make()

		const op = () => fs.open('not-exists')
		await expect(op).rejects.toThrow(errs.ErrNotExist)
	})
	test('open a directory', async () => {
		const fs = make()

		await fs.mkdir('foo', 0o750 as FileMode)

		await using f = await fs.open('foo')
		await expect(() => f.read(io.make(2))).rejects.toThrow(errs.ErrDirectory)

		const info = await f.stat()
		expect(info.isDir).to.be.true
	})
	test('readDir a directory', async () => {
		const fs = make()

		const mode = 0o750 as FileMode
		await fs.mkdirAll('foo/bar', mode)
		await fs.mkdirAll('foo/baz', mode)

		const names: string[] = []
		for await (const e of fs.readDir('foo')) {
			names.push(e.name)
		}
		expect(names).to.contain('bar')
		expect(names).to.contain('baz')
	})
	test('rename a regular file to a new name', async () => {
		const fs = make()

		const data = [0x12, 0x34]
		{
			await using f = await fs.create('foo')
			await f.write(io.from(data))
		}

		await fs.rename('foo', 'bar')
		expect(() => fs.stat('foo')).rejects.toThrow(errs.ErrNotExist)

		await using f = await fs.open('bar')
		const b = await io.readAll(f)
		expect([...b]).to.eql([...data])
	})
	test('rename a regular file to an existing name that is a regular file', async () => {
		const fs = make()

		const data = [0x12, 0x34]
		{
			await using f = await fs.create('foo')
			await f.write(io.from(data))
		}
		{
			await using f = await fs.create('bar')
			await f.write(io.from([0x56, 0x78]))
		}

		await fs.rename('foo', 'bar')
		expect(() => fs.stat('foo')).rejects.toThrow(errs.ErrNotExist)

		await using f = await fs.open('bar')
		const b = await io.readAll(f)
		expect([...b]).to.eql([...data])
	})
	test('rename a regular file to an existing name that is a directory', async () => {
		const fs = make()

		const data = [0x12, 0x34]
		{
			await using f = await fs.create('foo')
			await f.write(io.from(data))
			await fs.mkdir('bar', 0o750 as FileMode)
		}

		const op = () => fs.rename('foo', 'bar')
		expect(op).rejects.toThrow(errs.ErrDirectory)
	})
	test('rename a directory to a new name', async () => {
		const fs = make()

		await fs.mkdir('foo', 0o750 as FileMode)

		await fs.rename('foo', 'bar')
		expect(() => fs.stat('foo')).rejects.toThrow(errs.ErrNotExist)

		const info = await fs.stat('bar')
		expect(info.isDir).to.be.true
	})
	test('rename a directory to an existing name that is a regular file', async () => {
		const fs = make()

		await fs.mkdir('foo', 0o750 as FileMode)
		{
			await using f = await fs.create('bar')
			await f.write(io.from([0x56, 0x78]))
		}

		const op = () => fs.rename('foo', 'bar')
		expect(op).rejects.toThrow(errs.ErrNotDirectory)
	})
	test('rename a directory to an existing name that is an empty directory', async () => {
		const fs = make()

		const data = [0x12, 0x34]
		{
			await fs.mkdir('foo', 0o750 as FileMode)
			await using f = await fs.create('foo/baz')
			await f.write(io.from(data))

			await fs.mkdir('bar', 0o750 as FileMode)
		}

		await fs.rename('foo', 'bar')
		expect(() => fs.stat('foo')).rejects.toThrow(errs.ErrNotExist)

		await using f = await fs.open('bar/baz')
		const b = await io.readAll(f)
		expect([...b]).to.eql([...data])
	})
	test('rename a directory to an existing name that is a non-empty directory', async () => {
		const fs = make()

		const data = [0x12, 0x34]
		{
			await fs.mkdir('foo', 0o750 as FileMode)
			await using f = await fs.create('foo/baz')
			await f.write(io.from(data))
		}
		{
			await fs.mkdir('bar', 0o750 as FileMode)
			await using f = await fs.create('bar/qux')
			await f.write(io.from(data))
		}

		const op = () => fs.rename('foo', 'bar')
		expect(op).rejects.toThrow(new errs.ErrDirectoryNotEmpty())
	})
	test('remove a regular file', async () => {
		const fs = make()

		const data = [0x12, 0x34]
		{
			await using f = await fs.create('foo')
			await f.write(io.from(data))
		}

		await fs.remove('foo')
		expect(() => fs.stat('foo')).rejects.toThrow(errs.ErrNotExist)
	})
	test('remove an empty directory', async () => {
		const fs = make()

		await fs.mkdir('foo', 0o750 as FileMode)

		await fs.remove('foo')
		expect(() => fs.stat('foo')).rejects.toThrow(errs.ErrNotExist)
	})
	test('remove a non-empty directory', async () => {
		const fs = make()

		await fs.mkdirAll('foo/bar', 0o750 as FileMode)

		const op = () => fs.remove('foo')
		expect(op).rejects.toThrow(errs.ErrDirectoryNotEmpty)
	})
	test('remove a file that does not exist', async () => {
		const fs = make()

		const op = () => fs.remove('not-exists')
		await expect(op).rejects.toThrow(errs.ErrNotExist)
	})
})
